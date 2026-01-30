from django.conf import settings
from django.db import models


class ChatRoom(models.Model):
    ROOM_TYPE_CASE = "case"
    ROOM_TYPE_CHANNEL = "channel"
    ROOM_TYPE_GROUP = "group"

    CHANNEL_KIND_DEPT = "dept"
    CHANNEL_KIND_SHIFT = "shift"

    ROOM_TYPE_CHOICES = [
        (ROOM_TYPE_CASE, "Case"),
        (ROOM_TYPE_CHANNEL, "Channel"),
        (ROOM_TYPE_GROUP, "Group"),
    ]

    CHANNEL_KIND_CHOICES = [
        (CHANNEL_KIND_DEPT, "Department"),
        (CHANNEL_KIND_SHIFT, "Shift"),
    ]

    name = models.CharField(max_length=255, unique=True)
    room_type = models.CharField(
        max_length=20, choices=ROOM_TYPE_CHOICES, default=ROOM_TYPE_CASE
    )
    channel_kind = models.CharField(
        max_length=20, choices=CHANNEL_KIND_CHOICES, blank=True, null=True
    )
    case_key = models.CharField(max_length=255, blank=True)
    dept_code = models.CharField(max_length=64, blank=True)
    shift_code = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="chat_rooms", blank=True
    )

    class Meta:
        indexes = [
            models.Index(fields=["room_type", "case_key"]),
            models.Index(fields=["room_type", "channel_kind", "dept_code", "shift_code"]),
        ]

    def __str__(self):
        return self.name

    @staticmethod
    def build_name(room_type, channel_kind=None, case_key=None, dept_code=None, shift_code=None, group_uuid=None):
        if room_type == ChatRoom.ROOM_TYPE_CASE:
            return f"case:{case_key}"
        if room_type == ChatRoom.ROOM_TYPE_CHANNEL and channel_kind == ChatRoom.CHANNEL_KIND_DEPT:
            return f"dept:{dept_code}"
        if room_type == ChatRoom.ROOM_TYPE_CHANNEL and channel_kind == ChatRoom.CHANNEL_KIND_SHIFT:
            return f"shift:{dept_code}:{shift_code}"
        if room_type == ChatRoom.ROOM_TYPE_GROUP:
            if not group_uuid:
                raise ValueError("group_uuid is required for group rooms.")
            return f"group:{group_uuid}"
        raise ValueError("Invalid room type configuration.")


class ChatAttachment(models.Model):
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_attachments"
    )
    file = models.FileField(upload_to="chat_attachments/")
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, blank=True)
    size = models.PositiveIntegerField(null=True, blank=True)
    is_used = models.BooleanField(default=False)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["uploaded_by", "created_at"], name="att_up_cr_idx"),
            models.Index(fields=["is_used", "created_at"], name="att_used_cr_idx"),
        ]

    def __str__(self):
        return f"{self.id}:{self.original_name}"


class Message(models.Model):
    MESSAGE_TYPE_CHOICES = [
        ("text", "Text"),
        ("file", "File"),
        ("system", "System"),
    ]

    room = models.ForeignKey(
        ChatRoom, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages"
    )
    content = models.TextField(blank=True)
    message_type = models.CharField(
        max_length=10, choices=MESSAGE_TYPE_CHOICES, default="text"
    )
    attachment = models.FileField(
        upload_to="chat_attachments/", null=True, blank=True
    )
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_type = models.CharField(max_length=100, blank=True)
    attachment_size = models.PositiveIntegerField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ["timestamp"]
        indexes = [
            models.Index(fields=["room", "id"]),
            models.Index(fields=["room", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.sender_id}: {self.content[:30]}"


class DepartmentMembership(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    dept_code = models.CharField(max_length=64)
    role = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "dept_code")

    def __str__(self):
        return f"{self.user_id}:{self.dept_code}"


class ShiftMembership(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    dept_code = models.CharField(max_length=64)
    shift_code = models.CharField(max_length=64)
    role = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "dept_code", "shift_code")

    def __str__(self):
        return f"{self.user_id}:{self.dept_code}:{self.shift_code}"


class ChatRoomUserState(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="user_states")
    is_hidden = models.BooleanField(default=False)
    hidden_at = models.DateTimeField(null=True, blank=True)
    last_read_at = models.DateTimeField(null=True, blank=True)
    cleared_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("user", "room")
        indexes = [
            models.Index(fields=["user", "room"]),
            models.Index(fields=["user", "is_hidden"]),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.room_id}:{self.is_hidden}"


class Notification(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_notifications"
    )
    room = models.ForeignKey(
        ChatRoom, on_delete=models.CASCADE, related_name="chat_notifications"
    )
    message = models.ForeignKey(
        Message, on_delete=models.CASCADE, related_name="chat_notifications"
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "message")
        indexes = [
            models.Index(fields=["user", "is_read", "created_at"]),
            models.Index(fields=["room", "created_at"]),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.message_id}:{self.is_read}"


class UserPresence(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="presence"
    )
    is_online = models.BooleanField(default=False)
    active_connections = models.PositiveIntegerField(default=0)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["is_online"]),
            models.Index(fields=["last_seen_at"]),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.is_online}:{self.active_connections}"
