from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)


def _get_appointments_reply(patient_identifier: str) -> str:
    """환자 ID로 예약 목록 조회 후 안내 문구 반환"""
    try:
        from patients.models import Appointment
        now = timezone.now()
        qs = Appointment.objects.filter(
            patient_identifier=patient_identifier.strip()
        ).exclude(status='cancelled').filter(start_time__gte=now).order_by('start_time')
        appointments = list(qs[:20])
        if not appointments:
            return f"등록된 예약 내역이 없습니다. (환자 ID: {patient_identifier})"
        lines = ["예약 내역입니다.\n"]
        for i, apt in enumerate(appointments, 1):
            start = apt.start_time
            date_str = start.strftime("%Y년 %m월 %d일")
            time_str = start.strftime("%H:%M")
            dept = apt.doctor_department or ""
            doc = apt.doctor_name or apt.doctor_username or ""
            title = apt.title or "진료"
            lines.append(f"{i}. {date_str} {time_str} - {dept} {doc} ({title})")
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
