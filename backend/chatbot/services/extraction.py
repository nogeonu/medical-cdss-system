from typing import Optional, Tuple
from chatbot.services.intents.keywords import DATE_EXTRACT_PATTERN

def parse_date_only(text: str) -> Optional[Tuple[int, int]]:
    """
    텍스트에서 날짜(월, 일)를 추출합니다.
    매칭되는 패턴이 없으면 None을 반환합니다.
    """
    for pattern in DATE_EXTRACT_PATTERN:
        match = pattern.search(text)
        if match:
            return int(match.group(1)), int(match.group(2))
    return None
