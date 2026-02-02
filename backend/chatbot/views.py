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

        if '병원 위치' in message or '위치' in message:
            response_message = "건양대학교병원은 대전광역시 서구 관저동에 위치해 있습니다."
        elif ('예약' in message or '진료' in message) and '내역' not in message and '확인' not in message and '조회' not in message:
            response_message = "진료 예약은 병원 홈페이지 또는 전화로 가능합니다. 예약 내역이 필요하시면 '예약 내역'이라고 말씀해 주세요."
        elif '전화' in message or '연락처' in message:
            response_message = "건양대학교병원 전화번호는 042-600-9000입니다."

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
