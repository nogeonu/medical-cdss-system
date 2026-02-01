"""
병리 이미지 분류 API 뷰
"""
import os
import logging
import json
import base64
import requests
from pathlib import Path
from django.utils import timezone
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated

# CSRF 체크를 건너뛰는 커스텀 인증 클래스
class CSRFExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return  # CSRF 체크를 건너뜀

logger = logging.getLogger(__name__)

# Mosec 서비스 URL
PATHOLOGY_MOSEC_URL = os.getenv('PATHOLOGY_MOSEC_URL', 'http://127.0.0.1:5008/inference')

# 교육원 컴퓨터 추론 요청 디렉토리
PATHOLOGY_REQUEST_DIR = Path(os.getenv('PATHOLOGY_INFERENCE_REQUEST_DIR', '/tmp/pathology_inference_requests'))

# OCS 모델 import (병리 분석 결과 저장용)
try:
    from ocs.models import PathologyAnalysisResult, Order, Notification
except ImportError:
    PathologyAnalysisResult = None
    Order = None
    Notification = None
    logger.warning("OCS 모델을 불러올 수 없습니다. 병리 분석 결과 저장 기능이 비활성화됩니다.")



@api_view(['POST'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def pathology_ai_analysis(request):
    """
    병리 이미지 AI 분석 (CLAM)
    
    Request Body:
        {
            "instance_id": "Orthanc instance ID (참고용)",
            "filename": "로컬 wsi 폴더 기준 파일명 (예: tumor_076.svs 또는 2024/01/case1.svs)"
        }
    
    Response:
        {
            "success": true,
            "class_id": 1,
            "class_name": "Tumor",
            "confidence": 0.95,
            "probabilities": {
                "Normal": 0.05,
                "Tumor": 0.95
            },
            "num_patches": 856,
            "top_attention_patches": [123, 456, 789, ...]
        }
    """
    try:
        # 요청 데이터 파싱
        instance_id = request.data.get('instance_id')  # 참고용
        filename = request.data.get('filename')  # 필수: 교육원 워커가 사용할 파일명
        
        if not filename:
            return Response(
                {'error': 'filename이 필요합니다. 교육원 워커가 로컬 wsi 폴더에서 찾을 파일명을 입력해주세요.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        logger.info(f"📥 병리 이미지 분석 요청: instance_id={instance_id}, filename={filename}")
        
        # USE_LOCAL_INFERENCE 확인
        use_local_inference = os.getenv('USE_LOCAL_INFERENCE', 'false').lower() == 'true'
        
        if use_local_inference:
            # 교육원 컴퓨터에서 추론 실행
            logger.info("🏠 교육원 컴퓨터 추론 모드 활성화")
            logger.info(f"📁 filename: {filename} (교육원 워커가 wsi/ 폴더에서 찾을 파일)")
            return _create_local_inference_request(request, instance_id, filename)
        
        # Mosec 서비스 호출은 현재 사용하지 않음 (교육원 워커 사용)
        # 필요시 아래 코드를 활성화
        return Response(
            {'error': 'USE_LOCAL_INFERENCE 환경 변수를 true로 설정해주세요. 교육원 워커를 사용합니다.'},
            status=status.HTTP_400_BAD_REQUEST
        )
        
    except requests.exceptions.Timeout:
        logger.error(f"❌ Mosec 서비스 타임아웃")
        return Response(
            {'error': 'AI 분석 타임아웃 (5분 초과)'},
            status=status.HTTP_504_GATEWAY_TIMEOUT
        )
    except requests.exceptions.ConnectionError:
        logger.error(f"❌ Mosec 서비스 연결 실패")
        return Response(
            {'error': 'Mosec 서비스에 연결할 수 없습니다'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    except Exception as e:
        logger.error(f"❌ 병리 이미지 분석 오류: {str(e)}", exc_info=True)
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


def _create_local_inference_request(request, instance_id, filename):
    """
    교육원 컴퓨터에서 추론 실행 요청 생성 (내부 함수)
    
    Args:
        request: Django request 객체
        instance_id: Orthanc instance ID (참고용)
        filename: 로컬 wsi 폴더 기준 파일명 (예: "tumor_076.svs" 또는 "2024/01/case1.svs")
    """
    try:
        PATHOLOGY_REQUEST_DIR.mkdir(exist_ok=True, parents=True)
        
        request_data = {
            'instance_id': instance_id,  # 참고용
            'filename': filename,  # 교육원 워커가 사용할 파일명
            'requested_at': timezone.now().isoformat(),
            'status': 'pending',
            'requested_by': getattr(request.user, 'username', 'anonymous') if hasattr(request, 'user') and hasattr(request.user, 'is_authenticated') and request.user.is_authenticated else 'anonymous'
        }
        
        timestamp = int(timezone.now().timestamp() * 1000)
        request_id = f"{instance_id}_{timestamp}"
        request_file = PATHOLOGY_REQUEST_DIR / f"{request_id}.json"
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(request_data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ 추론 요청 생성: {request_file.name}")
        
        # 즉시 응답 반환 (비동기 처리)
        # 워커가 결과를 완료하면 별도로 조회하는 방식
        # 동기 폴링 방식은 타임아웃 발생하므로 제거
        return Response({
            'success': True,
            'message': '분석 요청이 생성되었습니다. 교육원 워커에서 처리 중입니다.',
            'request_id': request_id,
            'status': 'pending',
            'filename': filename
        }, status=status.HTTP_202_ACCEPTED)
        
    except Exception as e:
        logger.error(f"❌ 추론 요청 생성 실패: {str(e)}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
def pathology_ai_health(request):
    """병리 AI 서비스 헬스 체크"""
    try:
        response = requests.get(
            "http://localhost:5008/",
            timeout=5
        )
        return Response({
            'status': 'healthy' if response.status_code == 200 else 'unhealthy',
            'mosec_status_code': response.status_code
        })
    except Exception as e:
        return Response({
            'status': 'unhealthy',
            'error': str(e)
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(['GET'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def get_analysis_result(request, request_id):
    """
    추론 결과 조회 API
    
    GET /api/pathology/result/<request_id>/
    
    Returns:
        - status: pending, processing, completed, failed
        - result: 추론 결과 (completed인 경우)
    """
    try:
        request_file = PATHOLOGY_REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists():
            return Response({
                'success': False,
                'error': '요청을 찾을 수 없습니다'
            }, status=status.HTTP_404_NOT_FOUND)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        response_data = {
            'success': True,
            'request_id': request_id,
            'status': data.get('status', 'pending'),
            'filename': data.get('filename'),
            'requested_at': data.get('requested_at'),
            'started_at': data.get('started_at'),
            'completed_at': data.get('completed_at'),
        }
        
        # 완료된 경우 결과 포함
        if data.get('status') == 'completed':
            result = data.get('result', {})
            response_data['result'] = {
                'class_id': result.get('class_id'),
                'class_name': result.get('class_name'),
                'confidence': result.get('confidence'),
                'probabilities': result.get('probabilities'),
                'num_patches': result.get('num_patches'),
                'top_attention_patches': result.get('top_attention_patches', []),
                'elapsed_time_seconds': result.get('elapsed_time_seconds'),
                'image_url': result.get('image_url'),
                'viewer_url': result.get('viewer_url'),
                'dzi_url': result.get('dzi_url'),  # OpenSeadragon용 DZI 메타데이터 URL (없으면 viewer_url 사용)
            }
        elif data.get('status') == 'failed':
            result = data.get('result', {})
            response_data['error'] = result.get('error', '알 수 없는 오류')
        
        return Response(response_data)
        
    except Exception as e:
        logger.error(f"❌ 결과 조회 실패: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ============================================================
# 교육원 컴퓨터 추론 요청 API
# ============================================================

@api_view(['GET'])
@csrf_exempt
def get_pending_requests(request):
    """
    워커용: 대기 중인 요청 조회
    교육원 조원 요청사항에 맞춘 형식: {"count": 1, "requests": [{"id": 101, "filename": "..."}]}
    """
    try:
        PATHOLOGY_REQUEST_DIR.mkdir(exist_ok=True, parents=True)
        request_files = sorted(PATHOLOGY_REQUEST_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime)
        pending = []
        for rf in request_files:
            with open(rf, 'r', encoding='utf-8') as f:
                d = json.load(f)
                if d.get('status') == 'pending':
                    # 상태를 processing으로 변경하여 중복 할당 방지
                    d['status'] = 'processing'
                    d['started_at'] = timezone.now().isoformat()
                    with open(rf, 'w', encoding='utf-8') as f2:
                        json.dump(d, f2, indent=2, ensure_ascii=False)
                    
                    # 교육원 조원 요청 형식에 맞춤
                    filename = d.get('filename')
                    if not filename:
                        # filename이 없으면 건너뛰기 (필수 필드)
                        logger.warning(f"⚠️ filename이 없는 요청 건너뜀: {rf.stem}")
                        continue
                    
                    pending.append({
                        'id': rf.stem,  # request_id를 id로 사용 (task_id)
                        'filename': filename  # 교육원 워커가 wsi/ 폴더에서 찾을 파일명
                    })
                    break  # 가장 오래된 1개만 반환
        
        return Response({'count': len(pending), 'requests': pending})
    except Exception as e:
        logger.error(f"❌ 대기 중인 요청 조회 실패: {str(e)}", exc_info=True)
        return Response({'count': 0, 'requests': []}, status=500)


@api_view(['POST'])
@csrf_exempt
def update_request_status(request, request_id):
    """
    요청 상태 업데이트
    """
    try:
        request_file = PATHOLOGY_REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists():
            return Response({'success': False, 'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        d['status'] = request.data.get('status', d['status'])
        if request.data.get('started_at'):
            d['started_at'] = request.data.get('started_at')
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        return Response({'success': True})
    except Exception as e:
        logger.error(f"❌ 상태 업데이트 실패: {str(e)}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
@csrf_exempt
def complete_request(request, request_id):
    """
    추론 완료 결과 업로드 (기존 방식 유지)
    """
    try:
        request_file = PATHOLOGY_REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists():
            return Response({'success': False, 'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        d['status'] = 'completed' if request.data.get('success') else 'failed'
        d['result'] = request.data
        d['completed_at'] = timezone.now().isoformat()
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ 추론 완료 결과 저장: {request_id}")
        return Response({'success': True})
    except Exception as e:
        logger.error(f"❌ 결과 업로드 실패: {str(e)}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
@csrf_exempt
def complete_task(request):
    """
    교육원 조원 요청 형식에 맞춘 결과 수신
    
    Tumor 판정: multipart/form-data (JSON + 이미지 파일)
    Normal 판정: application/json (JSON만)
    
    JSON 필드:
    - task_id: 작업 ID (필수)
    - result: "Tumor" 또는 "Normal" (필수)
    - confidence: 확신도 0.0 ~ 1.0 (필수)
    - num_patches: 분석한 패치 개수 (선택)
    - top_attention_patches: 상위 attention 패치 인덱스 배열 (선택)
    - viewer_url: 뷰어 URL (선택)
    - dzi_url: OpenSeadragon용 DZI 메타데이터 URL (선택, 없으면 viewer_url 사용)
    
    이미지 파일 (Tumor 판정 시만):
    - {task_id}_overlay.png (우선) 또는 {task_id}_mask.png
    """
    try:
        # Content-Type 확인
        content_type = request.content_type or ''
        is_multipart = 'multipart/form-data' in content_type
        
        # JSON 데이터 추출
        if is_multipart:
            # multipart/form-data: request.data에서 직접 가져오기
            task_id = request.data.get('task_id')
            result_label = request.data.get('result')
            confidence = float(request.data.get('confidence', 0.0))
            num_patches = request.data.get('num_patches', 0)
            top_attention_patches = request.data.get('top_attention_patches', [])
            viewer_url = request.data.get('viewer_url', '')
            dzi_url = request.data.get('dzi_url', '')
            
            # 이미지 파일 처리 (Tumor 판정 시만)
            image_file = None
            image_filename = None
            if result_label == "Tumor":
                # 우선순위: overlay > mask
                overlay_key = f'{task_id}_overlay.png'
                mask_key = f'{task_id}_mask.png'
                
                if overlay_key in request.FILES:
                    image_file = request.FILES[overlay_key]
                    image_filename = f'{task_id}_overlay.png'
                    logger.info(f"📸 오버레이 이미지 수신: {image_filename}")
                elif mask_key in request.FILES:
                    image_file = request.FILES[mask_key]
                    image_filename = f'{task_id}_mask.png'
                    logger.info(f"📸 마스크 이미지 수신: {image_filename}")
                else:
                    # 다른 키로 올 수도 있음 (예: 'image', 'overlay', 'mask')
                    for key in request.FILES.keys():
                        if 'overlay' in key.lower() or key.endswith('_overlay.png'):
                            image_file = request.FILES[key]
                            image_filename = f'{task_id}_overlay.png'
                            logger.info(f"📸 오버레이 이미지 수신 (키: {key}): {image_filename}")
                            break
                    if not image_file:
                        for key in request.FILES.keys():
                            if 'mask' in key.lower() or key.endswith('_mask.png'):
                                image_file = request.FILES[key]
                                image_filename = f'{task_id}_mask.png'
                                logger.info(f"📸 마스크 이미지 수신 (키: {key}): {image_filename}")
                                break
        else:
            # application/json: request.data에서 직접 가져오기
            task_id = request.data.get('task_id')
            result_label = request.data.get('result')
            confidence = float(request.data.get('confidence', 0.0))
            num_patches = request.data.get('num_patches', 0)
            top_attention_patches = request.data.get('top_attention_patches', [])
            viewer_url = request.data.get('viewer_url', '')
            dzi_url = request.data.get('dzi_url', '')
            image_file = None
            image_filename = None
        
        # 필수 필드 검증
        if not task_id:
            return Response({'error': 'task_id가 필요합니다'}, status=400)
        if not result_label:
            return Response({'error': 'result가 필요합니다 ("Tumor" 또는 "Normal")'}, status=400)
        if result_label not in ['Tumor', 'Normal']:
            return Response({'error': 'result는 "Tumor" 또는 "Normal"이어야 합니다'}, status=400)
        
        # 요청 파일 찾기
        request_file = PATHOLOGY_REQUEST_DIR / f"{task_id}.json"
        if not request_file.exists():
            return Response({'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        # 결과 형식 변환
        class_id = 1 if result_label == "Tumor" else 0
        class_name = result_label
        probabilities = {
            "Normal": 1.0 - confidence if result_label == "Tumor" else confidence,
            "Tumor": confidence if result_label == "Tumor" else 1.0 - confidence
        }
        
        # 이미지 파일 저장 (Tumor 판정 시만)
        image_url = None
        if image_file and result_label == "Tumor":
            try:
                # 저장 디렉토리 생성: media/pathology_results/{task_id}/
                save_dir = os.path.join(settings.MEDIA_ROOT, 'pathology_results', str(task_id))
                os.makedirs(save_dir, exist_ok=True)
                
                # 파일 저장
                file_path = os.path.join(save_dir, image_filename)
                with open(file_path, 'wb') as f:
                    for chunk in image_file.chunks():
                        f.write(chunk)
                
                # URL 생성
                relative_path = os.path.join('pathology_results', str(task_id), image_filename)
                image_url = f"{settings.MEDIA_URL}{relative_path}".replace('\\', '/')
                
                logger.info(f"✅ 이미지 저장 완료: {file_path}, URL: {image_url}")
            except Exception as e:
                logger.error(f"❌ 이미지 저장 실패: {str(e)}", exc_info=True)
                # 이미지 저장 실패해도 결과는 저장
        
        # 결과 저장
        d['status'] = 'completed'
        d['result'] = {
            'success': True,
            'class_id': class_id,
            'class_name': class_name,
            'confidence': confidence,
            'probabilities': probabilities,
            'num_patches': num_patches,
            'top_attention_patches': top_attention_patches,
            'viewer_url': viewer_url if viewer_url else None,
            'dzi_url': dzi_url if dzi_url else None,  # OpenSeadragon용 (없으면 viewer_url 사용)
            'image_url': image_url  # 이미지 URL 추가
        }
        d['completed_at'] = timezone.now().isoformat()
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ 추론 완료 결과 저장: {task_id} - {class_name} ({confidence:.4f})")
        if image_url:
            logger.info(f"   📸 이미지 URL: {image_url}")
        
        return Response({'success': True, 'message': '결과 저장 완료'})
    except Exception as e:
        logger.error(f"❌ 결과 업로드 실패: {str(e)}", exc_info=True)
        return Response({'error': str(e)}, status=500)


@api_view(['POST'])
@csrf_exempt
def fail_task(request):
    """
    교육원 조원 요청 형식: POST /api/pathology/fail/
    Body: {"task_id": 101, "error": "File not found: ..."}
    """
    try:
        task_id = request.data.get('task_id')
        if not task_id:
            return Response({'error': 'task_id가 필요합니다'}, status=400)
        
        request_file = PATHOLOGY_REQUEST_DIR / f"{task_id}.json"
        if not request_file.exists():
            return Response({'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        error_msg = request.data.get('error', '알 수 없는 오류')
        
        d['status'] = 'failed'
        d['result'] = {
            'success': False,
            'error': error_msg
        }
        d['completed_at'] = timezone.now().isoformat()
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        logger.error(f"❌ 추론 실패 처리: {task_id} - {error_msg}")
        return Response({'success': True})
    except Exception as e:
        logger.error(f"❌ 실패 처리 실패: {str(e)}", exc_info=True)
        return Response({'error': str(e)}, status=500)


# ============================================================
# 교육원 컴퓨터 추론 요청 API
# ============================================================

@api_view(['GET'])
@csrf_exempt
def get_pending_requests(request):
    """
    워커용: 대기 중인 요청 조회
    교육원 조원 요청사항에 맞춘 형식: {"count": 1, "requests": [{"id": 101, "filename": "..."}]}
    """
    try:
        PATHOLOGY_REQUEST_DIR.mkdir(exist_ok=True, parents=True)
        request_files = sorted(PATHOLOGY_REQUEST_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime)
        pending = []
        for rf in request_files:
            with open(rf, 'r', encoding='utf-8') as f:
                d = json.load(f)
                if d.get('status') == 'pending':
                    # 상태를 processing으로 변경하여 중복 할당 방지
                    d['status'] = 'processing'
                    d['started_at'] = timezone.now().isoformat()
                    with open(rf, 'w', encoding='utf-8') as f2:
                        json.dump(d, f2, indent=2, ensure_ascii=False)
                    
                    # 교육원 조원 요청 형식에 맞춤
                    filename = d.get('filename')
                    if not filename:
                        # filename이 없으면 건너뛰기 (필수 필드)
                        logger.warning(f"⚠️ filename이 없는 요청 건너뜀: {rf.stem}")
                        continue
                    
                    pending.append({
                        'id': rf.stem,  # request_id를 id로 사용 (task_id)
                        'filename': filename  # 교육원 워커가 wsi/ 폴더에서 찾을 파일명
                    })
                    break  # 가장 오래된 1개만 반환
        
        return Response({'count': len(pending), 'requests': pending})
    except Exception as e:
        logger.error(f"❌ 대기 중인 요청 조회 실패: {str(e)}", exc_info=True)
        return Response({'count': 0, 'requests': []}, status=500)


@api_view(['POST'])
@csrf_exempt
def update_request_status(request, request_id):
    """
    요청 상태 업데이트
    """
    try:
        request_file = PATHOLOGY_REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists():
            return Response({'success': False, 'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        d['status'] = request.data.get('status', d['status'])
        if request.data.get('started_at'):
            d['started_at'] = request.data.get('started_at')
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        return Response({'success': True})
    except Exception as e:
        logger.error(f"❌ 상태 업데이트 실패: {str(e)}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
@csrf_exempt
def complete_request(request, request_id):
    """
    추론 완료 결과 업로드 (기존 방식 유지)
    """
    try:
        request_file = PATHOLOGY_REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists():
            return Response({'success': False, 'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        d['status'] = 'completed' if request.data.get('success') else 'failed'
        d['result'] = request.data
        d['completed_at'] = timezone.now().isoformat()
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ 추론 완료 결과 저장: {request_id}")
        return Response({'success': True})
    except Exception as e:
        logger.error(f"❌ 결과 업로드 실패: {str(e)}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
@csrf_exempt
def fail_task(request):
    """
    교육원 조원 요청 형식: POST /api/pathology/fail/
    Body: {"task_id": 101, "error": "File not found: ..."}
    """
    try:
        task_id = request.data.get('task_id')
        if not task_id:
            return Response({'error': 'task_id가 필요합니다'}, status=400)
        
        request_file = PATHOLOGY_REQUEST_DIR / f"{task_id}.json"
        if not request_file.exists():
            return Response({'error': '요청을 찾을 수 없습니다'}, status=404)
        
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        error_msg = request.data.get('error', '알 수 없는 오류')
        
        d['status'] = 'failed'
        d['result'] = {
            'success': False,
            'error': error_msg
        }
        d['completed_at'] = timezone.now().isoformat()
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        
        logger.error(f"❌ 추론 실패 처리: {task_id} - {error_msg}")
        return Response({'success': True})
    except Exception as e:
        logger.error(f"❌ 실패 처리 실패: {str(e)}", exc_info=True)
        return Response({'error': str(e)}, status=500)


@api_view(['POST'])
@csrf_exempt
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([IsAuthenticated])
def save_pathology_result(request):
    """
    병리 분석 결과를 OCS Order에 저장 (알림 없이, 상태 변경 없이)
    검사실에서 결과 입력 및 전달은 input_pathology_result API 사용
    
    Request Body:
        {
            "order_id": "uuid",
            "class_id": 1,
            "class_name": "Tumor",
            "confidence": 0.95,
            "probabilities": {"Normal": 0.05, "Tumor": 0.95},
            "filename": "tumor_083.tif",
            "image_url": "/media/pathology_results/...",
            "findings": "종양 조직이 관찰됨",
            "recommendations": "추가 검사 권장"
        }
    """
    try:
        if not PathologyAnalysisResult or not Order:
            return Response(
                {'error': 'OCS 모델을 불러올 수 없습니다'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'error': 'order_id가 필요합니다'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Order 확인
        try:
            order = Order.objects.get(id=order_id)
        except Order.DoesNotExist:
            return Response({'error': '주문을 찾을 수 없습니다'}, status=status.HTTP_404_NOT_FOUND)

        # 필수 필드 검증
        class_id = request.data.get('class_id')
        class_name = request.data.get('class_name')
        confidence = request.data.get('confidence')
        
        if class_id is None or not class_name or confidence is None:
            logger.error(f"❌ 필수 필드 누락: class_id={class_id}, class_name={class_name}, confidence={confidence}")
            return Response({
                'error': '필수 필드가 누락되었습니다: class_id, class_name, confidence가 필요합니다'
            }, status=status.HTTP_400_BAD_REQUEST)

        # 이미지 URL이 있으면: 외부 URL이면 다운로드 후 우리 서버 media에 저장 → 연구실 PC 꺼져 있어도 OCS에서 계속 표시
        image_url = request.data.get('image_url', '')
        orthanc_instance_id = None
        is_external_url = image_url.startswith('http://') or image_url.startswith('https://')
        
        if image_url:
            try:
                from PIL import Image
                import requests as req_lib
                from urllib.parse import urlparse
                from .utils import pil_image_to_dicom
                from .orthanc_client import OrthancClient
                from django.core.files.base import ContentFile
                
                logger.info(f"📥 병리 이미지 다운로드 시작: {image_url}")
                
                # 절대 URL로 변환 (상대 경로면 우리 서버 기준)
                if image_url.startswith('/'):
                    full_image_url = f"{request.scheme}://{request.get_host()}{image_url}"
                else:
                    full_image_url = image_url
                
                img_response = req_lib.get(full_image_url, timeout=30)
                img_response.raise_for_status()
                
                img_bytes = img_response.content
                img_data = ContentFile(img_bytes)
                pil_image = Image.open(img_data)
                
                # 외부 URL이면 우리 서버 media에 저장 → DB에는 우리 서버 경로만 저장 (연구실 PC 꺼져 있어도 표시)
                if is_external_url:
                    save_dir = os.path.join(settings.MEDIA_ROOT, 'pathology_results', str(order_id))
                    os.makedirs(save_dir, exist_ok=True)
                    # URL에서 파일명 추출 (예: ..._mask.png), 없으면 기본값
                    parsed = urlparse(full_image_url)
                    base_name = os.path.basename(parsed.path) or f"pathology_{order_id}_mask.png"
                    # 확장자 보정
                    if not base_name.lower().endswith(('.png', '.jpg', '.jpeg', '.tif', '.tiff')):
                        base_name = base_name.rsplit('.', 1)[0] + '.png'
                    save_path = os.path.join(save_dir, base_name)
                    with open(save_path, 'wb') as f:
                        f.write(img_bytes)
                    our_relative = os.path.join('pathology_results', str(order_id), base_name).replace('\\', '/')
                    image_url = f"{settings.MEDIA_URL.rstrip('/')}/{our_relative}".replace('//', '/')
                    logger.info(f"✅ 병리 이미지 우리 서버 저장: {save_path} → image_url={image_url}")
                
                # Orthanc 업로드 (MRI 뷰 연동)
                patient_id = order.patient.patient_id if order.patient else None
                patient_name = order.patient.name if order.patient else 'Unknown'
                
                if not patient_id:
                    logger.warning("⚠️ 환자 ID가 없어 Orthanc 업로드를 건너뜁니다.")
                else:
                    logger.info(f"🔄 병리 이미지를 DICOM으로 변환 중... (환자 ID: {patient_id})")
                    orthanc_client = OrthancClient()
                    study_instance_uid = None
                    try:
                        study_instance_uid = orthanc_client.get_existing_study_instance_uid(patient_id)
                    except Exception as e:
                        logger.debug(f"기존 Study 찾기 실패 (새로 생성): {e}")
                    
                    dicom_bytes = pil_image_to_dicom(
                        pil_image=pil_image,
                        patient_id=patient_id,
                        patient_name=patient_name,
                        series_description=f"Pathology Analysis - {class_name}",
                        modality="SM",
                        orthanc_client=orthanc_client,
                        study_instance_uid=study_instance_uid
                    )
                    logger.info(f"📤 Orthanc에 병리 이미지 업로드 중...")
                    upload_result = orthanc_client.upload_dicom(dicom_bytes)
                    orthanc_instance_id = upload_result.get('ID') if isinstance(upload_result, dict) else upload_result
                    logger.info(f"✅ 병리 이미지 Orthanc 업로드 완료: instance_id={orthanc_instance_id}")
                    
            except Exception as e:
                logger.error(f"❌ 병리 이미지 처리 실패: {str(e)}", exc_info=True)
                if is_external_url:
                    image_url = request.data.get('image_url', '')  # 실패 시 원본 URL 유지
                logger.warning("⚠️ 이미지 처리 실패했지만 분석 결과는 저장합니다.")
        
        # 고해상도 뷰어용 URL 받기 (워커 PC가 제공)
        dzi_url = request.data.get('dzi_url', '')
        viewer_url = request.data.get('viewer_url', '')
        
        # 이미 분석 결과가 있으면 업데이트, 없으면 생성 (image_url = 우리 서버 경로로 저장됨)
        pathology_analysis, created = PathologyAnalysisResult.objects.update_or_create(
            order=order,
            defaults={
                'analyzed_by': request.user if request.user.is_authenticated else None,
                'class_id': class_id,
                'class_name': class_name,
                'confidence': float(confidence),
                'probabilities': request.data.get('probabilities', {}),
                'filename': request.data.get('filename', ''),
                'image_url': image_url,
                'dzi_url': dzi_url,  # 고해상도 뷰어용 DZI URL
                'viewer_url': viewer_url,  # 대체 뷰어 URL
                'findings': request.data.get('findings', ''),
                'recommendations': request.data.get('recommendations', ''),
            }
        )
        
        # 주문 상태는 변경하지 않음 (검사실에서 결과 입력 시 변경)
        # 알림도 보내지 않음 (검사실에서 전달 시 보냄)
        
        logger.info(f"✅ 병리 분석 결과 저장 완료 (알림 없음): order_id={order_id}, class_name={request.data.get('class_name')}, orthanc_instance_id={orthanc_instance_id}")
        
        return Response({
            'success': True,
            'message': '분석 결과가 저장되었습니다',
            'created': created,
            'analysis_id': str(pathology_analysis.id),
            'orthanc_instance_id': orthanc_instance_id
        })
        
    except Exception as e:
        logger.error(f"❌ 병리 분석 결과 저장 실패: {str(e)}", exc_info=True)
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# 연구실 PC 미디어 베이스 URL (환경변수). 예: http://연구실PC_IP:8000
PATHOLOGY_WORKER_MEDIA_URL = os.getenv('PATHOLOGY_WORKER_MEDIA_URL', '').rstrip('/')


@api_view(['POST'])
@csrf_exempt
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([IsAuthenticated])
def sync_pathology_image_from_worker(request):
    """
    이미 DB에 우리 서버 경로(/media/...)로 저장됐지만 파일이 없는 경우,
    연구실 PC에서 이미지를 받아와 우리 서버에 저장합니다.
    연구실 PC가 켜져 있을 때 한 번 호출하면 OCS에서 계속 표시됩니다.

    Request Body: { "order_id": "uuid" }
    또는 Query: ?order_id=uuid
    """
    try:
        if not PathologyAnalysisResult or not Order:
            return Response(
                {'error': 'OCS 모델을 불러올 수 없습니다'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        order_id = request.data.get('order_id') or request.query_params.get('order_id')
        if not order_id:
            return Response({'error': 'order_id가 필요합니다'}, status=status.HTTP_400_BAD_REQUEST)
        if not PATHOLOGY_WORKER_MEDIA_URL:
            return Response({
                'error': 'PATHOLOGY_WORKER_MEDIA_URL 환경변수가 설정되지 않았습니다. '
                         '예: PATHOLOGY_WORKER_MEDIA_URL=http://연구실PC_IP:8000'
            }, status=status.HTTP_400_BAD_REQUEST)

        order = Order.objects.get(id=order_id)
        try:
            pathology = order.pathology_analysis
        except PathologyAnalysisResult.DoesNotExist:
            return Response({'error': '이 주문에는 병리 분석 결과가 없습니다'}, status=status.HTTP_404_NOT_FOUND)
        raw_url = (pathology.image_url or '').strip()
        if not raw_url or not raw_url.startswith('/media/'):
            return Response({
                'message': '이 주문에는 우리 서버 경로 이미지가 없거나, 이미 외부 URL입니다.',
                'image_url': raw_url
            }, status=status.HTTP_200_OK)

        # 우리 서버에 파일이 이미 있으면 스킵
        media_url = (getattr(settings, 'MEDIA_URL', '/media/') or '/media/').rstrip('/')
        relative = raw_url[len('/media/'):].lstrip('/').replace('\\', '/')
        full_path = os.path.join(settings.MEDIA_ROOT, relative).replace('\\', os.sep)
        if os.path.isfile(full_path):
            return Response({
                'success': True,
                'message': '이미 우리 서버에 파일이 있습니다.',
                'path': full_path
            }, status=status.HTTP_200_OK)

        # 연구실 PC에서 다운로드
        full_image_url = f"{PATHOLOGY_WORKER_MEDIA_URL}{raw_url}"
        import requests as req_lib
        logger.info(f"📥 연구실 PC에서 병리 이미지 동기화: {full_image_url}")
        img_response = req_lib.get(full_image_url, timeout=30)
        img_response.raise_for_status()
        img_bytes = img_response.content

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'wb') as f:
            f.write(img_bytes)
        logger.info(f"✅ 병리 이미지 우리 서버 저장 완료: {full_path}")

        return Response({
            'success': True,
            'message': '연구실 PC에서 이미지를 받아 우리 서버에 저장했습니다.',
            'path': full_path,
            'image_url': raw_url
        }, status=status.HTTP_200_OK)

    except Order.DoesNotExist:
        return Response({'error': '주문을 찾을 수 없습니다'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"❌ 병리 이미지 동기화 실패: {str(e)}", exc_info=True)
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
