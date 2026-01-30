import json
import logging
from typing import List, Optional, Union

from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.layers import get_channel_layer
from django.conf import settings
from django.db.models import Count, F, Q
from django.utils import timezone

from .models import ChatRoom, ChatRoomUserState, Message, Notification, UserPresence
from .permissions import user_has_department_access, user_has_room_access, user_has_shift_access
from .room_utils import dm_participant_ids, dm_participant_ids_from_case_key, parse_room_name


def user_payload(user):
    # 한국식 이름 형식: 성+이름 (예: "박철순", "노건우")
    # serializers.py와 동일한 로직 사용
    first_name_raw = getattr(user, 'first_name', '') or ''
    last_name_raw = getattr(user, 'last_name', '') or ''
    
    first_name = first_name_raw.strip() if first_name_raw else ''
    last_name = last_name_raw.strip() if last_name_raw else ''
    
    # first_name에 "철순 박" 형식으로 저장된 경우 처리
    if first_name and not last_name:
        parts = first_name.split()
        if len(parts) >= 2:
            # "철순 박" -> "박철순" (마지막이 성)
            name = f"{parts[-1]}{''.join(parts[:-1])}"
        else:
            name = first_name
    elif last_name and not first_name:
        parts = last_name.split()
        if len(parts) >= 2:
            # "박 철순" -> "박철순"
            name = f"{parts[0]}{''.join(parts[1:])}"
        else:
            name = last_name
    elif last_name and first_name:
        # "건우" + "노" -> "노건우" (성+이름)
        name = f"{last_name}{first_name}"
    elif last_name:
        name = last_name
    elif first_name:
        name = first_name
    else:
        full_name = user.get_full_name()
        if full_name:
            parts = full_name.strip().split()
            if len(parts) == 2:
                # "건우 노" -> "노건우" (마지막이 성)
                name = f"{parts[1]}{parts[0]}"
            elif len(parts) > 2:
                # 여러 단어가 있는 경우 마지막이 성
                name = f"{parts[-1]}{''.join(parts[:-1])}"
            else:
                name = full_name
        else:
            name = user.get_username()
    
    return {
        "id": user.id,
        "username": user.get_username(),
        "name": name,
        "role": getattr(user, "role", ""),
    }


def serialize_message(message):
    return {
        "id": message.id,
        "room_id": message.room_id,
        "sender": user_payload(message.sender),
        "content": message.content,
        "message_type": message.message_type,
        "attachment_url": message.attachment.url if message.attachment else None,
        "attachment_name": message.attachment_name,
        "attachment_type": message.attachment_type,
        "attachment_size": message.attachment_size,
        "timestamp": message.timestamp.isoformat(),
        "is_read": message.is_read,
        # 읽음 상태는 API에서만 제공 (WebSocket은 기본 정보만)
        "read_by_count": 0,
        "is_read_by_all": False,
        "unread_count": getattr(message, "unread_cnt", getattr(message, "unread_count", 0)),
    }


def build_group_name(room_name):
    safe_name = room_name.replace(":", "_")
    return f"chat_{safe_name}"


def notification_group_name(user_id):
    return f"notify_user_{user_id}"


def send_notification_event(user_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            notification_group_name(user_id),
            {"type": "notify_message", "data": payload},
        )
    except Exception:
        return


def send_read_event(user_id, room):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            notification_group_name(user_id),
            {"type": "notify_read", "data": {"room_id": room.id, "room_name": room.name}},
        )
    except Exception:
        return


@database_sync_to_async
def get_room_by_name(room_name):
    try:
        return ChatRoom.objects.get(name=room_name)
    except ChatRoom.DoesNotExist:
        return None


@database_sync_to_async
def create_room_from_parsed(parsed):
    return ChatRoom.objects.create(
        name=parsed.name,
        room_type=parsed.room_type,
        channel_kind=parsed.channel_kind,
        case_key=parsed.case_key or "",
        dept_code=parsed.dept_code or "",
        shift_code=parsed.shift_code or "",
    )


