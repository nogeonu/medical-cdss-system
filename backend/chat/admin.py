from django.contrib import admin

from .models import (
    ChatAttachment,
    ChatRoom,
    ChatRoomUserState,
    DepartmentMembership,
    Message,
    Notification,
    ShiftMembership,
    UserPresence,
)


@admin.register(ChatRoom)
class ChatRoomAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "room_type",
        "channel_kind",
        "case_key",
        "dept_code",
        "shift_code",
        "created_at",
        "last_message_at",
    )
    search_fields = ("name", "case_key", "dept_code", "shift_code")
    list_filter = ("room_type", "channel_kind")
    filter_horizontal = ("participants",)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "sender", "message_type", "timestamp", "attachment")
    list_filter = ("message_type", "timestamp")
    search_fields = ("content",)
    autocomplete_fields = ("room", "sender")


@admin.register(ChatAttachment)
class ChatAttachmentAdmin(admin.ModelAdmin):
    list_display = ("id", "uploaded_by", "original_name", "content_type", "size", "is_used", "created_at")
    list_filter = ("is_used", "created_at")
    search_fields = ("original_name", "uploaded_by__username")
    autocomplete_fields = ("uploaded_by",)


@admin.register(DepartmentMembership)
class DepartmentMembershipAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "dept_code", "role", "is_active", "created_at")
    search_fields = ("user__username", "dept_code", "role")
    list_filter = ("dept_code", "is_active")


@admin.register(ShiftMembership)
class ShiftMembershipAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "dept_code",
        "shift_code",
        "role",
        "is_active",
        "created_at",
    )
    search_fields = ("user__username", "dept_code", "shift_code", "role")
    list_filter = ("dept_code", "shift_code", "is_active")


@admin.register(ChatRoomUserState)
class ChatRoomUserStateAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "room", "is_hidden", "hidden_at", "last_read_at", "cleared_at")
    list_filter = ("is_hidden",)
    search_fields = ("user__username", "room__name")


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "room", "message", "is_read", "created_at")
    list_filter = ("is_read", "created_at")
    search_fields = ("user__username", "room__name", "message__content")
    autocomplete_fields = ("user", "room", "message")


@admin.register(UserPresence)
class UserPresenceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "is_online", "active_connections", "last_seen_at")
    list_filter = ("is_online",)
    search_fields = ("user__username",)
