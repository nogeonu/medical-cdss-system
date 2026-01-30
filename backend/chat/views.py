from typing import List, Optional, Union
from datetime import datetime
import logging
import imghdr
import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import UploadedFile
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.db import connections
from django.db.models import Count, DateTimeField, F, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from rest_framework import permissions, status, viewsets, parsers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import ChatAttachment, ChatRoom, ChatRoomUserState, Message, Notification
from .permissions import accessible_rooms_query, user_has_room_access, user_has_shift_access, user_has_department_access
from .room_utils import dm_participant_ids
from .serializers import (
    ChatAttachmentSerializer,
    ChatRoomSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    NotificationSerializer,
    UserSummarySerializer,
)


User = get_user_model()
logger = logging.getLogger(__name__)


def validate_attachment(attachment):
    max_size = getattr(settings, "CHAT_UPLOAD_MAX_SIZE", 0)
    if max_size and attachment.size > max_size:
        return f"File exceeds {max_size // (1024 * 1024)}MB limit."

    allowed_types = getattr(settings, "CHAT_UPLOAD_ALLOWED_TYPES", [])
    allowed_exts = getattr(settings, "CHAT_UPLOAD_ALLOWED_EXTS", [])
    ext = os.path.splitext(attachment.name)[1].lower()
    content_type = (attachment.content_type or "").lower()
    if allowed_exts and ext not in allowed_exts:
        return "File extension not allowed."
    if allowed_types and content_type and content_type not in allowed_types:
        if ext == ".md" and content_type in {
            "text/markdown",
            "text/plain",
            "application/octet-stream",
        }:
            pass
        else:
            return "File type not allowed."

    if (
        getattr(settings, "CHAT_UPLOAD_SCAN_IMAGES", True)
        and attachment.content_type
        and attachment.content_type.startswith("image/")
    ):
        try:
            position = attachment.file.tell()
            header = attachment.file.read(512)
            attachment.file.seek(position)
        except Exception:
            return "Image scan failed."
        if imghdr.what(None, h=header) is None:
            return "Image scan failed."

    return None


def filter_dm_rooms_for_user(queryset, user):
    if not user or not user.is_authenticated:
        return queryset.none()
    dm_prefix = Q(room_type=ChatRoom.ROOM_TYPE_CASE, case_key__startswith="dm:")
    user_id = user.id
    pattern_left = rf"^dm:{user_id}:[0-9]+$"
    pattern_right = rf"^dm:[0-9]+:{user_id}$"
    dm_match = Q(case_key__regex=pattern_left) | Q(case_key__regex=pattern_right)
    return queryset.filter(~dm_prefix | dm_match)


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSummarySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        # 인증 확인 로깅
        if not self.request.user.is_authenticated:
            logger.warning(f"UserViewSet: Unauthenticated request from {self.request.META.get('REMOTE_ADDR')}")
        else:
            logger.info(f"UserViewSet: Authenticated user {self.request.user.id} ({self.request.user.username})")
        
        # DB에 department 컬럼이 있지만 모델에는 없는 경우, extra()로 가져오기
        # first_name과 last_name도 명시적으로 선택하여 가져오기
        queryset = User.objects.filter(is_active=True).select_related("presence").extra(
            select={
                "department": "department",
                "first_name": "first_name",
                "last_name": "last_name"
            }
        ).order_by("username")
        return queryset

    @action(detail=False, methods=["get"])
    def me(self, request):
        """현재 로그인한 사용자 정보 반환"""
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_serializer_context(self):
        return {"request": self.request}

    def get_queryset(self):
        user = self.request.user
        queryset = Notification.objects.filter(user=user).select_related(
            "room",
            "message",
            "message__sender",
            "message__sender__presence",
        )
        unread_only = self.request.query_params.get("unread", "1") != "0"
        if unread_only:
            queryset = queryset.filter(is_read=False)
        return queryset.order_by("-created_at")

    @action(detail=False, methods=["post"], url_path="read")
    def mark_read(self, request):
        ids = request.data.get("ids")
        mark_all = request.data.get("all") == True or request.data.get("all") == "1"
        queryset = Notification.objects.filter(user=request.user, is_read=False)
        if not mark_all:
            if not isinstance(ids, list):
                return Response({"detail": "ids must be a list or set all=1."}, status=400)
            queryset = queryset.filter(id__in=ids)
        updated = queryset.update(is_read=True)
        return Response({"updated": updated})