@database_sync_to_async
def create_message(room, user, content, message_type):
    message = Message.objects.create(
        room=room, sender=user, content=content, message_type=message_type
    )
    ChatRoom.objects.filter(id=room.id).update(last_message_at=message.timestamp)
    ChatRoomUserState.objects.update_or_create(
        user=user,
        room=room,
        defaults={
            "is_hidden": False,
            "hidden_at": None,
            "last_read_at": message.timestamp,
        },
    )
    create_notifications(message)
    message.unread_cnt = Notification.objects.filter(message=message, is_read=False).exclude(user_id=user.id).count()
    return message


@database_sync_to_async
def get_recent_messages(room, user, limit):
    queryset = room.messages.select_related("sender").annotate(
        unread_cnt=Count("chat_notifications", filter=Q(chat_notifications__is_read=False))
    )
    state = (
        ChatRoomUserState.objects.filter(user=user, room=room)
        .only("cleared_at")
        .first()
    )
    if state and state.cleared_at:
        queryset = queryset.filter(timestamp__gt=state.cleared_at)
    queryset = queryset.order_by("-timestamp")[:limit]
    messages = list(queryset)
    messages.reverse()
    return [serialize_message(message) for message in messages]


@database_sync_to_async
def user_can_access_room(user, room):
    return user_has_room_access(user, room)


@database_sync_to_async
def is_room_hidden_by_user(user, room):
    """사용자가 이 방을 숨겼는지 확인"""
    try:
        state = ChatRoomUserState.objects.get(user=user, room=room)
        return state.is_hidden
    except ChatRoomUserState.DoesNotExist:
        return False


@database_sync_to_async
def set_room_visible(user, room):
    """방을 보이도록 설정 (새로 생성된 방에만 사용)"""
    ChatRoomUserState.objects.update_or_create(
        user=user,
        room=room,
        defaults={"is_hidden": False, "hidden_at": None},
    )


@database_sync_to_async
def mark_room_read(user, room, timestamp=None):
    ChatRoomUserState.objects.update_or_create(
        user=user,
        room=room,
        defaults={
            "is_hidden": False,
            "hidden_at": None,
            "last_read_at": timestamp or timezone.now(),
        },
    )
    # 읽음 처리
    updated_count = Notification.objects.filter(user=user, room=room, is_read=False).update(
        is_read=True
    )
    
    # 읽음 상태 변경 알림 전송
    send_read_event(user.id, room)
    
    # 방의 모든 사용자에게 읽음 상태 브로드캐스트
    if updated_count > 0:
        channel_layer = get_channel_layer()
        if channel_layer:
            try:
                group_name = build_group_name(room.name)
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {
                        "type": "message_read_status",
                        "user_id": user.id,
                        "room_id": room.id,
                    },
                )
            except Exception:
                pass


@database_sync_to_async
def mark_user_online(user):
    # USE_TZ=False인 경우 timezone.now()는 이미 naive임. 
    # 하지만 명확히 하기 위해 settings.USE_TZ 확인 로직 추가 가능 (현재는 기본 사용)
    now = timezone.now()
    UserPresence.objects.get_or_create(user=user)
    UserPresence.objects.filter(user=user).update(
        active_connections=F("active_connections") + 1,
        is_online=True,
        last_seen_at=now,
    )


@database_sync_to_async
def mark_user_offline(user):
    now = timezone.now()
    UserPresence.objects.get_or_create(user=user)
    UserPresence.objects.filter(user=user, active_connections__gt=0).update(
        active_connections=F("active_connections") - 1,
        last_seen_at=now,
    )
    presence = UserPresence.objects.get(user=user)
    if presence.active_connections <= 0:
        UserPresence.objects.filter(user=user).update(
            active_connections=0,
            is_online=False,
            last_seen_at=now,
        )
    else:
        UserPresence.objects.filter(user=user).update(
            is_online=True,
            last_seen_at=now,
        )


