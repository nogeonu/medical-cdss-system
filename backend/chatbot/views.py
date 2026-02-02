import re
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from django.db import connection
from rest_framework import serializers as drf_serializers

import logging

from eventeye.doctor_utils import DEPARTMENT_ADMIN, DEPARTMENT_IMAGING, DEPARTMENT_RADIOLOGY

logger = logging.getLogger(__name__)


def _extract_doctor_code(message: str) -> Optional[str]:
    match = re.search(r'\(D\d+\)', message)
    if not match:
        return None
    return match.group(0).strip('()')


def _parse_date_from_message(message: str) -> Optional[tuple[Optional[int], int, int]]:
    iso_match = re.search(r'(\d{4})[./-](\d{1,2})[./-](\d{1,2})', message)
    if iso_match:
        year = int(iso_match.group(1))
        month = int(iso_match.group(2))
        day = int(iso_match.group(3))
        return year, month, day

    from chatbot.services.extraction import parse_date_only

    legacy = parse_date_only(message)
    if legacy:
        return None, legacy[0], legacy[1]
    return None


def _parse_time_from_message(message: str) -> Optional[tuple[int, int]]:
    colon_match = re.search(r'(\d{1,2})\s*:\s*(\d{1,2})', message)
    if colon_match:
        hour = int(colon_match.group(1))
        minute = int(colon_match.group(2))
        return hour, minute
    time_match = re.search(r'(\d{1,2})시\s*(\d{1,2})?분?', message)
    if not time_match:
        return None
    hour = int(time_match.group(1))
    minute = int(time_match.group(2)) if time_match.group(2) else 0
    return hour, minute


def _build_doctor_table(limit: int = 12) -> Optional[dict]:
    try:
        query = [
            "SELECT id, username, first_name, last_name, doctor_id, department",
            "FROM auth_user",
            "WHERE doctor_id IS NOT NULL AND doctor_id <> ''",
            "AND doctor_id LIKE %s",
            "AND department IS NOT NULL",
            "AND department <> %s AND department <> %s AND department <> %s",
            "ORDER BY first_name, last_name, username",
            "LIMIT %s",
        ]
        params = ["D%", DEPARTMENT_ADMIN, DEPARTMENT_RADIOLOGY, DEPARTMENT_IMAGING, limit]

        with connection.cursor() as cursor:
            cursor.execute(" ".join(query), params)
            rows = cursor.fetchall()
    except Exception as e:
        logger.warning(f"챗봇 예약: 의료진 목록 조회 실패 error={e}")
        return None

    if not rows:
        return None

    table_rows: list[list[str]] = []
    doctor_metadata: list[dict] = []

    for row in rows:
        doctor_user_id, username, first_name, last_name, doctor_code, department = row
        display_name = " ".join(filter(None, [last_name, first_name])).strip() or username
        label = f"{display_name} ({doctor_code})" if doctor_code else display_name
        table_rows.append([label, department or "의료진"])
        doctor_metadata.append({
            "doctor_code": doctor_code,
            "doctor_id": str(doctor_user_id),
        })

    return {
        "headers": ["의사", "진료과"],
        "rows": table_rows,
        "doctor_metadata": doctor_metadata,
    }


def _format_doctor_display(apt) -> str:
    doc = apt.doctor_name or apt.doctor_username or ""
    if apt.doctor_code and apt.doctor_code not in doc:
        return f"{doc} ({apt.doctor_code})".strip()
    return doc or apt.doctor_code or ""


def _build_appointments_table(appointments) -> Optional[dict]:
    if not appointments:
        return None

    rows: list[list[str]] = []
    for apt in appointments:
        start = apt.start_time
        date_str = start.strftime("%Y-%m-%d")
        time_str = start.strftime("%H:%M")
        dept = apt.doctor_department or ""
        doc = _format_doctor_display(apt)
        title = apt.title or "진료"
        status = apt.status or "scheduled"
        rows.append([date_str, time_str, dept, doc, title, status])

    return {
        "headers": ["예약일", "시간", "진료과", "의료진", "예약명", "상태"],
        "rows": rows,
    }


