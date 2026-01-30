import re
import uuid

from django.contrib.auth import get_user_model
from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import ChatAttachment, ChatRoom, DepartmentMembership, Message, Notification


User = get_user_model()


class UserSummarySerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen_at = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "username", "name", "role", "department", "is_online", "last_seen_at")

    def get_name(self, obj):
        # 한국식 이름 형식: 성+이름 (예: "박철순", "노건우")
        # 모든 경우를 처리하여 "성+이름" 형식으로 변환
        
        # 1. first_name과 last_name 필드 직접 사용
        first_name_raw = getattr(obj, 'first_name', '') or ''
        last_name_raw = getattr(obj, 'last_name', '') or ''
        
        first_name = first_name_raw.strip() if first_name_raw else ''
        last_name = last_name_raw.strip() if last_name_raw else ''
        
        # 2. first_name에 "철순 박" 형식으로 저장된 경우 처리
        if first_name and not last_name:
            parts = first_name.split()
            if len(parts) >= 2:
                # "철순 박" -> "박철순" (마지막이 성)
                # "건우 노" -> "노건우"
                return f"{parts[-1]}{''.join(parts[:-1])}"
        
        # 3. last_name에 "박" 형식으로 저장된 경우 처리
        if last_name and not first_name:
            parts = last_name.split()
            if len(parts) >= 2:
                # "박 철순" -> "박철순"
                return f"{parts[0]}{''.join(parts[1:])}"
        
        # 4. first_name과 last_name이 모두 있는 경우
        if last_name and first_name:
            # "건우" + "노" -> "노건우" (성+이름)
            # "철순" + "박" -> "박철순"
            return f"{last_name}{first_name}"
        elif last_name:
            return last_name
        elif first_name:
            return first_name
        
        # 5. get_full_name() 사용 (fallback)
        full_name = obj.get_full_name()
        if full_name:
            full_name = full_name.strip()
            if not full_name:
                return obj.get_username() or str(obj.id)
            
            # 공백으로 분리하여 순서 바꾸기
            parts = full_name.split()
            if len(parts) == 2:
                # "건우 노" -> "노건우" (마지막이 성)
                # "철순 박" -> "박철순"
                return f"{parts[1]}{parts[0]}"
            elif len(parts) > 2:
                # 여러 단어가 있는 경우 마지막이 성일 가능성
                # "건우 노" 형식이면 마지막이 성
                return f"{parts[-1]}{''.join(parts[:-1])}"
            return full_name
        
        # 6. 모두 없으면 username 반환
        return obj.get_username() or str(obj.id)

    def get_role(self, obj):
        # department 필드 사용
        if hasattr(obj, "department"):
            dept = getattr(obj, "department", "")
            return dept if dept else ""
        return getattr(obj, "role", "")

    def get_is_online(self, obj):
        presence = getattr(obj, "presence", None)
        if not presence:
            return False
        # active_connections가 0보다 크고 is_online이 True일 때만 온라인으로 표시
        active_connections = getattr(presence, "active_connections", 0)
        is_online = getattr(presence, "is_online", False)
        return bool(active_connections > 0 and is_online)

    def get_last_seen_at(self, obj):
        presence = getattr(obj, "presence", None)
        last_seen = getattr(presence, "last_seen_at", None)
        if not last_seen:
            return None
        # USE_TZ=False일 때 timezone.localtime()은 에러를 유발할 수 있으므로 isoformat()만 사용
        if settings.USE_TZ:
            return timezone.localtime(last_seen).isoformat()
        return last_seen.isoformat()

    def get_department(self, obj):
        # 1. DepartmentMembership 테이블에서 가져오기
        membership = DepartmentMembership.objects.filter(user=obj, is_active=True).first()
        if membership:
            return membership.dept_code
    
        # 2. department 속성이 있으면 사용 (views.py의 extra()로 추가된 경우)
        if hasattr(obj, "department"):
            dept = getattr(obj, "department", "")
            if dept:
                return dept
    
        return ""