class ChatAttachmentViewSet(viewsets.GenericViewSet):
    serializer_class = ChatAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "chat_upload"
    parser_classes = [parsers.MultiPartParser, parsers.FormParser]

    def get_queryset(self):
        return ChatAttachment.objects.filter(uploaded_by=self.request.user).order_by("-created_at")

    def create(self, request):
        logger.info(f"파일 업로드 요청: user={request.user}, FILES={list(request.FILES.keys())}, POST={list(request.POST.keys())}")
        
        file_obj = request.FILES.get("file") or request.FILES.get("attachment")
        if not file_obj:
            logger.error(f"파일이 없음: FILES={request.FILES}, POST={request.POST}")
            raise ValidationError("File is required.")
        
        logger.info(f"파일 검증 시작: {file_obj.name}, {file_obj.size} bytes, {file_obj.content_type}")
        error = validate_attachment(file_obj)
        if error:
            logger.error(f"파일 검증 실패: {error}")
            raise ValidationError(error)
        
        attachment = ChatAttachment.objects.create(
            uploaded_by=request.user,
            file=file_obj,
            original_name=file_obj.name,
            content_type=file_obj.content_type or "",
            size=file_obj.size,
        )
        logger.info(f"파일 업로드 성공: {attachment.id}")
        serializer = self.get_serializer(attachment, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ChatRoomViewSet(viewsets.ModelViewSet):
    serializer_class = ChatRoomSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None
    throttle_classes = [ScopedRateThrottle]

    def get_throttles(self):
        # throttle scope 설정 (settings.py에 DEFAULT_THROTTLE_RATES가 정의되어 있어야 함)
        if self.action in {"messages", "messages_cursor", "messages_around"}:
            self.throttle_scope = "chat_messages"
        elif self.action == "search_messages":
            self.throttle_scope = "chat_search"
        else:
            self.throttle_scope = None
        throttles = super().get_throttles()
        return throttles

    def get_queryset(self):
        user = self.request.user
        queryset = ChatRoom.objects.all()
        
        # 1. 접근 권한(participants, dept_code 등) 체크
        queryset = queryset.filter(accessible_rooms_query(user))

        if user.is_authenticated:
            # 2. 나가기(Leave) 반영 로직 강화
            # DM(CASE) 또는 GROUP 방인 경우:
            # 반드시 내 UserState가 존재해야 하며, is_hidden=False여야 함.
            # (Channel 방은 UserState 없어도 됨)
            
            # [수정] 부정 조건(~Q) 대신 명시적 조건 사용 (데이터 오염 방지)
            non_chat_rooms = Q(room_type=ChatRoom.ROOM_TYPE_CHANNEL)
            
            active_chat_rooms = Q(
                room_type__in=[ChatRoom.ROOM_TYPE_CASE, ChatRoom.ROOM_TYPE_GROUP],
                user_states__user=user,
                user_states__is_hidden=False
            )
            
            queryset = queryset.filter(non_chat_rooms | active_chat_rooms).distinct()
            
            # 중복 DM 제거 로직
            queryset = filter_dm_rooms_for_user(queryset, user)

        state_qs = ChatRoomUserState.objects.filter(user=user, room=OuterRef("pk"))
        last_read_subquery = Subquery(
            state_qs.values("last_read_at")[:1],
            output_field=DateTimeField(),
        )
        cleared_subquery = Subquery(
            state_qs.values("cleared_at")[:1],
            output_field=DateTimeField(),
        )
        if getattr(settings, "USE_TZ", False):
            min_timestamp = timezone.make_aware(datetime(1970, 1, 1))
        else:
            min_timestamp = datetime(1970, 1, 1)
        visible_since = Coalesce(cleared_subquery, Value(min_timestamp))
        last_message_qs = Message.objects.filter(
            room=OuterRef("pk"),
            timestamp__gt=visible_since,
        ).order_by("-id")
        last_message_ts = Subquery(
            last_message_qs.values("timestamp")[:1],
            output_field=DateTimeField(),
        )
        unread_qs = (
            Notification.objects.filter(
                user=user, room=OuterRef("pk"), is_read=False
            )
            .values("room")
            .annotate(count=Count("id"))
            .values("count")
        )

        queryset = queryset.annotate(
            last_message_id=Subquery(last_message_qs.values("id")[:1]),
            last_message_content=Subquery(last_message_qs.values("content")[:1]),
            last_message_timestamp=last_message_ts,
            last_message_type=Subquery(last_message_qs.values("message_type")[:1]),
            last_message_attachment_name=Subquery(
                last_message_qs.values("attachment_name")[:1]
            ),
            last_message_attachment_type=Subquery(
                last_message_qs.values("attachment_type")[:1]
            ),
            last_message_sender_id=Subquery(last_message_qs.values("sender_id")[:1]),
            last_message_sender_username=Subquery(
                last_message_qs.values("sender__username")[:1]
            ),
            last_read_at=last_read_subquery,
            unread_count=Coalesce(
                Subquery(unread_qs, output_field=IntegerField()),
                Value(0),
            ),
            last_activity_at=Coalesce(last_message_ts, F("created_at")),
        ).order_by("-last_activity_at", "-id")

        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        rooms = list(queryset)
        filtered = []
        seen_dm_pairs = set()
        for room in rooms:


            if room.room_type == ChatRoom.ROOM_TYPE_CASE and (room.case_key or "").startswith("dm:"):
                dm_ids = sorted(dm_participant_ids(room))
                if len(dm_ids) != 2:
                    continue
                pair_key = f"{dm_ids[0]}:{dm_ids[1]}"
                if pair_key in seen_dm_pairs:
                    continue
                seen_dm_pairs.add(pair_key)
            filtered.append(room)
        serializer = self.get_serializer(filtered, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        if getattr(settings, "OPEN_CHAT_ACCESS", False):
            serializer.save()
            return
        user = self.request.user
        room_type = serializer.validated_data["room_type"]
        if room_type == ChatRoom.ROOM_TYPE_CHANNEL:
            if user.is_superuser:
                serializer.save()
                return
            channel_kind = serializer.validated_data["channel_kind"]
            dept_code = serializer.validated_data.get("dept_code")
            shift_code = serializer.validated_data.get("shift_code")
            if channel_kind == ChatRoom.CHANNEL_KIND_DEPT:
                if not user_has_department_access(user, dept_code):
                    raise PermissionDenied("Not allowed to create this department channel.")
            elif channel_kind == ChatRoom.CHANNEL_KIND_SHIFT:
                if not user_has_shift_access(user, dept_code, shift_code):
                    raise PermissionDenied("Not allowed to create this shift channel.")
        serializer.save()

    def _cleared_at_for_user(self, user, room):
        state = (
            ChatRoomUserState.objects.filter(user=user, room=room)
            .only("cleared_at")
            .first()
        )
        return state.cleared_at if state else None

    def _with_message_counts(self, queryset):
        return queryset.annotate(
            unread_count=Count(
                "chat_notifications",
                filter=Q(chat_notifications__is_read=False)
                & ~Q(chat_notifications__user_id=F("sender_id")),
            ),
            read_count=Count(
                "chat_notifications",
                filter=Q(chat_notifications__is_read=True)
                & ~Q(chat_notifications__user_id=F("sender_id")),
            ),
        )

    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None):
        room = self.get_object()
        if not getattr(settings, "OPEN_CHAT_ACCESS", False) and not user_has_room_access(
            request.user, room
        ):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        if request.method == "GET":
            limit_raw = request.query_params.get("limit", "50")
            before_raw = request.query_params.get("before")
            mark_read = request.query_params.get("mark_read", "1") != "0"
            try:
                limit = int(limit_raw)
            except ValueError:
                return Response({"detail": "Invalid limit."}, status=status.HTTP_400_BAD_REQUEST)
            max_limit = getattr(settings, "MESSAGE_PAGE_MAX", 200)
            limit = max(1, min(limit, max_limit))

            queryset = room.messages.select_related(
                "sender", "sender__presence"
            ).order_by("-id")
            queryset = self._with_message_counts(queryset)
            cleared_at = self._cleared_at_for_user(request.user, room)
            if cleared_at:
                queryset = queryset.filter(timestamp__gt=cleared_at)
            if before_raw:
                try:
                    before_id = int(before_raw)
                except ValueError:
                    return Response({"detail": "Invalid before id."}, status=status.HTTP_400_BAD_REQUEST)
                queryset = queryset.filter(id__lt=before_id)

            messages = list(queryset[:limit])
            messages.reverse()
            serializer = MessageSerializer(messages, many=True, context={"request": request})
            if mark_read:
                ChatRoomUserState.objects.update_or_create(
                    user=request.user,
                    room=room,
                    defaults={
                        "is_hidden": False,
                        "hidden_at": None,
                        "last_read_at": timezone.now(),
                    },
                )
                updated_count = Notification.objects.filter(
                    user=request.user, room=room, is_read=False
                ).update(is_read=True)
                
                self._broadcast_room_read(request.user, room)
                
                # 상대방에게도 읽음 알림 전송
                if updated_count > 0:
                    channel_layer = get_channel_layer()
                    if channel_layer:
                        try:
                            group_name = f"chat_{room.name.replace(':', '_')}"
                            async_to_sync(channel_layer.group_send)(
                                group_name,
                                {
                                    "type": "message_read_status",
                                    "user_id": request.user.id,
                                    "room_id": room.id,
                                },
                            )
                        except Exception:
                            pass

            return Response(serializer.data)

        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content = serializer.validated_data.get("content", "").strip()
        attachment = serializer.validated_data.get("attachment")
        attachment_id = serializer.validated_data.get("attachment_id")
        if attachment and attachment_id:
            raise ValidationError("Provide attachment_id or attachment, not both.")
        if not content and not attachment and not attachment_id:
            raise ValidationError("Content or attachment required.")

        message_type = serializer.validated_data.get("message_type", "text")
        attachment_record = None
        if attachment_id:
            attachment_record = (
                ChatAttachment.objects.filter(
                    id=attachment_id,
                    uploaded_by=request.user,
                    is_used=False,
                )
                .only("id", "file", "original_name", "content_type", "size")
                .first()
            )
            if not attachment_record:
                raise ValidationError("Attachment not found or already used.")
            message_type = "file"
        elif attachment:
            error = self._validate_attachment(attachment)
            if error:
                return Response({"detail": error}, status=400)
            message_type = "file"

        message = Message.objects.create(
            room=room,
            sender=request.user,
            content=content,
            message_type=message_type,
        )

        if attachment_record and attachment_record.file:
            message.attachment = attachment_record.file
            message.attachment_name = attachment_record.original_name
            message.attachment_type = attachment_record.content_type or ""
            message.attachment_size = attachment_record.size
            message.save(
                update_fields=[
                    "attachment",
                    "attachment_name",
                    "attachment_type",
                    "attachment_size",
                ]
            )
            attachment_record.is_used = True
            attachment_record.used_at = timezone.now()
            attachment_record.save(update_fields=["is_used", "used_at"])
        elif isinstance(attachment, UploadedFile):
            message.attachment = attachment
            message.attachment_name = attachment.name
            message.attachment_type = attachment.content_type or ""
            message.attachment_size = attachment.size
            message.save(
                update_fields=[
                    "attachment",
                    "attachment_name",
                    "attachment_type",
                    "attachment_size",
                ]
            )

        ChatRoom.objects.filter(id=room.id).update(last_message_at=message.timestamp)
        ChatRoomUserState.objects.update_or_create(
            user=request.user,
            room=room,
            defaults={
                "is_hidden": False,
                "hidden_at": None,
                "last_read_at": message.timestamp,
            },
        )
        self._create_notifications(message)
        self._broadcast_message(room, message, request)
        return Response(
            MessageSerializer(message, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        """대화방 읽음 처리 (카카오톡 방식)"""
        room = self.get_object()
        if not getattr(settings, "OPEN_CHAT_ACCESS", False) and not user_has_room_access(
            request.user, room
        ):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        
        # 읽음 처리
        ChatRoomUserState.objects.update_or_create(
            user=request.user,
            room=room,
            defaults={
                "is_hidden": False,
                "hidden_at": None,
                "last_read_at": timezone.now(),
            },
        )
        # 읽음 처리 전에 읽지 않은 메시지 ID 목록 가져오기 (브로드캐스트용)
        unread_notifications = Notification.objects.filter(
            user=request.user, room=room, is_read=False
        ).select_related('message').values_list('message_id', flat=True)
        unread_message_ids = list(unread_notifications)
        
        updated_count = Notification.objects.filter(
            user=request.user, room=room, is_read=False
        ).update(is_read=True)
        
        # WebSocket 브로드캐스트 (읽음 처리된 메시지 ID 목록 포함)
        if updated_count > 0:
            channel_layer = get_channel_layer()
            if channel_layer:
                try:
                    group_name = f"chat_{room.name.replace(':', '_')}"
                    # 각 메시지별로 읽음 상태 이벤트 전송
                    for message_id in unread_message_ids:
                        async_to_sync(channel_layer.group_send)(
                            group_name,
                            {
                                "type": "message_read_status",
                                "user_id": request.user.id,
                                "room_id": room.id,
                                "message_id": message_id,
                            },
                        )
                    # 전체 읽음 상태도 브로드캐스트 (fallback)
                    async_to_sync(channel_layer.group_send)(
                        group_name,
                        {
                            "type": "message_read_status",
                            "user_id": request.user.id,
                            "room_id": room.id,
                        },
                    )
                except Exception as e:
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.error(f"WebSocket 브로드캐스트 실패: {e}")
        
        return Response({"detail": "Marked as read", "updated_count": updated_count})
    
    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        """채팅방 나가기"""
        room = self.get_object()
        now = timezone.now()
        
        # [Fix] 중복된 DM 방(버그로 생성된)이 있을 경우 일괄 처리
        target_rooms = [room]
        if room.room_type == ChatRoom.ROOM_TYPE_CASE and room.case_key:
            duplicate_rooms = ChatRoom.objects.filter(
                room_type=ChatRoom.ROOM_TYPE_CASE, 
                case_key=room.case_key
            ).exclude(id=room.id)
            if duplicate_rooms.exists():
                target_rooms.extend(list(duplicate_rooms))
        
        for r in target_rooms:
            # [Fix] cleared_at 설정으로 변경 (과거 메시지 숨김)
            # - is_hidden=True: 방 목록에서 숨김
            # - cleared_at: 이 시각 이전 메시지는 안 보임
            # 상대방이 새 메시지 보내면:
            # → UserState는 다시 활성화(is_hidden=False)되지만
            # → cleared_at 이후 메시지만 보이므로 과거 기록은 안 보임
            ChatRoomUserState.objects.update_or_create(
                user=request.user,
                room=r,
                defaults={
                    "is_hidden": True,
                    "hidden_at": now,
                    "cleared_at": now,  # ← 핵심: 이 시점 이전 메시지 숨김
                },
            )
            r.participants.remove(request.user)
            
        return Response(status=status.HTTP_204_NO_CONTENT)
    
    @action(detail=True, methods=["get"], url_path="messages/cursor")
    def messages_cursor(self, request, pk=None):
        room = self.get_object()
        if not getattr(settings, "OPEN_CHAT_ACCESS", False) and not user_has_room_access(
            request.user, room
        ):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        message_id_raw = request.query_params.get("message_id")
        if not message_id_raw:
            return Response({"detail": "message_id is required."}, status=400)
        try:
            message_id = int(message_id_raw)
        except ValueError:
            return Response({"detail": "Invalid message_id."}, status=400)

        limit_raw = request.query_params.get("limit", "50")
        try:
            limit = int(limit_raw)
        except ValueError:
            return Response({"detail": "Invalid limit."}, status=status.HTTP_400_BAD_REQUEST)
        max_limit = getattr(settings, "MESSAGE_PAGE_MAX", 200)
        limit = max(3, min(limit, max_limit))
        before_count = (limit - 1) // 2
        after_count = limit - 1 - before_count

        base_qs = room.messages.select_related("sender", "sender__presence")
        base_qs = self._with_message_counts(base_qs)
        cleared_at = self._cleared_at_for_user(request.user, room)
        if cleared_at:
            base_qs = base_qs.filter(timestamp__gt=cleared_at)
        target = base_qs.filter(id=message_id).first()
        if not target:
            return Response({"detail": "Message not found."}, status=404)

        before = list(
            base_qs.filter(id__lt=message_id).order_by("-id")[:before_count]
        )
        after = list(
            base_qs.filter(id__gt=message_id).order_by("id")[:after_count]
        )

        messages = list(reversed(before)) + [target] + after
        serializer = MessageSerializer(messages, many=True, context={"request": request})

        ChatRoomUserState.objects.update_or_create(
            user=request.user,
            room=room,
            defaults={
                "is_hidden": False,
                "hidden_at": None,
                "last_read_at": timezone.now(),
            },
        )
        Notification.objects.filter(user=request.user, room=room, is_read=False).update(
            is_read=True
        )
        self._broadcast_room_read(request.user, room)

        return Response({"target_id": target.id, "results": serializer.data})

    @action(detail=False, methods=["get"], url_path="search")
    def search_messages(self, request):
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response([])
        user = request.user
        if getattr(settings, "USE_TZ", False):
            min_timestamp = timezone.make_aware(datetime(1970, 1, 1))
        else:
            min_timestamp = datetime(1970, 1, 1)
        rooms = ChatRoom.objects.all()
        if user.is_authenticated:
            rooms = rooms.exclude(user_states__user=user, user_states__is_hidden=True)
        rooms = filter_dm_rooms_for_user(rooms, user)
        if not getattr(settings, "OPEN_CHAT_ACCESS", False) and not user.is_superuser:
            rooms = rooms.filter(accessible_rooms_query(user)).distinct()

        limit_raw = request.query_params.get("limit", "50")
        try:
            limit = int(limit_raw)
        except ValueError:
            return Response({"detail": "Invalid limit."}, status=status.HTTP_400_BAD_REQUEST)
        max_limit = getattr(settings, "MESSAGE_PAGE_MAX", 200)
        limit = max(1, min(limit, max_limit))

        room_id = request.query_params.get("room_id")
        messages = Message.objects.filter(
            room__in=rooms
        ).filter(
            Q(content__icontains=query) | Q(attachment_name__icontains=query)
        )
        if room_id:
            try:
                room_id_int = int(room_id)
            except ValueError:
                return Response({"detail": "Invalid room_id."}, status=status.HTTP_400_BAD_REQUEST)
            messages = messages.filter(room_id=room_id_int)
            room_obj = ChatRoom.objects.filter(id=room_id_int).first()
            if not room_obj:
                return Response({"detail": "Room not found."}, status=404)
            if not getattr(settings, "OPEN_CHAT_ACCESS", False) and not user_has_room_access(
                user, room_obj
            ):
                return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
            cleared_at = self._cleared_at_for_user(user, room_obj)
            if cleared_at:
                messages = messages.filter(timestamp__gt=cleared_at)
        else:
            cleared_subquery = Subquery(
                ChatRoomUserState.objects.filter(
                    user=user, room_id=OuterRef("room_id")
                ).values("cleared_at")[:1],
                output_field=DateTimeField(),
            )
            visible_since = Coalesce(cleared_subquery, Value(min_timestamp))
            messages = messages.annotate(cleared_at=cleared_subquery).filter(
                timestamp__gt=visible_since
            )

        messages = self._with_message_counts(messages)
        messages = messages.select_related("sender", "sender__presence", "room").order_by(
            "-timestamp"
        )[:limit]
        serializer = MessageSerializer(messages, many=True, context={"request": request})
        return Response(serializer.data)

    def _broadcast_message(self, room, message, request):
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        group_name = f"chat_{room.name.replace(':', '_')}"
        payload = MessageSerializer(message, context={"request": request}).data
        try:
            async_to_sync(channel_layer.group_send)(
                group_name,
                {"type": "chat_message", "message": payload},
            )
        except Exception:
            logger.exception("Failed to broadcast message to %s", group_name)

    def _broadcast_notification(self, user_id, payload):
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        try:
            async_to_sync(channel_layer.group_send)(
                f"notify_user_{user_id}",
                {"type": "notify_message", "data": payload},
            )
        except Exception:
            logger.exception("Failed to broadcast notification to user %s", user_id)

    def _broadcast_room_read(self, user, room):
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        try:
            async_to_sync(channel_layer.group_send)(
                f"notify_user_{user.id}",
                {
                    "type": "notify_read",
                    "data": {"room_id": room.id, "room_name": room.name},
                },
            )
        except Exception:
            logger.exception("Failed to broadcast read for room %s", room.id)

    def _validate_attachment(self, attachment):
        return validate_attachment(attachment)

    def _create_notifications(self, message):
        if message.message_type == "system":
            return
        room = message.room
        sender_id = message.sender_id
        participant_ids = set(
            room.participants.values_list("id", flat=True)
        )
        visible_state_ids = set(
            room.user_states.filter(is_hidden=False).values_list("user_id", flat=True)
        )
        recipients = participant_ids | visible_state_ids | dm_participant_ids(room)
        recipients.discard(sender_id)
        
        if not recipients:
            return
        if room.room_type == ChatRoom.ROOM_TYPE_CASE and (room.case_key or "").startswith("dm:"):
            # DM 메시지 전송 시 나간 사용자도 UserState 복구 (방은 다시 보이게)
            # 알림도 생성되므로 보낸 사람의 메시지에 "1"이 표시됨
            all_dm_recipients = dm_participant_ids(room)
            all_dm_recipients.discard(sender_id)
            
            for recipient_id in all_dm_recipients:
                state, created = ChatRoomUserState.objects.get_or_create(
                    room=room,
                    user_id=recipient_id,
                    defaults={
                        "is_hidden": False,
                        "hidden_at": None,
                        "cleared_at": timezone.now(), # 과거 기록 안 보이게 처리
                    }
                )
                # 이미 존재하는 state면 is_hidden=False로 복구 (cleared_at은 유지)
                if not created and state.is_hidden:
                    state.is_hidden = False
                    state.hidden_at = None
                    state.save(update_fields=['is_hidden', 'hidden_at'])
            
            # recipients에 나간 사용자도 포함 (알림 생성을 위해)
            recipients = all_dm_recipients
        if room.room_type in (ChatRoom.ROOM_TYPE_CASE, ChatRoom.ROOM_TYPE_GROUP):
            for recipient_id in recipients:
                state, created = ChatRoomUserState.objects.get_or_create(
                    room=room,
                    user_id=recipient_id,
                    defaults={
                        "is_hidden": False,
                        "hidden_at": None,
                        "cleared_at": message.timestamp,
                    },
                )
                if not created and state.is_hidden:
                    state.is_hidden = False
                    state.hidden_at = None
                    state.save(update_fields=["is_hidden", "hidden_at"])
        notifications = [
            Notification(user_id=user_id, room=room, message=message)
            for user_id in recipients
        ]
        Notification.objects.bulk_create(notifications, ignore_conflicts=True)
        unread_counts = {
            row["user_id"]: row["count"]
            for row in Notification.objects.filter(
                user_id__in=recipients, room=room, is_read=False
            )
            .values("user_id")
            .annotate(count=Count("id"))
        }
        payload = MessageSerializer(
            message, context={"request": self.request}
        ).data
        for user_id in recipients:
            self._broadcast_notification(
                user_id,
                {
                    "room_id": room.id,
                    "room_name": room.name,
                    "message": payload,
                    "delta": 1,
                    "unread_count": unread_counts.get(user_id, 0),
                },
            )

    def destroy(self, request, *args, **kwargs):
        room = self.get_object()
        user = request.user
        if not user.is_authenticated:
            raise PermissionDenied("Authentication required.")
        if user.is_superuser and request.query_params.get("hard") == "1":
            return super().destroy(request, *args, **kwargs)
        now = timezone.now()
        ChatRoomUserState.objects.update_or_create(
            user=user,
            room=room,
            defaults={
                "is_hidden": True,
                "hidden_at": now,
                "cleared_at": now,
                "last_read_at": now,
            },
        )
        Notification.objects.filter(user=user, room=room, is_read=False).update(
            is_read=True
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


def home(request):
    return render(request, "chat/home.html")


def healthz(request):
    db_ok = True
    redis_ok = True
    redis_mode = "in-memory"

    try:
        connections["default"].cursor().execute("SELECT 1")
    except Exception:
        db_ok = False

    redis_url = getattr(settings, "REDIS_URL", "")
    if redis_url:
        redis_mode = "redis"
        try:
            import redis as redis_lib

            redis_lib.Redis.from_url(redis_url).ping()
        except Exception:
            redis_ok = False
    status = "ok" if db_ok and redis_ok else "degraded"
    status_code = 200 if status == "ok" else 503
    return JsonResponse(
        {
            "status": status,
            "db": db_ok,
            "redis": redis_ok,
            "redis_mode": redis_mode,
        },
        status=status_code,
    )


