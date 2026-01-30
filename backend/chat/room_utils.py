from typing import Optional
from dataclasses import dataclass
import re

from .models import ChatRoom


@dataclass(frozen=True)
class ParsedRoomName:
    room_type: str
    channel_kind: Optional[str]
    case_key: Optional[str]
    dept_code: Optional[str]
    shift_code: Optional[str]
    name: str


def parse_room_name(room_name: str) -> ParsedRoomName:
    if room_name.startswith("case:"):
        case_key = room_name[len("case:") :]
        if not case_key:
            raise ValueError("Case room name must be case:<case_key>.")
        if not re.fullmatch(r"[A-Za-z0-9_:-]+", case_key):
            raise ValueError("Case key has invalid characters.")
        return ParsedRoomName(
            room_type=ChatRoom.ROOM_TYPE_CASE,
            channel_kind=None,
            case_key=case_key,
            dept_code=None,
            shift_code=None,
            name=f"case:{case_key}",
        )

    if room_name.startswith("dept:"):
        dept_code = room_name[len("dept:") :]
        if not dept_code or ":" in dept_code:
            raise ValueError("Dept room name must be dept:<dept_code>.")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", dept_code):
            raise ValueError("Department code has invalid characters.")
        return ParsedRoomName(
            room_type=ChatRoom.ROOM_TYPE_CHANNEL,
            channel_kind=ChatRoom.CHANNEL_KIND_DEPT,
            case_key=None,
            dept_code=dept_code,
            shift_code=None,
            name=f"dept:{dept_code}",
        )

    if room_name.startswith("shift:"):
        rest = room_name[len("shift:") :]
        parts = rest.split(":")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ValueError("Shift room name must be shift:<dept_code>:<shift_id>.")
        dept_code, shift_code = parts
        if not re.fullmatch(r"[A-Za-z0-9_-]+", dept_code):
            raise ValueError("Department code has invalid characters.")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", shift_code):
            raise ValueError("Shift code has invalid characters.")
        return ParsedRoomName(
            room_type=ChatRoom.ROOM_TYPE_CHANNEL,
            channel_kind=ChatRoom.CHANNEL_KIND_SHIFT,
            case_key=None,
            dept_code=dept_code,
            shift_code=shift_code,
            name=f"shift:{dept_code}:{shift_code}",
        )

    if room_name.startswith("group:"):
        group_key = room_name[len("group:") :]
        if not group_key:
            raise ValueError("Group room name must be group:<uuid>.")
        return ParsedRoomName(
            room_type=ChatRoom.ROOM_TYPE_GROUP,
            channel_kind=None,
            case_key=None,
            dept_code=None,
            shift_code=None,
            name=room_name,
        )

    raise ValueError("Room name must start with case:, dept:, shift: or group:.")


def dm_participant_ids(room: ChatRoom) -> set[int]:
    if room.room_type != ChatRoom.ROOM_TYPE_CASE:
        return set()
    case_key = room.case_key or ""
    return dm_participant_ids_from_case_key(case_key)


def dm_participant_ids_from_case_key(case_key: str) -> set[int]:
    if not case_key or not case_key.startswith("dm:"):
        return set()
    parts = case_key.split(":")
    if len(parts) != 3:
        return set()
    try:
        left = int(parts[1])
        right = int(parts[2])
    except ValueError:
        return set()
    return {left, right}
