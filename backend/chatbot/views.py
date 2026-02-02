from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
import logging

logger = logging.getLogger(__name__)

@api_view(['POST'])
@permission_classes([AllowAny])
def chat(request):
    """챗봇 메시지 처리"""
    try:
        message = request.data.get('message', '')
        conversation_id = request.data.get('conversation_id', '')
        
        logger.info(f"챗봇 요청: message={message}, conversation_id={conversation_id}")
        
        # 기본 응답 (임시)
        response_message = "안녕하세요! 건양대학교병원 챗봇입니다. 무엇을 도와드릴까요?"
        
        if '병원 위치' in message or '위치' in message:
            response_message = "건양대학교병원은 대전광역시 서구 관저동에 위치해 있습니다."
        elif '예약' in message or '진료' in message:
            response_message = "진료 예약은 병원 홈페이지 또는 전화로 가능합니다."
        elif '전화' in message or '연락처' in message:
            response_message = "건양대학교병원 전화번호는 042-600-9000입니다."
        
        return Response({
            'message': response_message,
            'conversation_id': conversation_id,
            'success': True
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        logger.error(f"챗봇 오류: {e}", exc_info=True)
        return Response({
            'error': '오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            'success': False
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