def _get_appointments_payload(patient_identifier: str) -> tuple[str, Optional[dict]]:
    """환자 ID로 예약 목록 조회 후 안내 문구 + 테이블 반환"""
    try:
        from patients.models import Appointment
        now = timezone.now()

        all_appointments = Appointment.objects.filter(
            patient_identifier=patient_identifier.strip()
        ).order_by('start_time')
        logger.info(f"챗봇 예약 조회 - 환자 {patient_identifier}: 전체 {all_appointments.count()}건, 현재시각: {now}")

        qs = all_appointments.exclude(status='cancelled').filter(start_time__gte=now)
        appointments = list(qs[:20])

        if not appointments:
            return f"등록된 예약 내역이 없습니다. (환자 ID: {patient_identifier})", None

        table = _build_appointments_table(appointments)
        return f"예약 내역입니다. (총 {len(appointments)}건)", table
    except Exception as e:
        logger.warning(f"챗봇 예약 내역 조회 실패: patient_identifier={patient_identifier}, error={e}")
        return "예약 내역을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", None

def _try_create_appointment_from_message(
    message: str,
    patient_identifier: str,
    patient_name: str = "",
    *,
    doctor_code_override: Optional[str] = None,
    date_tuple_override: Optional[tuple[Optional[int], int, int]] = None,
    time_tuple_override: Optional[tuple[int, int]] = None,
) -> tuple[bool, str]:
    """
    메시지에서 "OO (D2026004) 2. 5. (목) 13시30분 예약" 또는 "2.5(목) 14시10분" 형식을 파싱해 예약 생성.
    점(.) 날짜 패턴(2.5, 2.5(목))도 인식하여 날짜+시간이 정상 파싱되도록 함 (과거 판정 이슈 방지).
    반환: (성공 여부, 응답 메시지)
    """
    if not patient_identifier:
        return False, "예약을 하려면 로그인(환자 번호) 후 이용해 주세요."

    doctor_code = doctor_code_override or _extract_doctor_code(message)
    if not doctor_code:
        return False, "예약할 의료진을 먼저 선택해 주세요."

    date_tuple = date_tuple_override or _parse_date_from_message(message)
    if not date_tuple:
        return False, "날짜 형식을 인식할 수 없습니다. (예: 2.5, 2월 5일)"

    time_tuple = time_tuple_override or _parse_time_from_message(message)
    if not time_tuple:
        return False, "시간 형식을 인식할 수 없습니다. (예: 14시 30분)"

    year, month, day = date_tuple
    hour, minute = time_tuple

    try:
        now_korea = datetime.now(ZoneInfo("Asia/Seoul"))
        if year is None:
            year = now_korea.year
        start_time = datetime(year, month, day, hour, minute, 0)
        logger.info(f"챗봇 예약: 파싱 성공 start_time={start_time}")
    except ValueError:
        return False, "날짜 또는 시간 값이 올바르지 않습니다."

    end_time = start_time + timedelta(minutes=30)

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
        return False, "의료진 정보를 불러오는 중 오류가 발생했습니다."

    from patients.models import Appointment, Patient
    from patients.serializers import AppointmentSerializer

    conflict_exists = Appointment.objects.filter(
        doctor_id=doctor_user_id,
        start_time=start_time,
    ).exclude(status='cancelled').exists()
    if conflict_exists:
        return False, "해당 시간에는 이미 예약이 있습니다. 다른 시간을 선택해 주세요."

    patient_obj = None
    try:
        patient_obj = Patient.objects.filter(patient_id=patient_identifier).first()
    except Exception:
        patient_obj = None

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
    if patient_obj:
        payload["patient"] = patient_obj.id

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


