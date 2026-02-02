import re

# Weekday mapping
# 요일 한 글자 처리를 위한 매핑
WEEKDAY_WORDS = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}

# Date Extraction Patterns
# 점(.) 날짜 패턴 포함
DATE_EXTRACT_PATTERN = [
    # 2. 5.
    re.compile(r'(\d{1,2})\.\s*(\d{1,2})\.'),
    # 2.5(목) or 2.5
    re.compile(r'(\d{1,2})\.(\d{1,2})(?:\s*\([월화수목금토일]\))?'),
    # 2월 5일
    re.compile(r'(\d{1,2})월\s*(\d{1,2})일'),
]
