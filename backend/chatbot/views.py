import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from django.db import connection
from rest_framework import serializers as drf_serializers

import logging

logger = logging.getLogger(__name__)


def _try_create_appointment_from_message(message: str, patient_identifier: str, patient_name: str = "") -> tuple[bool, str]:
    """
    메시지에서 "OO (D2026004) 2. 5. (목) 13시30분 예약" 또는 "2.5(목) 14시10분" 형식을 파싱해 예약 생성.
    점(.) 날짜 패턴(2.5, 2.5(목))도 인식하여 날짜+시간이 정상 파싱되도록 함 (과거 판정 이슈 방지).
    반환: (성공 여부, 응답 메시지)
    """
    if not patient_identifier:
        return False, "예약을 하려면 로그인(환자 번호) 후 이용해 주세요."

    # 의사 코드: (D2026004) 또는 (D2026)
    doctor_code_match = re.search(r'\(D\d+\)', message)
    if not doctor_code_match:
        return False, ""

    doctor_code = doctor_code_match.group(0).strip('()')  # D2026004

    # 날짜: "2. 5." / "2. 5. (목)" / "2.5(목)" / "2.5" (점 날짜) / "2월 5일"
    date_match = (
        re.search(r'(\d{1,2})\.\s*(\d{1,2})\.', message)
        or re.search(r'(\d{1,2})\.(\d{1,2})(?:\s*\([월화수목금토일]\))?', message)  # 2.5(목) 또는 2.5
        or re.search(r'(\d{1,2})월\s*(\d{1,2})일', message)
    )
    if not date_match:
        return False, ""

    month, day = int(date_match.group(1)), int(date_match.group(2))
    # 시간: 13시30분 또는 13시
    time_match = re.search(r'(\d{1,2})시\s*(\d{1,2})?분?', message)
    if not time_match:
        return False, ""

    hour = int(time_match.group(1))
    minute = int(time_match.group(2)) if time_match.group(2) else 0

    year = timezone.now().year
    try:
        start_time = datetime(year, month, day, hour, minute, 0)  # naive = 한국 시간으로 해석
        logger.info(f"챗봇 예약: 파싱된 시간 start_time={start_time} (naive, 한국 시간 의도)")
    except ValueError:
        return False, "날짜 또는 시간 형식이 올바르지 않습니다."

    end_time = start_time + timedelta(minutes=30)
    
    # 현재 한국 시간과 비교 (검증 전 미리보기)
    from zoneinfo import ZoneInfo
    now_korea = datetime.now(ZoneInfo("Asia/Seoul"))
    logger.info(f"챗봇 예약: 현재 한국 시각={now_korea}, start_time={start_time} → 차이={(start_time - now_korea.replace(tzinfo=None)).total_seconds() / 60:.1f}분")

    # auth_user에서 doctor_id로 의사 user id 조회
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM auth_user WHERE doctor_id = %s", [doctor_code])
            row = cursor.fetchone()
        if not row:
            logger.warning(f"챗봇 예약: 의사 코드 없음 doctor_code={doctor_code}")
            return False, f"의사 코드({doctor_code})를 찾을 수 없습니다."
        doctor_user_id = row[0]
    except Exception as e:
        logger.warning(f"챗봇 예약: 의사 조회 실패 doctor_code={doctor_code}, error={e}")
        return False, ""

    from patients.models import Appointment
    from patients.serializers import AppointmentSerializer

    payload = {
        "title": "챗봇 진료 예약",
        "type": "예약",
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "doctor": doctor_user_id,
        "patient_id": patient_identifier,
        "patient_name": patient_name or "",
        "status": "scheduled",
    }

    serializer = AppointmentSerializer(data=payload, context={"request": None})
    try:
        serializer.is_valid(raise_exception=True)
        apt = serializer.save()
        date_str = apt.start_time.strftime("%Y년 %m월 %d일 %H:%M")
        return True, f"예약이 완료되었습니다. ({date_str})"
    except drf_serializers.ValidationError as e:
        err = e.detail.get("start_time") or e.detail.get("non_field_errors") or str(e.detail)
        if isinstance(err, list):
            err = err[0] if err else str(e.detail)
        return False, err
    except Exception as e:
        logger.warning(f"챗봇 예약 생성 실패: {e}", exc_info=True)
        return False, "예약 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."


def _get_appointments_reply(patient_identifier: str) -> str:
    """환자 ID로 예약 목록 조회 후 안내 문구 반환"""
    try:
        from patients.models import Appointment
        now = timezone.now()
        
        # 디버깅: 모든 예약 조회 (취소 포함, 과거 포함)
        all_appointments = Appointment.objects.filter(
            patient_identifier=patient_identifier.strip()
        ).order_by('start_time')
        logger.info(f"챗봇 예약 조회 - 환자 {patient_identifier}: 전체 {all_appointments.count()}건, 현재시각: {now}")
        
        # 실제 응답용: 취소 제외 + 미래 예약만
        qs = all_appointments.exclude(status='cancelled').filter(start_time__gte=now)
        appointments = list(qs[:20])
        
        if not appointments:
            return f"등록된 예약 내역이 없습니다. (환자 ID: {patient_identifier})"
        lines = [f"예약 내역입니다. (총 {len(appointments)}건)\n"]
        for i, apt in enumerate(appointments, 1):
            start = apt.start_time
            date_str = start.strftime("%Y-%m-%d")  # 2026-03-04 형식으로 통일
            time_str = start.strftime("%H:%M")
            dept = apt.doctor_department or ""
            doc = apt.doctor_name or apt.doctor_username or ""
            title = apt.title or "진료"
            status_str = f" [{apt.status}]" if apt.status != 'scheduled' else ""
            lines.append(f"{i}. {date_str} {time_str} - {dept} {doc} ({title}){status_str}")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"챗봇 예약 내역 조회 실패: patient_identifier={patient_identifier}, error={e}")
        return "예약 내역을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."