@api_view(['POST'])
@permission_classes([AllowAny])
def chat(request):
    """챗봇 메시지 처리"""
    try:
        message = (request.data.get('message') or '').strip()
        conversation_id = request.data.get('conversation_id', '')
        metadata = request.data.get('metadata') or {}
        patient_identifier = (metadata.get('patient_identifier') or metadata.get('patient_id') or '').strip()
        
        logger.info(f"챗봇 요청 수신: message='{message}'")

        history_keywords = ('예약 내역', '예약 확인', '예약 조회', '예약 목록', '예약 있어', '예약 없어', '예약 알려')
        is_history_request = any(kw in message for kw in history_keywords)
        is_reservation_request = '예약' in message

        if is_history_request:
            if not patient_identifier:
                response_message = "예약 내역을 보려면 로그인(환자 번호) 후 이용해 주세요."
                return Response({
                    'reply': response_message,
                    'message': response_message,
                    'conversation_id': conversation_id,
                    'success': True,
                }, status=status.HTTP_200_OK)

            response_message, table = _get_appointments_payload(patient_identifier)
            return Response({
                'reply': response_message,
                'message': response_message,
                'conversation_id': conversation_id,
                'success': True,
                'table': table,
            }, status=status.HTTP_200_OK)

        if is_reservation_request and not is_history_request:
            if not patient_identifier:
                response_message = "예약을 하려면 로그인(환자 번호) 후 이용해 주세요."
                return Response({
                    'reply': response_message,
                    'message': response_message,
                    'conversation_id': conversation_id,
                    'success': False,
                }, status=status.HTTP_200_OK)

            meta_date = (metadata.get('appointment_date') or '').strip()
            meta_time = (metadata.get('appointment_time') or '').strip()
            meta_doctor_code = (metadata.get('doctor_code') or '').strip()

            doctor_code = meta_doctor_code or _extract_doctor_code(message)
            date_source = meta_date or message
            time_source = meta_time or message
            date_tuple = _parse_date_from_message(date_source)
            time_tuple = _parse_time_from_message(time_source)

            if doctor_code and date_tuple and time_tuple:
                patient_name = (metadata.get('patient_name') or metadata.get('name') or '').strip()
                ok, response_message = _try_create_appointment_from_message(
                    message,
                    patient_identifier,
                    patient_name,
                    doctor_code_override=doctor_code,
                    date_tuple_override=date_tuple,
                    time_tuple_override=time_tuple,
                )
                if ok:
                    summary_message, table = _get_appointments_payload(patient_identifier)
                    combined_message = f"{response_message}\n\n{summary_message}" if summary_message else response_message
                    return Response({
                        'reply': combined_message,
                        'message': combined_message,
                        'conversation_id': conversation_id,
                        'success': True,
                        'table': table,
                    }, status=status.HTTP_200_OK)
                return Response({
                    'reply': response_message,
                    'message': response_message,
                    'conversation_id': conversation_id,
                    'success': False,
                }, status=status.HTTP_200_OK)

            table = _build_doctor_table()
            response_message = "예약할 의료진과 날짜/시간을 선택해 주세요."
            if not table:
                response_message = "예약할 의료진 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            buttons = [
                {"text": "예약 내역 보기", "action": "예약 내역"},
            ]
            return Response({
                'reply': response_message,
                'message': response_message,
                'conversation_id': conversation_id,
                'success': True,
                'table': table,
                'buttons': buttons,
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

        # 디버그: 서버 시간 확인
        if message == '서버시간':
            from zoneinfo import ZoneInfo
            now_korea = datetime.now(ZoneInfo("Asia/Seoul"))
            now_server = datetime.now()
            response_message = f"Server Time: {now_server}\nKST: {now_korea}\nTimezone: {timezone.get_current_timezone_name()}"
            
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
def available_time_slots(request):
    """예약 가능한 시간 조회 (의료진/날짜 기준)"""
    try:
        payload = request.data or {}
        date_str = (payload.get('date') or '').strip()
        doctor_id_raw = payload.get('doctor_id')
        doctor_code = (payload.get('doctor_code') or '').strip()

        if not date_str:
            return Response({'status': 'error', 'detail': 'date is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response({'status': 'error', 'detail': 'invalid date format'}, status=status.HTTP_400_BAD_REQUEST)

        from patients.models import Appointment

        qs = Appointment.objects.exclude(status='cancelled')
        if doctor_id_raw:
            try:
                doctor_id = int(doctor_id_raw)
            except (TypeError, ValueError):
                doctor_id = doctor_id_raw
            qs = qs.filter(doctor_id=doctor_id)
        elif doctor_code:
            qs = qs.filter(doctor_code=doctor_code)
        else:
            return Response({'status': 'error', 'detail': 'doctor_id or doctor_code required'}, status=status.HTTP_400_BAD_REQUEST)

        start_of_day = datetime(date_obj.year, date_obj.month, date_obj.day, 0, 0, 0)
        end_of_day = start_of_day + timedelta(days=1)
        qs = qs.filter(start_time__gte=start_of_day, start_time__lt=end_of_day)

        booked_times = sorted({apt.start_time.strftime("%H:%M") for apt in qs})

        return Response({
            'status': 'ok',
            'booked_times': booked_times,
        }, status=status.HTTP_200_OK)
    except Exception as e:
        logger.error(f"예약 시간 조회 오류: {e}", exc_info=True)
        return Response({'status': 'error', 'detail': 'internal error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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
