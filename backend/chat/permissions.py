from django.conf import settings
from django.db.models import Q
from rest_framework.permissions import BasePermission

from .models import ChatRoom, DepartmentMembership, ShiftMembership
from .room_utils import dm_participant_ids


def user_has_department_access(user, dept_code):
    if not dept_code:
        return False
    return DepartmentMembership.objects.filter(
        user=user, dept_code=dept_code, is_active=True
    ).exists()


def user_has_shift_access(user, dept_code, shift_code):
    if not dept_code or not shift_code:
        return False
    return ShiftMembership.objects.filter(
        user=user, dept_code=dept_code, shift_code=shift_code, is_active=True
    ).exists()


def user_has_room_access(user, room):
    if not user or not user.is_authenticated:
        return False
    if room.room_type == ChatRoom.ROOM_TYPE_CASE and room.case_key.startswith("dm:"):
        participant_ids = dm_participant_ids(room)
        return user.id in participant_ids or room.participants.filter(id=user.id).exists()
    if getattr(settings, "OPEN_CHAT_ACCESS", False):
        return True
    if user.is_superuser:
        return True
    if room.room_type in (ChatRoom.ROOM_TYPE_CASE, ChatRoom.ROOM_TYPE_GROUP):
        return room.participants.filter(id=user.id).exists()
    if room.room_type == ChatRoom.ROOM_TYPE_CHANNEL:
        if room.channel_kind == ChatRoom.CHANNEL_KIND_DEPT:
            return user_has_department_access(user, room.dept_code)
        if room.channel_kind == ChatRoom.CHANNEL_KIND_SHIFT:
            return user_has_shift_access(user, room.dept_code, room.shift_code)
    return False


def accessible_rooms_query(user):
    if getattr(settings, "OPEN_CHAT_ACCESS", False):
        return Q()
    # if user.is_superuser:
    #     return Q()

    dept_codes = DepartmentMembership.objects.filter(
        user=user, is_active=True
    ).values_list("dept_code", flat=True)
    shift_pairs = list(
        ShiftMembership.objects.filter(user=user, is_active=True).values_list(
            "dept_code", "shift_code"
        )
    )

    query = Q(
        room_type__in=[ChatRoom.ROOM_TYPE_CASE, ChatRoom.ROOM_TYPE_GROUP],
        participants=user,
    ) | Q(
        room_type=ChatRoom.ROOM_TYPE_CHANNEL,
        channel_kind=ChatRoom.CHANNEL_KIND_DEPT,
        dept_code__in=dept_codes,
    )

    shift_query = Q(pk__in=[])
    for dept_code, shift_code in shift_pairs:
        shift_query |= Q(
            room_type=ChatRoom.ROOM_TYPE_CHANNEL,
            channel_kind=ChatRoom.CHANNEL_KIND_SHIFT,
            dept_code=dept_code,
            shift_code=shift_code,
        )

    return query | shift_query


class HasRoomAccess(BasePermission):
    def has_object_permission(self, request, view, obj):
        return user_has_room_access(request.user, obj)