@api_view(['POST'])
@permission_classes([AllowAny])
def chat(request):
    """챗봇 메시지 처리"""
    try:
        message = (request.data.get('message') or '').strip()
        conversation_id = request.data.get('conversation_id', '')
        metadata = request.data.get('metadata') or {}
        patient_identifier = (metadata.get('patient_identifier') or metadata.get('patient_id') or '').strip()

        logger.info(f"챗봇 요청: message={message[:50]}, conversation_id={conversation_id}, patient_identifier={patient_identifier or '(없음)'}")

        # 예약 내역/확인/조회 요청 → 실제 DB 조회
        if any(kw in message for kw in ('예약 내역', '예약 확인', '예약 조회', '예약 목록', '예약 있어', '예약 없어', '예약 알려')):
            if patient_identifier:
                response_message = _get_appointments_reply(patient_identifier)
            else:
                response_message = "예약 내역을 보려면 로그인(환자 번호) 후 이용해 주세요."
            return Response({
                'reply': response_message,
                'message': response_message,
                'conversation_id': conversation_id,
                'success': True,
            }, status=status.HTTP_200_OK)

        # "OO (D2026004) 2. 5. (목) 13시30분 예약" 형식 → 실제 예약 생성 시도
        if '예약' in message and not any(kw in message for kw in ('내역', '확인', '조회', '목록', '있어', '없어', '알려')):
            patient_name = (metadata.get('patient_name') or metadata.get('name') or '').strip()
            ok, response_message = _try_create_appointment_from_message(message, patient_identifier, patient_name)
            if response_message:
                return Response({
                    'reply': response_message,
                    'message': response_message,
                    'conversation_id': conversation_id,
                    'success': ok,
                }, status=status.HTTP_200_OK)

        # 기본 응답 (임시)
        response_message = "안녕하세요! 건양대학교병원 챗봇입니다. 무엇을 도와드릴까요?"

        # 위치/주소 (FAQ와 동일한 답변)
        if any(kw in message for kw in ('병원 위치', '위치', '주소', '어디에', '어디서', '주소가')):
            response_message = "건양대학교병원은 대전광역시 서구 관저동에 위치해 있습니다. (관저동언로 158)"
        # 전화/연락처
        elif any(kw in message for kw in ('전화', '연락처', '번호', '전화번호')):
            response_message = "건양대학교병원 대표전화는 042-600-9000입니다. 진료예약 042-600-9001, 건강검진예약 042-600-9002입니다."
        # 주차 (FAQ와 동일)
        elif any(kw in message for kw in ('주차', '주차요금', '주차비', '주차료')):
            response_message = "외래 진료 시 4시간 무료이며, 이후 10분당 추가 요금이 발생합니다."
        # 제증명 (FAQ와 동일)
        elif any(kw in message for kw in ('제증명', '증명서', '진단서', '발급')):
            response_message = "본인 신분증을 지참하여 원무과 창구를 방문하시거나, 무인발급기/홈페이지에서 발급 가능합니다."
        # 응급실 (FAQ와 동일)
        elif any(kw in message for kw in ('응급실', '응급', '응급의료')):
            response_message = "응급의료센터는 365일 24시간 연중무휴로 운영됩니다."
        # 운영시간/진료시간
        elif any(kw in message for kw in ('운영시간', '영업시간', '진료시간', '언제 문', '몇 시')):
            response_message = "진료 시간은 평일 09:00~18:00입니다. 응급의료센터는 24시간 운영합니다. 자세한 진료과별 시간은 대표전화(042-600-9000)로 문의해 주세요."
        # 예약/진료 (내역·확인·조회 제외)
        elif ('예약' in message or '진료' in message) and not any(kw in message for kw in ('내역', '확인', '조회', '목록', '있어', '없어', '알려')):
            from datetime import datetime
            from zoneinfo import ZoneInfo
            now_korea = datetime.now(ZoneInfo("Asia/Seoul"))
            today_str = now_korea.strftime('%Y년 %m월 %d일 %H:%M')
            response_message = f"진료 예약은 병원 홈페이지 또는 전화(042-600-9001)로 가능합니다. 예약은 오늘 이후 날짜와 시간만 선택할 수 있습니다. (현재 시각: {today_str} 한국 시간) 예약 내역이 필요하시면 '예약 내역'이라고 말씀해 주세요."

        return Response({
            'reply': response_message,
            'message': response_message,
            'conversation_id': conversation_id,
            'success': True,
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.error(f"챗봇 오류: {e}", exc_info=True)
        return Response({
            'error': '오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            'success': False,
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([AllowAny])
def skin_analyze(request):
    """피부암 분석 (모바일 앱용)"""
    try:
        # 피부 이미지 분석 로직 (추후 구현)
        return Response({
            'result': '정상',
            'confidence': 0.95,
            'message': '피부 상태가 정상으로 보입니다. 정확한 진단을 위해 병원 방문을 권장합니다.'
        }, status=status.HTTP_200_OK)
    except Exception as e:
        logger.error(f"피부 분석 오류: {e}", exc_info=True)
        return Response({
            'error': '분석 중 오류가 발생했습니다.',
            'success': False
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