def create_notifications(message):
    if message.message_type == "system":
        return
    room = message.room
    sender_id = message.sender_id
    participant_ids = set(room.participants.values_list("id", flat=True))
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
            # 상태 복구 시, 새로 생성되는 경우엔 '과거 기록 리셋'을 위해 cleared_at을 현재 시간으로 설정
            state, created = ChatRoomUserState.objects.get_or_create(
                room=room, 
                user_id=recipient_id,
                defaults={
                    "is_hidden": False, 
                    "hidden_at": None,
                    "cleared_at": timezone.now() 
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
    Notification.objects.bulk_create(
        [
            Notification(user_id=user_id, room=room, message=message)
            for user_id in recipients
        ],
        ignore_conflicts=True,
    )
    unread_counts = {
        row["user_id"]: row["count"]
        for row in Notification.objects.filter(
            user_id__in=recipients, room=room, is_read=False
        )
        .values("user_id")
        .annotate(count=Count("id"))
    }
    payload = {
        "room_id": room.id,
        "room_name": room.name,
        "message": serialize_message(message),
        "delta": 1,
    }
    for user_id in recipients:
        send_notification_event(
            user_id,
            {
                **payload,
                "unread_count": unread_counts.get(user_id, 0),
            },
        )


@database_sync_to_async
def user_can_access_channel(user, channel_kind, dept_code, shift_code):
    if user.is_superuser:
        return True
    if channel_kind == ChatRoom.CHANNEL_KIND_DEPT:
        return user_has_department_access(user, dept_code)
    if channel_kind == ChatRoom.CHANNEL_KIND_SHIFT:
        return user_has_shift_access(user, dept_code, shift_code)
    return False


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or user.is_anonymous:
            logger.warning(f"WebSocket 연결 거부: 인증되지 않은 사용자")
            await self.close()
            return

        self.user = user
        await mark_user_online(self.user)
        self.room_name = self.scope["url_route"]["kwargs"]["room_name"]
        logger.info(f"WebSocket 연결 시도: user={self.user.id}, room={self.room_name}")
        try:
            parsed = parse_room_name(self.room_name)
        except ValueError as e:
            logger.error(f"WebSocket 연결 실패: room_name 파싱 오류 - {e}")
            await self.close()
            return
        dm_ids = dm_participant_ids_from_case_key(parsed.case_key or "")
        if dm_ids and self.user.id not in dm_ids:
            logger.warning(f"WebSocket 연결 거부: DM 참여자가 아님 - user={self.user.id}, dm_ids={dm_ids}")
            await self.close()
            return

        self.room_group_name = build_group_name(parsed.name)
        room = await get_room_by_name(parsed.name)

        room_was_created = False
        room_was_hidden = False
        if room is None:
            if not getattr(settings, "OPEN_CHAT_ACCESS", False) and parsed.room_type == ChatRoom.ROOM_TYPE_CASE:
                await self.close()
                return
            if not getattr(settings, "OPEN_CHAT_ACCESS", False):
                allowed = await user_can_access_channel(
                    self.user, parsed.channel_kind, parsed.dept_code, parsed.shift_code
                )
                if not allowed:
                    await self.close()
                    return
            room = await create_room_from_parsed(parsed)
            room_was_created = True
        else:
            if not getattr(settings, "OPEN_CHAT_ACCESS", False):
                allowed = await user_can_access_room(self.user, room)
                if not allowed:
                    await self.close()
                    return
            # 사용자가 나간 방(is_hidden=True)이더라도 WebSocket 연결은 허용
            # → 상대방이 메시지를 보내면 실시간으로 받을 수 있어야 함
            # → 메시지 수신 시 자동으로 is_hidden=False 처리됨 (create_notifications)
            is_hidden = await is_room_hidden_by_user(self.user, room)
            if is_hidden:
                room_was_hidden = True

        self.room = room
        # 새로 생성된 방은 자동으로 표시
        if room_was_created:
            await set_room_visible(self.user, self.room)
        # 나간 방은 연결은 허용하지만, 방 목록에는 안 보임
        # (상대방이 메시지 보내면 자동으로 복구됨)

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        logger.info(f"WebSocket 연결 성공: user={self.user.id}, room={self.room_name}")

        await self.send_history()
        # WebSocket 연결만으로는 읽음 처리하지 않음 (카카오톡 방식)
        # 실제로 메시지를 확인했을 때만 읽음 처리 (API 호출 또는 명시적 읽음 요청)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "user_join",
                "user": user_payload(self.user),
            },
        )

    async def disconnect(self, close_code):
        if hasattr(self, "room_group_name"):
            await self.channel_layer.group_discard(
                self.room_group_name, self.channel_name
            )
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "user_leave",
                    "user": user_payload(self.user),
                },
            )
        if hasattr(self, "user"):
            await mark_user_offline(self.user)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return

        try:
            payload = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON payload.")
            return

        event_type = payload.get("type", "chat_message")

        if event_type == "typing":
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "typing",
                    "user": user_payload(self.user),
                    "is_typing": bool(payload.get("is_typing", True)),
                },
            )
            return

        content = payload.get("content")
        if not content:
            await self.send_error("Message content is required.")
            return

        message_type = payload.get("message_type", "text")
        message = await create_message(self.room, self.user, content, message_type)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "chat_message",
                "message": serialize_message(message),
            },
        )

    async def chat_message(self, event):
        # 메시지 수신만으로는 읽음 처리하지 않음 (카카오톡 방식)
        msg_data = event["message"].copy()
        
        # [Fix] 현재 사용자 기준으로 unread_count 재계산
        message_id = msg_data.get("id")
        sender_id = msg_data.get("sender", {}).get("id")
        
        if message_id and self.user:
            # 내가 보낸 메시지: 다른 사람들의 안 읽은 수
            if sender_id == self.user.id:
                unread_cnt = await database_sync_to_async(
                    lambda: Notification.objects.filter(
                        message_id=message_id, is_read=False
                    ).exclude(user_id=self.user.id).count()
                )()
                msg_data["unread_count"] = unread_cnt
            else:
                # 남이 보낸 메시지: 내가 볼 때는 0으로 설정 (프론트에서 처리)
                msg_data["unread_count"] = msg_data.get("unread_count", 0)
        
        await self.send(
            text_data=json.dumps(
                {"type": "chat_message", "data": {"message": msg_data}}
            )
        )

    async def user_join(self, event):
        await self.send(
            text_data=json.dumps(
                {"type": "user_join", "data": {"user": event["user"]}}
            )
        )

    async def user_leave(self, event):
        await self.send(
            text_data=json.dumps(
                {"type": "user_leave", "data": {"user": event["user"]}}
            )
        )

    async def typing(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "typing",
                    "data": {
                        "user": event["user"],
                        "is_typing": event.get("is_typing", True),
                    },
                }
            )
        )

    async def send_history(self):
        limit = getattr(settings, "MESSAGE_HISTORY_LIMIT", 50)
        messages = await get_recent_messages(self.room, self.user, limit)
        await self.send(
            text_data=json.dumps(
                {"type": "message_history", "data": {"messages": messages}}
            )
        )

    async def message_read_status(self, event):
        """읽음 상태 변경 알림"""
        data = {
            "user_id": event["user_id"],
            "room_id": event["room_id"],
        }
        # message_id가 있으면 포함
        if "message_id" in event:
            data["message_id"] = event["message_id"]
        
        await self.send(
            text_data=json.dumps(
                {
                    "type": "message_read_status",
                    "data": data,
                }
            )
        )

    async def send_error(self, message):
        await self.send(
            text_data=json.dumps(
                {"type": "error", "data": {"error": message}}
            )
        )


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or user.is_anonymous:
            await self.close()
            return
        self.user = user
        self.group_name = notification_group_name(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(
                self.group_name, self.channel_name
            )

    async def notify_message(self, event):
        await self.send(
            text_data=json.dumps(
                {"type": "notify_message", "data": event["data"]}
            )
        )

    async def notify_read(self, event):
        await self.send(
            text_data=json.dumps(
                {"type": "notify_read", "data": event["data"]}
            )
        )