class ChatRoomSerializer(serializers.ModelSerializer):
    participant_count = serializers.IntegerField(source="participants.count", read_only=True)
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.IntegerField(read_only=True, default=0)
    last_read_at = serializers.DateTimeField(read_only=True, allow_null=True)
    participants = UserSummarySerializer(many=True, read_only=True)

    class Meta:
        model = ChatRoom
        fields = (
            "id",
            "name",
            "room_type",
            "channel_kind",
            "case_key",
            "dept_code",
            "shift_code",
            "created_at",
            "last_message_at",
            "participant_count",
            "participants",
            "participant_ids",
            "last_message",
            "unread_count",
            "last_read_at",
        )
        read_only_fields = (
            "id",
            "name",
            "created_at",
            "last_message_at",
            "participant_count",
            "last_message",
            "unread_count",
            "last_read_at",
        )

    def get_last_message(self, obj):
        message_id = getattr(obj, "last_message_id", None)
        if not message_id:
            return None
        sender_id = getattr(obj, "last_message_sender_id", None)
        sender_username = getattr(obj, "last_message_sender_username", None)
        sender_payload = None
        if sender_id:
            sender_payload = {
                "id": sender_id,
                "username": sender_username or "",
            }
        return {
            "id": message_id,
            "content": getattr(obj, "last_message_content", ""),
            "message_type": getattr(obj, "last_message_type", "text"),
            "attachment_name": getattr(obj, "last_message_attachment_name", ""),
            "attachment_type": getattr(obj, "last_message_attachment_type", ""),
            "timestamp": getattr(obj, "last_message_timestamp", None),
            "sender": sender_payload,
        }

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        room_type = attrs.get("room_type", getattr(instance, "room_type", None))
        channel_kind = attrs.get("channel_kind", getattr(instance, "channel_kind", None))
        case_key = attrs.get("case_key", getattr(instance, "case_key", None))
        dept_code = attrs.get("dept_code", getattr(instance, "dept_code", None))
        shift_code = attrs.get("shift_code", getattr(instance, "shift_code", None))
        participant_ids = attrs.get("participant_ids")

        if instance and "room_type" in attrs and attrs["room_type"] != instance.room_type:
            raise serializers.ValidationError("room_type cannot be changed.")

        if room_type == ChatRoom.ROOM_TYPE_CASE:
            if not case_key:
                raise serializers.ValidationError("case_key is required for case rooms.")
            if not re.fullmatch(r"[A-Za-z0-9_:-]+", case_key):
                raise serializers.ValidationError("case_key has invalid characters.")
            attrs["channel_kind"] = None
            attrs["dept_code"] = ""
            attrs["shift_code"] = ""
            attrs["name"] = ChatRoom.build_name(
                room_type=ChatRoom.ROOM_TYPE_CASE, case_key=case_key
            )
        elif room_type == ChatRoom.ROOM_TYPE_CHANNEL:
            if not channel_kind:
                raise serializers.ValidationError("channel_kind is required for channel rooms.")
            if channel_kind == ChatRoom.CHANNEL_KIND_DEPT:
                if not dept_code:
                    raise serializers.ValidationError("dept_code is required for dept channels.")
                if not re.fullmatch(r"[A-Za-z0-9_-]+", dept_code):
                    raise serializers.ValidationError("dept_code has invalid characters.")
                attrs["shift_code"] = ""
                attrs["name"] = ChatRoom.build_name(
                    room_type=ChatRoom.ROOM_TYPE_CHANNEL,
                    channel_kind=ChatRoom.CHANNEL_KIND_DEPT,
                    dept_code=dept_code,
                )
            elif channel_kind == ChatRoom.CHANNEL_KIND_SHIFT:
                if not dept_code or not shift_code:
                    raise serializers.ValidationError(
                        "dept_code and shift_code are required for shift channels."
                    )
                if not re.fullmatch(r"[A-Za-z0-9_-]+", dept_code):
                    raise serializers.ValidationError("dept_code has invalid characters.")
                if not re.fullmatch(r"[A-Za-z0-9_-]+", shift_code):
                    raise serializers.ValidationError("shift_code has invalid characters.")
                attrs["name"] = ChatRoom.build_name(
                    room_type=ChatRoom.ROOM_TYPE_CHANNEL,
                    channel_kind=ChatRoom.CHANNEL_KIND_SHIFT,
                    dept_code=dept_code,
                    shift_code=shift_code,
                )
            else:
                raise serializers.ValidationError("Invalid channel_kind.")
            attrs["case_key"] = ""
        elif room_type == ChatRoom.ROOM_TYPE_GROUP:
            attrs["channel_kind"] = None
            attrs["case_key"] = ""
            attrs["dept_code"] = ""
            attrs["shift_code"] = ""
            attrs["name"] = ChatRoom.build_name(
                room_type=ChatRoom.ROOM_TYPE_GROUP,
                group_uuid=str(uuid.uuid4())
            )
        else:
            raise serializers.ValidationError("room_type must be case, channel, or group.")

        if participant_ids and room_type not in (ChatRoom.ROOM_TYPE_CASE, ChatRoom.ROOM_TYPE_GROUP):
            raise serializers.ValidationError(
                "participant_ids can only be set for case or group rooms."
            )

        return attrs

    def create(self, validated_data):
        participant_ids = validated_data.pop("participant_ids", [])
        
        # [수정] DM 방 중복 생성 방지
        room_type = validated_data.get("room_type")
        case_key = validated_data.get("case_key")
        room = None
        if room_type == ChatRoom.ROOM_TYPE_CASE and case_key and case_key.startswith("dm:"):
            room = ChatRoom.objects.filter(case_key=case_key).first()
            
        if not room:
            room = super().create(validated_data)

        if room.room_type in (ChatRoom.ROOM_TYPE_CASE, ChatRoom.ROOM_TYPE_GROUP):
            request = self.context.get("request")
            # 1. 생성자 추가
            if request and request.user and request.user.is_authenticated:
                room.participants.add(request.user)
                # 상태 생성 (get_or_create: 없으면 새로 만들면서 cleared_at 설정)
                from .models import ChatRoomUserState
                ChatRoomUserState.objects.get_or_create(
                    user=request.user, 
                    room=room,
                    defaults={"cleared_at": timezone.now()}
                )

            # 2. 참여자 목록 추가
            if participant_ids:
                users = User.objects.filter(id__in=participant_ids)
                room.participants.add(*users)
                from .models import ChatRoomUserState
                for u in users:
                    ChatRoomUserState.objects.get_or_create(
                        user=u, 
                        room=room,
                        defaults={"cleared_at": timezone.now()}
                    )

        return room

    def update(self, instance, validated_data):
        participant_ids = validated_data.pop("participant_ids", None)
        room = super().update(instance, validated_data)
        if participant_ids is not None and room.room_type == ChatRoom.ROOM_TYPE_CASE:
            room.participants.set(User.objects.filter(id__in=participant_ids))
        return room


class ChatAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ChatAttachment
        fields = (
            "id",
            "url",
            "original_name",
            "content_type",
            "size",
            "created_at",
            "is_used",
        )
        read_only_fields = fields

    def get_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get("request")
        url = obj.file.url
        if request is None:
            return url
        return request.build_absolute_uri(url)


class MessageSerializer(serializers.ModelSerializer):
    sender = UserSummarySerializer(read_only=True)
    room_id = serializers.IntegerField(source="room.id", read_only=True)
    room_name = serializers.CharField(source="room.name", read_only=True)
    attachment_url = serializers.SerializerMethodField()
    read_by_count = serializers.SerializerMethodField()
    is_read_by_all = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            "id",
            "room_id",
            "room_name",
            "sender",
            "content",
            "message_type",
            "attachment_url",
            "attachment_name",
            "attachment_type",
            "attachment_size",
            "timestamp",
            "is_read",
            "read_by_count",
            "is_read_by_all",
            "unread_count",
        )
        read_only_fields = (
            "id",
            "room_id",
            "room_name",
            "sender",
            "timestamp",
            "is_read",
            "attachment_url",
            "attachment_name",
            "attachment_type",
            "attachment_size",
            "read_by_count",
            "is_read_by_all",
            "unread_count",
        )

    def get_unread_count(self, obj):
        """안 읽은 사람 수"""
        annotated = getattr(obj, "unread_count", None)
        if annotated is not None:
            return annotated
        return Notification.objects.filter(
            message=obj,
            is_read=False
        ).exclude(user_id=obj.sender_id).count()

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return None
        request = self.context.get("request")
        url = obj.attachment.url
        if request is None:
            return url
        return request.build_absolute_uri(url)

    def get_read_by_count(self, obj):
        """이 메시지를 읽은 사람 수 (발신자 제외)"""
        from .room_utils import dm_participant_ids
        
        room = obj.room
        total_participants = set(room.participants.values_list("id", flat=True))
        total_participants |= dm_participant_ids(room)
        total_participants.discard(obj.sender_id)  # 발신자 제외
        
        if not total_participants:
            return 0
        
        # 이 메시지를 읽은 사람 수
        read_count = getattr(obj, "read_count", None)
        if read_count is None:
            read_count = Notification.objects.filter(
                message=obj,
                is_read=True
            ).exclude(user_id=obj.sender_id).count()
        
        return read_count

    def get_is_read_by_all(self, obj):
        """모든 참여자가 읽었는지 여부"""
        from .room_utils import dm_participant_ids
        
        room = obj.room
        total_participants = set(room.participants.values_list("id", flat=True))
        total_participants |= dm_participant_ids(room)
        total_participants.discard(obj.sender_id)  # 발신자 제외
        
        if not total_participants:
            return True  # 참여자가 없으면 True
        
        read_count = getattr(obj, "read_count", None)
        if read_count is None:
            read_count = Notification.objects.filter(
                message=obj,
                is_read=True
            ).exclude(user_id=obj.sender_id).count()
        
        return read_count >= len(total_participants)


class MessageCreateSerializer(serializers.Serializer):
    content = serializers.CharField(required=False, allow_blank=True)
    message_type = serializers.ChoiceField(choices=Message.MESSAGE_TYPE_CHOICES, default="text")
    attachment = serializers.FileField(required=False)
    attachment_id = serializers.IntegerField(required=False)


class NotificationSerializer(serializers.ModelSerializer):
    room_name = serializers.CharField(source="room.name", read_only=True)
    message = MessageSerializer(read_only=True)

    class Meta:
        model = Notification
        fields = (
            "id",
            "room",
            "room_name",
            "message",
            "is_read",
            "created_at",
        )
        read_only_fields = fields
