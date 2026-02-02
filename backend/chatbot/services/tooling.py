import logging
import re
from datetime import datetime
from django.utils import timezone
from chatbot.services.extraction import parse_date_only

logger = logging.getLogger(__name__)

def _parse_preferred_datetime(message: str) -> datetime | None:
    """
    메시지에서 날짜와 시간을 파싱하여 datetime 객체를 반환합니다.
    점(.) 날짜 패턴도 지원합니다.
    """
    # 1. 날짜 추출
    date_tuple = parse_date_only(message)
    if not date_tuple:
        return None
    
    month, day = date_tuple

    # 2. 시간 추출 (13시30분, 13시 등)
    time_match = re.search(r'(\d{1,2})시\s*(\d{1,2})?분?', message)
    if not time_match:
        return None
    
    hour = int(time_match.group(1))
    minute = int(time_match.group(2)) if time_match.group(2) else 0

    # 연도는 현재 연도 가정 (과거/미래 판정은 호출부에서 처리 or 여기서 처리)
    # CDSS 시스템 특성상 보통 가까운 미래 예약을 가정함.
    year = timezone.now().year
    
    try:
        # construct datetime (naive) -> will be localized by caller or interpreted as KST
        return datetime(year, month, day, hour, minute, 0)
    except ValueError:
        return None

def _resolve_requested_datetime(message: str) -> datetime | None:
    """
    예약 요청 메시지에서 희망 시간을 추출 및 확정합니다.
    """
    return _parse_preferred_datetime(message)

def _extract_cancel_dates(message: str):
    """
    취소 요청 메시지에서 날짜들을 추출합니다.
    """
    # 단순화를 위해 우선 날짜 하나만 추출
    return parse_date_only(message)
