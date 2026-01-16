from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django_filters.rest_framework import DjangoFilterBackend
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.conf import settings
from django.http import FileResponse, Http404
from django.utils import timezone
import os
import requests
import base64
import traceback
import logging
from urllib.parse import unquote
from PIL import Image
from io import BytesIO
from .models import MedicalImage, AIAnalysisResult
from .serializers import MedicalImageSerializer
from mri_viewer.orthanc_client import OrthancClient
from mri_viewer.utils import pil_image_to_dicom

logger = logging.getLogger(__name__)

# 딥러닝 서비스 URL
# 환경 변수 우선, 없으면 기본값 사용
# GCP 서버에서는 같은 서버 내부 통신이므로 127.0.0.1 사용
DL_SERVICE_URL = os.environ.get('DL_SERVICE_URL', 'http://127.0.0.1:5003')

@method_decorator(csrf_exempt, name='dispatch')
class MedicalImageViewSet(viewsets.ModelViewSet):
    queryset = MedicalImage.objects.all()
    serializer_class = MedicalImageSerializer
    authentication_classes = []
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['image_type', 'patient_id']
    search_fields = ['description', 'doctor_notes', 'patient_id']
    ordering_fields = ['taken_date', 'created_at']
    ordering = ['-taken_date']
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context.update({
            'request': self.request
        })
        return context
    
    @action(detail=True, methods=['get'])
    def image(self, request, pk=None):
        """
        이미지 파일 직접 서빙 엔드포인트
        GET /api/medical-images/{id}/image/
        한국어 파일명 문제를 해결하기 위해 이미지를 직접 서빙
        """
        try:
            medical_image = self.get_object()
            logger.info(f"이미지 서빙 요청: ID={pk}, 파일명={medical_image.image_file.name if medical_image.image_file else 'None'}")
            
            if not medical_image.image_file:
                logger.warning(f"이미지 파일이 없음: ID={pk}")
                raise Http404("이미지 파일이 없습니다.")
            
            # 이미지 파일 경로 찾기
            image_path = None
            
            # 방법 1: image_file.path 사용
            try:
                if hasattr(medical_image.image_file, 'path'):
                    image_path = medical_image.image_file.path
                    if os.path.exists(image_path):
                        logger.info(f"이미지 파일 찾음 (path): {image_path}")
                        ext = os.path.splitext(image_path)[1].lower()
                        content_type_map = {
                            '.jpg': 'image/jpeg',
                            '.jpeg': 'image/jpeg',
                            '.png': 'image/png',
                            '.gif': 'image/gif',
                            '.bmp': 'image/bmp',
                        }
                        content_type = content_type_map.get(ext, 'image/jpeg')
                        return FileResponse(open(image_path, 'rb'), content_type=content_type)
            except (AttributeError, ValueError, OSError) as e:
                logger.warning(f"image_file.path 접근 실패: {e}")
                pass
            
            # 방법 2: MEDIA_ROOT에서 찾기
            if not image_path:
                file_name = medical_image.image_file.name
                if file_name.startswith('medical_images/'):
                    file_name = file_name.replace('medical_images/', '', 1)
                
                # 여러 경로 시도 (새로운 경로 구조: medical_images/patient_id/images/YYYY/MM/DD/파일명)
                possible_paths = [
                    os.path.join(settings.MEDIA_ROOT, medical_image.image_file.name),  # 전체 경로
                    os.path.join(settings.MEDIA_ROOT, 'medical_images', file_name),  # 상대 경로
                    os.path.join(settings.MEDIA_ROOT, 'medical_images', os.path.basename(file_name)),  # 파일명만
                    os.path.join(settings.MEDIA_ROOT, 'medical_images', unquote(file_name)),  # 디코딩된 경로
                ]
                
                # patient_id를 포함한 경로도 시도 (새로운 경로 구조: images/ 폴더 포함)
                if medical_image.patient_id:
                    # patient_id/images/YYYY/MM/DD/파일명 형식 (새 구조)
                    if '/' in file_name:
                        # 날짜 경로가 포함된 경우
                        date_and_file = file_name
                        possible_paths.insert(1, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', date_and_file))
                        # 기존 구조 호환성 (images/ 없이)
                        possible_paths.insert(2, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), date_and_file))
                    # 파일명만 있는 경우
                    possible_paths.insert(1, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', os.path.basename(file_name)))
                    # 기존 구조 호환성
                    possible_paths.insert(2, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), os.path.basename(file_name)))
                
                for path in possible_paths:
                    if os.path.exists(path) and os.path.isfile(path):
                        image_path = path
                        break
                
                # 파일명 일부로 검색 (최후의 수단)
                if not image_path:
                    medical_images_dir = os.path.join(settings.MEDIA_ROOT, 'medical_images')
                    if os.path.exists(medical_images_dir):
                        base_name = os.path.splitext(os.path.basename(file_name))[0]
                        decoded_base_name = os.path.splitext(os.path.basename(unquote(file_name)))[0]
                        
                        for root, dirs, files in os.walk(medical_images_dir):
                            for f in files:
                                file_base = os.path.splitext(f)[0]
                                if base_name in file_base or decoded_base_name in file_base or file_base in base_name or file_base in decoded_base_name:
                                    full_path = os.path.join(root, f)
                                    if os.path.exists(full_path):
                                        image_path = full_path
                                        break
                            if image_path:
                                break
                
                if image_path and os.path.exists(image_path):
                    # 파일 확장자에 따라 content_type 결정
                    ext = os.path.splitext(image_path)[1].lower()
                    content_type_map = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.gif': 'image/gif',
                        '.bmp': 'image/bmp',
                    }
                    content_type = content_type_map.get(ext, 'image/jpeg')
                    logger.info(f"이미지 파일 찾음 (MEDIA_ROOT): {image_path}, content_type={content_type}")
                    return FileResponse(open(image_path, 'rb'), content_type=content_type)
            
            logger.error(f"이미지 파일을 찾을 수 없음: ID={pk}, 파일명={medical_image.image_file.name}, MEDIA_ROOT={settings.MEDIA_ROOT}")
            raise Http404(f"이미지 파일을 찾을 수 없습니다. (파일명: {medical_image.image_file.name})")
            
        except MedicalImage.DoesNotExist:
            raise Http404("의료 이미지를 찾을 수 없습니다.")
        except Exception as e:
            logger.error(f"이미지 서빙 중 오류: {str(e)}")
            raise Http404(f"이미지를 불러올 수 없습니다: {str(e)}")
    
    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        """
        의료 이미지 AI 분석 엔드포인트 (1차: 세그멘테이션)
        POST /api/medical-images/{id}/analyze/
        analysis_type: 'segmentation' (기본값) 또는 'classification'
        """
        try:
            medical_image = self.get_object()
            
            if not medical_image.image_file:
                return Response(
                    {'error': '이미지 파일이 없습니다.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # 분석 타입 가져오기 (기본값: segmentation)
            analysis_type = request.data.get('analysis_type', 'segmentation')
            
            # 이미지 파일 읽기 - base64 우선, URL은 최후의 수단
            image_url = None
            image_base64 = None
            
            # 방법 1: image_file.path 사용 (가장 확실한 방법)
            try:
                image_path = medical_image.image_file.path
                if os.path.exists(image_path):
                    with open(image_path, 'rb') as f:
                        image_bytes = f.read()
                        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
                        logger.info(f"이미지 파일 로드 성공 (path): {image_path}")
            except (AttributeError, ValueError, OSError) as e:
                logger.warning(f"image_file.path 접근 실패: {e}")
                # 방법 2: MEDIA_ROOT에서 직접 찾기
                try:
                    if medical_image.image_file.name:
                        # 파일명 가져오기
                        file_name = medical_image.image_file.name
                        
                        # medical_images/ 제거
                        if file_name.startswith('medical_images/'):
                            file_name = file_name.replace('medical_images/', '', 1)
                        
                        # URL 인코딩된 파일명 디코딩 시도
                        decoded_file_name = unquote(file_name)
                        
                        # 여러 경로 시도 (한국어 파일명, URL 인코딩된 파일명 모두 시도)
                        possible_paths = [
                            os.path.join(settings.MEDIA_ROOT, medical_image.image_file.name),  # 전체 경로
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', file_name),  # 원본 파일명
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', decoded_file_name),  # 디코딩된 파일명
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', os.path.basename(file_name)),  # basename
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', os.path.basename(decoded_file_name)),  # 디코딩된 basename
                        ]
                        
                        # patient_id를 포함한 경로 시도 (새로운 경로 구조: medical_images/patient_id/images/YYYY/MM/DD/파일명)
                        if medical_image.patient_id:
                            # patient_id/images/YYYY/MM/DD/파일명 형식 (새 구조)
                            if '/' in file_name:
                                # 날짜 경로가 포함된 경우
                                date_and_file = file_name
                                possible_paths.insert(1, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', date_and_file))
                                possible_paths.insert(2, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', decoded_file_name))
                                # 기존 구조 호환성 (images/ 없이)
                                possible_paths.insert(3, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), date_and_file))
                            # 파일명만 있는 경우
                            possible_paths.insert(1, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', os.path.basename(file_name)))
                            # 기존 구조 호환성
                            possible_paths.insert(2, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), os.path.basename(file_name)))
                        
                        # 날짜별 폴더 구조도 시도 (YYYY/MM/DD/파일명) - 기존 형식 호환성
                        if '/' in file_name:
                            date_parts = file_name.split('/')
                            if len(date_parts) >= 2:
                                date_path = '/'.join(date_parts[:-1])
                                filename_only = date_parts[-1]
                                possible_paths.extend([
                                    os.path.join(settings.MEDIA_ROOT, 'medical_images', date_path, filename_only),
                                    os.path.join(settings.MEDIA_ROOT, 'medical_images', date_path, unquote(filename_only)),
                                ])
                                # patient_id 포함 경로도 추가 (새 구조: images/ 포함)
                                if medical_image.patient_id:
                                    possible_paths.extend([
                                        os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', date_path, filename_only),
                                        os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), 'images', date_path, unquote(filename_only)),
                                        # 기존 구조 호환성
                                        os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), date_path, filename_only),
                                        os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), date_path, unquote(filename_only)),
                                    ])
                        
                        # MEDIA_ROOT의 medical_images 디렉토리에서 모든 파일 검색 (최후의 수단)
                        medical_images_dir = os.path.join(settings.MEDIA_ROOT, 'medical_images')
                        if os.path.exists(medical_images_dir):
                            # 파일명의 일부만으로 검색 (확장자 제외)
                            base_name = os.path.splitext(os.path.basename(file_name))[0]
                            decoded_base_name = os.path.splitext(os.path.basename(decoded_file_name))[0]
                            
                            for root, dirs, files in os.walk(medical_images_dir):
                                for f in files:
                                    file_base = os.path.splitext(f)[0]
                                    # 파일명의 일부가 일치하면 시도
                                    if base_name in file_base or decoded_base_name in file_base or file_base in base_name or file_base in decoded_base_name:
                                        full_path = os.path.join(root, f)
                                        if full_path not in possible_paths:
                                            possible_paths.append(full_path)
                        
                        # 모든 경로 시도
                        for media_path in possible_paths:
                            try:
                                if os.path.exists(media_path) and os.path.isfile(media_path):
                                    with open(media_path, 'rb') as f:
                                        image_bytes = f.read()
                                        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
                                        logger.info(f"이미지 파일 로드 성공 (MEDIA_ROOT): {media_path}")
                                        break
                            except Exception as path_error:
                                continue
                                
                except Exception as e2:
                    logger.error(f"MEDIA_ROOT에서 이미지 찾기 실패: {e2}", exc_info=True)
            
            # base64로 로드 실패한 경우에만 URL 사용 (최후의 수단)
            if not image_base64:
                logger.warning(f"파일 시스템에서 이미지를 찾지 못함. URL 사용 시도: {medical_image.image_file.name}")
                # 프로덕션 환경에서는 항상 PRODUCTION_DOMAIN 사용
                try:
                    image_url = f"{settings.PRODUCTION_DOMAIN}{medical_image.image_file.url}"
                    logger.info(f"이미지 URL 생성: {image_url}")
                except Exception as e:
                    logger.error(f"이미지 URL 생성 실패: {e}")
            
            # base64 또는 URL이 없으면 에러
            if not image_base64 and not image_url:
                return Response(
                    {
                        'error': '이미지 파일을 읽을 수 없습니다.',
                        'detail': f'파일명: {getattr(medical_image.image_file, "name", "N/A")}, MEDIA_ROOT: {settings.MEDIA_ROOT}'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # 딥러닝 서비스 호출
            try:
                # mosec 서비스는 /inference 엔드포인트 사용
                if image_url:
                    payload = {
                        'image_url': image_url,
                        'patient_id': medical_image.patient_id,
                        'analysis_type': analysis_type,  # 'segmentation' 또는 'classification'
                        'metadata': {
                            'image_type': medical_image.image_type,
                            'image_id': str(medical_image.id)
                        }
                    }
                else:
                    payload = {
                        'image_data': image_base64,
                        'patient_id': medical_image.patient_id,
                        'analysis_type': analysis_type,  # 'segmentation' 또는 'classification'
                        'metadata': {
                            'image_type': medical_image.image_type,
                            'image_id': str(medical_image.id)
                        }
                    }
                
                # 딥러닝 서비스 헬스 체크 먼저 수행
                try:
                    health_response = requests.get(f'{DL_SERVICE_URL}/health', timeout=5)
                    if health_response.status_code != 200:
                        logger.warning(f"딥러닝 서비스 헬스 체크 실패: {health_response.status_code}")
                except Exception as health_error:
                    logger.warning(f"딥러닝 서비스 헬스 체크 실패: {health_error}")
                    return Response(
                        {
                            'error': '딥러닝 서비스에 연결할 수 없습니다.',
                            'detail': f'mosec 서비스가 실행되지 않았거나 응답하지 않습니다. (URL: {DL_SERVICE_URL})',
                            'solution': 'GCP 서버에서 다음 명령어로 서비스 상태를 확인하세요:\nsudo systemctl status breast-ai-service\nsudo systemctl restart breast-ai-service'
                        },
                        status=status.HTTP_503_SERVICE_UNAVAILABLE
                    )
                
                # 타임아웃을 120초로 증가 (대용량 이미지 처리 시간 고려)
                response = requests.post(
                    f'{DL_SERVICE_URL}/inference',
                    json=payload,
                    timeout=120  # 딥러닝 추론은 시간이 걸릴 수 있음 (60초 -> 120초로 증가)
                )
                
                if response.status_code != 200:
                    error_detail = response.text[:500] if response.text else '응답 없음'
                    logger.error(f"딥러닝 서비스 오류: {response.status_code}, 상세: {error_detail}")
                    return Response(
                        {
                            'error': f'딥러닝 서비스 오류: {response.status_code}',
                            'detail': error_detail
                        },
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )
                
                result = response.json()
                
                if not result.get('success'):
                    return Response(
                        {'error': result.get('error', '분석 실패')},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )
                
                analysis_data = result.get('data', {})
                
                # 분석 결과 저장
                # analysis_type이 segmentation이면 'BREAST_MRI_SEGMENTATION', classification이면 'BREAST_MRI_CLASSIFICATION'
                db_analysis_type = 'BREAST_MRI_SEGMENTATION' if analysis_type == 'segmentation' else 'BREAST_MRI_CLASSIFICATION'
                
                # 세그멘테이션 결과인 경우 마스크 이미지 저장
                mask_path = None
                if analysis_type == 'segmentation' and analysis_data.get('mask_image'):
                    try:
                        # 마스크 이미지 데이터 가져오기 (base64 또는 이미지 데이터)
                        mask_data = analysis_data.get('mask_image')
                        
                        # base64 디코딩
                        if isinstance(mask_data, str):
                            if mask_data.startswith('data:image'):
                                mask_data = mask_data.split(',')[1]
                            mask_bytes = base64.b64decode(mask_data)
                        else:
                            # 이미 바이너리인 경우
                            mask_bytes = mask_data
                        
                        # PIL Image로 변환
                        mask_image = Image.open(BytesIO(mask_bytes))
                        
                        # 마스크 저장 경로 생성: medical_images/patient_id/masks/YYYY/MM/DD/파일명
                        date_path = timezone.now().strftime('%Y/%m/%d')
                        original_filename = os.path.basename(medical_image.image_file.name)
                        filename_without_ext = os.path.splitext(original_filename)[0]
                        mask_filename = f"{filename_without_ext}_mask.png"
                        
                        mask_dir = os.path.join(
                            settings.MEDIA_ROOT,
                            'medical_images',
                            str(medical_image.patient_id),
                            'masks',
                            date_path
                        )
                        os.makedirs(mask_dir, exist_ok=True)
                        
                        mask_path = os.path.join(mask_dir, mask_filename)
                        mask_image.save(mask_path, 'PNG')
                        
                        # 상대 경로 저장 (MEDIA_ROOT 기준)
                        mask_relative_path = os.path.join(
                            'medical_images',
                            str(medical_image.patient_id),
                            'masks',
                            date_path,
                            mask_filename
                        )
                        
                        logger.info(f"마스크 이미지 저장 완료: {mask_path}")
                        
                        # 마스크 경로를 results에 추가
                        if not analysis_data.get('results'):
                            analysis_data['results'] = {}
                        analysis_data['results']['mask_path'] = mask_relative_path
                        analysis_data['results']['mask_url'] = f"{settings.MEDIA_URL}{mask_relative_path}"
                        
                    except Exception as mask_error:
                        logger.error(f"마스크 이미지 저장 실패: {str(mask_error)}", exc_info=True)
                        # 마스크 저장 실패해도 분석 결과는 저장
                
                # Classification인 경우 heatmap 이미지를 Orthanc에 저장
                logger.info(f"=== Classification 분석 결과 확인 ===")
                logger.info(f"analysis_type: {analysis_type}")
                logger.info(f"heatmap_image 존재 여부: {bool(analysis_data.get('heatmap_image'))}")
                logger.info(f"analysis_data keys: {list(analysis_data.keys())}")
                logger.info(f"analysis_data 전체: {str(analysis_data)[:500]}")
                
                if analysis_type == 'classification':
                    if not analysis_data.get('heatmap_image'):
                        logger.error(f"⚠️ heatmap_image가 analysis_data에 없습니다! AI 서비스가 heatmap_image를 반환하지 않았을 수 있습니다.")
                        logger.error(f"analysis_data 내용: {analysis_data}")
                    else:
                        logger.info(f"✅ heatmap_image 발견! Orthanc 저장 시작")
                
                if analysis_type == 'classification' and analysis_data.get('heatmap_image'):
                    try:
                        logger.info(f"히트맵 이미지 Orthanc 저장 시작. patient_id: {medical_image.patient_id}")
                        # heatmap 이미지 데이터 가져오기 (base64)
                        heatmap_data = analysis_data.get('heatmap_image')
                        logger.info(f"heatmap_data type: {type(heatmap_data)}, length: {len(heatmap_data) if isinstance(heatmap_data, str) else 'N/A'}")
                        
                        # base64 디코딩
                        if isinstance(heatmap_data, str):
                            if heatmap_data.startswith('data:image'):
                                heatmap_data = heatmap_data.split(',')[1]
                            heatmap_bytes = base64.b64decode(heatmap_data)
                            logger.info(f"Base64 디코딩 완료. bytes length: {len(heatmap_bytes)}")
                        else:
                            heatmap_bytes = heatmap_data
                        
                        # PIL Image로 변환
                        heatmap_image = Image.open(BytesIO(heatmap_bytes))
                        logger.info(f"PIL Image 변환 완료. size: {heatmap_image.size}, mode: {heatmap_image.mode}")
                        
                        # 원본 이미지도 Orthanc에 저장
                        original_image_path = medical_image.image_file.path if hasattr(medical_image.image_file, 'path') else None
                        logger.info(f"원본 이미지 경로: {original_image_path}, 존재 여부: {os.path.exists(original_image_path) if original_image_path else False}")
                        
                        # Orthanc 클라이언트 생성 (기존 Study 찾기용)
                        logger.info("Orthanc 클라이언트 생성")
                        orthanc_client = OrthancClient()
                        logger.info(f"Orthanc URL: {orthanc_client.base_url}")
                        
                        # 기존 StudyInstanceUID 찾기 (같은 환자의 기존 Study에 속하도록)
                        existing_study_uid = None
                        try:
                            existing_study_uid = orthanc_client.get_existing_study_instance_uid(str(medical_image.patient_id))
                            if existing_study_uid:
                                logger.info(f"기존 StudyInstanceUID 찾음: {existing_study_uid[:20]}... (patient_id: {medical_image.patient_id})")
                            else:
                                logger.info(f"기존 Study 없음, 새로 생성 (patient_id: {medical_image.patient_id})")
                        except Exception as study_error:
                            logger.warning(f"기존 StudyInstanceUID 찾기 실패: {str(study_error)}")
                        
                        if original_image_path and os.path.exists(original_image_path):
                            try:
                                logger.info("원본 이미지 Orthanc 저장 시작")
                                original_image = Image.open(original_image_path)
                                original_dicom = pil_image_to_dicom(
                                    original_image,
                                    patient_id=str(medical_image.patient_id),
                                    patient_name=str(medical_image.patient_id),
                                    series_description="Original Mammography",
                                    modality="MG",
                                    orthanc_client=orthanc_client,
                                    study_instance_uid=existing_study_uid
                                )
                                logger.info(f"원본 DICOM 변환 완료. size: {len(original_dicom)} bytes")
                                original_result = orthanc_client.upload_dicom(original_dicom)
                                logger.info(f"원본 맘모그래피 이미지 Orthanc 저장 완료: {original_result}")
                            except Exception as orig_error:
                                logger.error(f"원본 이미지 Orthanc 저장 실패: {str(orig_error)}", exc_info=True)
                        else:
                            logger.warning(f"원본 이미지 경로가 없거나 파일이 존재하지 않습니다: {original_image_path}")
                        
                        # heatmap 이미지를 DICOM으로 변환 (같은 Study에 속하도록)
                        logger.info("히트맵 DICOM 변환 시작")
                        heatmap_dicom = pil_image_to_dicom(
                            heatmap_image,
                            patient_id=str(medical_image.patient_id),
                            patient_name=str(medical_image.patient_id),
                            series_description="Heatmap Image",
                            modality="MG",
                            orthanc_client=orthanc_client,
                            study_instance_uid=existing_study_uid
                        )
                        logger.info(f"히트맵 DICOM 변환 완료. size: {len(heatmap_dicom)} bytes")
                        
                        # Orthanc에 업로드
                        logger.info("히트맵 Orthanc 업로드 시작")
                        heatmap_result = orthanc_client.upload_dicom(heatmap_dicom)
                        logger.info(f"히트맵 이미지 Orthanc 저장 완료: {heatmap_result}")
                        
                        # results에 Orthanc 인스턴스 ID 저장
                        if not analysis_data.get('results'):
                            analysis_data['results'] = {}
                        if isinstance(heatmap_result, dict) and 'ID' in heatmap_result:
                            analysis_data['results']['heatmap_orthanc_instance_id'] = heatmap_result['ID']
                            analysis_data['results']['heatmap_orthanc_url'] = f"{orthanc_client.base_url}/instances/{heatmap_result['ID']}/preview"
                        
                    except Exception as heatmap_error:
                        logger.error(f"히트맵 이미지 Orthanc 저장 실패: {str(heatmap_error)}", exc_info=True)
                        # 히트맵 저장 실패해도 분석 결과는 저장
                
                analysis_result = AIAnalysisResult.objects.create(
                    image=medical_image,
                    analysis_type=db_analysis_type,
                    results=analysis_data.get('results', analysis_data.get('probabilities', {})),
                    confidence=analysis_data.get('confidence'),
                    findings=analysis_data.get('findings', ''),
                    recommendations=analysis_data.get('recommendations', ''),
                    model_version=analysis_data.get('model_version', '1.0.0')
                )
                
                # 시리얼라이저로 응답 반환
                serializer = self.get_serializer(medical_image)
                return Response(serializer.data, status=status.HTTP_200_OK)
                
            except requests.exceptions.ConnectionError as e:
                # 로컬/프로덕션 환경에 따른 해결 방법 안내
                if settings.DEBUG:
                    solution = '로컬 개발 환경: 다음 명령어로 mosec 서비스를 실행하세요:\ncd backend/breast_ai_service && python3 app.py'
                else:
                    solution = '프로덕션 환경: GCP 서버에서 mosec 서비스 상태를 확인하세요:\nsudo systemctl status breast-ai-service\nsudo systemctl restart breast-ai-service'
                
                return Response(
                    {
                        'error': '딥러닝 서비스에 연결할 수 없습니다.',
                        'detail': f'mosec 서비스가 실행되지 않았습니다. (URL: {DL_SERVICE_URL})',
                        'solution': solution
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            except requests.exceptions.Timeout as e:
                logger.error(f"딥러닝 서비스 타임아웃: {str(e)}, URL: {DL_SERVICE_URL}")
                return Response(
                    {
                        'error': '딥러닝 서비스 응답 시간 초과',
                        'detail': f'모델 추론에 시간이 너무 오래 걸립니다. (타임아웃: 120초)',
                        'solution': '이미지 크기를 줄이거나, 서버 리소스를 확인하세요. 딥러닝 서비스가 정상적으로 실행 중인지 확인: sudo systemctl status breast-ai-service'
                    },
                    status=status.HTTP_408_REQUEST_TIMEOUT  # 408으로 명확하게 반환
                )
            except requests.exceptions.RequestException as e:
                return Response(
                    {
                        'error': f'딥러닝 서비스 연결 실패: {str(e)}',
                        'detail': 'mosec 서비스가 실행 중인지 확인하세요.'
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            except Exception as e:
                return Response(
                    {'error': f'분석 중 오류 발생: {str(e)}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                
        except MedicalImage.DoesNotExist:
            return Response(
                {'error': '의료 이미지를 찾을 수 없습니다.'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            # 모든 예외를 로깅하고 상세한 에러 메시지 반환
            logger.error(f"AI 분석 중 예기치 않은 오류 발생: {str(e)}", exc_info=True)
            return Response(
                {'error': f'예상치 못한 오류: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['post'])
    def tumor_analysis(self, request, pk=None):
        """
        종양분석 엔드포인트 (2차: 분류 모델)
        POST /api/medical-images/{id}/tumor_analysis/
        세그멘테이션 결과를 기반으로 종양이 악성인지 양성인지 분류
        """
        try:
            medical_image = self.get_object()
            
            if not medical_image.image_file:
                return Response(
                    {'error': '이미지 파일이 없습니다.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # 세그멘테이션 분석 결과가 있는지 확인
            segmentation_results = medical_image.analysis_results.filter(
                analysis_type='BREAST_MRI_SEGMENTATION'
            )
            
            if not segmentation_results.exists():
                return Response(
                    {
                        'error': '세그멘테이션 분석이 필요합니다.',
                        'detail': '먼저 이미지 분석을 완료해주세요.'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # 이미지 파일 읽기
            image_url = None
            image_base64 = None
            
            # 방법 1: image_file.path 사용
            try:
                image_path = medical_image.image_file.path
                if os.path.exists(image_path):
                    with open(image_path, 'rb') as f:
                        image_bytes = f.read()
                        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
                        logger.info(f"이미지 파일 로드 성공 (path): {image_path}")
            except (AttributeError, ValueError, OSError) as e:
                logger.warning(f"image_file.path 접근 실패: {e}")
                # 방법 2: MEDIA_ROOT에서 직접 찾기
                try:
                    if medical_image.image_file.name:
                        file_name = medical_image.image_file.name
                        if file_name.startswith('medical_images/'):
                            file_name = file_name.replace('medical_images/', '', 1)
                        
                        decoded_file_name = unquote(file_name)
                        possible_paths = [
                            os.path.join(settings.MEDIA_ROOT, medical_image.image_file.name),
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', file_name),
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', decoded_file_name),
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', os.path.basename(file_name)),
                            os.path.join(settings.MEDIA_ROOT, 'medical_images', os.path.basename(decoded_file_name)),
                        ]
                        
                        # patient_id를 포함한 경로도 시도
                        if medical_image.patient_id:
                            if '/' in file_name:
                                date_and_file = file_name
                                possible_paths.insert(1, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), date_and_file))
                            possible_paths.insert(1, os.path.join(settings.MEDIA_ROOT, 'medical_images', str(medical_image.patient_id), os.path.basename(file_name)))
                        
                        for media_path in possible_paths:
                            try:
                                if os.path.exists(media_path) and os.path.isfile(media_path):
                                    with open(media_path, 'rb') as f:
                                        image_bytes = f.read()
                                        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
                                        logger.info(f"이미지 파일 로드 성공 (MEDIA_ROOT): {media_path}")
                                        break
                            except Exception as path_error:
                                continue
                                
                except Exception as e2:
                    logger.error(f"MEDIA_ROOT에서 이미지 찾기 실패: {e2}", exc_info=True)
            
            # base64로 로드 실패한 경우에만 URL 사용
            if not image_base64:
                logger.warning(f"파일 시스템에서 이미지를 찾지 못함. URL 사용 시도: {medical_image.image_file.name}")
                try:
                    image_url = f"{settings.PRODUCTION_DOMAIN}{medical_image.image_file.url}"
                    logger.info(f"이미지 URL 생성: {image_url}")
                except Exception as e:
                    logger.error(f"이미지 URL 생성 실패: {e}")
            
            if not image_base64 and not image_url:
                return Response(
                    {
                        'error': '이미지 파일을 읽을 수 없습니다.',
                        'detail': f'파일명: {getattr(medical_image.image_file, "name", "N/A")}, MEDIA_ROOT: {settings.MEDIA_ROOT}'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # 딥러닝 서비스 호출 (classification 타입)
            try:
                if image_url:
                    payload = {
                        'image_url': image_url,
                        'patient_id': medical_image.patient_id,
                        'analysis_type': 'classification',  # 분류 모델 사용
                        'metadata': {
                            'image_type': medical_image.image_type,
                            'image_id': str(medical_image.id),
                            'segmentation_result_id': str(segmentation_results.first().id) if segmentation_results.exists() else None
                        }
                    }
                else:
                    payload = {
                        'image_data': image_base64,
                        'patient_id': medical_image.patient_id,
                        'analysis_type': 'classification',  # 분류 모델 사용
                        'metadata': {
                            'image_type': medical_image.image_type,
                            'image_id': str(medical_image.id),
                            'segmentation_result_id': str(segmentation_results.first().id) if segmentation_results.exists() else None
                        }
                    }
                
                # 딥러닝 서비스 헬스 체크
                try:
                    health_response = requests.get(f'{DL_SERVICE_URL}/health', timeout=5)
                    if health_response.status_code != 200:
                        logger.warning(f"딥러닝 서비스 헬스 체크 실패: {health_response.status_code}")
                except Exception as health_error:
                    logger.warning(f"딥러닝 서비스 헬스 체크 실패: {health_error}")
                    return Response(
                        {
                            'error': '딥러닝 서비스에 연결할 수 없습니다.',
                            'detail': f'mosec 서비스가 실행되지 않았거나 응답하지 않습니다. (URL: {DL_SERVICE_URL})',
                            'solution': 'GCP 서버에서 다음 명령어로 서비스 상태를 확인하세요:\nsudo systemctl status breast-ai-service\nsudo systemctl restart breast-ai-service'
                        },
                        status=status.HTTP_503_SERVICE_UNAVAILABLE
                    )
                
                response = requests.post(
                    f'{DL_SERVICE_URL}/inference',
                    json=payload,
                    timeout=120
                )
                
                if response.status_code != 200:
                    error_detail = response.text[:500] if response.text else '응답 없음'
                    logger.error(f"딥러닝 서비스 오류: {response.status_code}, 상세: {error_detail}")
                    return Response(
                        {
                            'error': f'딥러닝 서비스 오류: {response.status_code}',
                            'detail': error_detail
                        },
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )
                
                result = response.json()
                
                if not result.get('success'):
                    return Response(
                        {'error': result.get('error', '종양분석 실패')},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )
                
                analysis_data = result.get('data', {})
                
                # heatmap 이미지를 Orthanc에 저장
                logger.info(f"=== 종양 분석 결과 확인 ===")
                logger.info(f"heatmap_image 존재 여부: {bool(analysis_data.get('heatmap_image'))}")
                logger.info(f"analysis_data keys: {list(analysis_data.keys())}")
                logger.info(f"analysis_data 전체: {str(analysis_data)[:500]}")
                
                if not analysis_data.get('heatmap_image'):
                    logger.error(f"⚠️ heatmap_image가 analysis_data에 없습니다! AI 서비스가 heatmap_image를 반환하지 않았을 수 있습니다.")
                    logger.error(f"analysis_data 내용: {analysis_data}")
                else:
                    logger.info(f"✅ heatmap_image 발견! Orthanc 저장 시작")
                
                if analysis_data.get('heatmap_image'):
                    try:
                        logger.info(f"히트맵 이미지 Orthanc 저장 시작. patient_id: {medical_image.patient_id}")
                        # heatmap 이미지 데이터 가져오기 (base64)
                        heatmap_data = analysis_data.get('heatmap_image')
                        logger.info(f"heatmap_data type: {type(heatmap_data)}, length: {len(heatmap_data) if isinstance(heatmap_data, str) else 'N/A'}")
                        
                        # base64 디코딩
                        if isinstance(heatmap_data, str):
                            if heatmap_data.startswith('data:image'):
                                heatmap_data = heatmap_data.split(',')[1]
                            heatmap_bytes = base64.b64decode(heatmap_data)
                            logger.info(f"Base64 디코딩 완료. bytes length: {len(heatmap_bytes)}")
                        else:
                            heatmap_bytes = heatmap_data
                        
                        # PIL Image로 변환
                        heatmap_image = Image.open(BytesIO(heatmap_bytes))
                        logger.info(f"PIL Image 변환 완료. size: {heatmap_image.size}, mode: {heatmap_image.mode}")
                        
                        # Orthanc 클라이언트 생성 (기존 Study 찾기용)
                        logger.info("Orthanc 클라이언트 생성")
                        orthanc_client = OrthancClient()
                        logger.info(f"Orthanc URL: {orthanc_client.base_url}")
                        
                        # 기존 StudyInstanceUID 찾기 (같은 환자의 기존 Study에 속하도록)
                        existing_study_uid = None
                        try:
                            existing_study_uid = orthanc_client.get_existing_study_instance_uid(str(medical_image.patient_id))
                            if existing_study_uid:
                                logger.info(f"기존 StudyInstanceUID 찾음: {existing_study_uid[:20]}... (patient_id: {medical_image.patient_id})")
                            else:
                                logger.info(f"기존 Study 없음, 새로 생성 (patient_id: {medical_image.patient_id})")
                        except Exception as study_error:
                            logger.warning(f"기존 StudyInstanceUID 찾기 실패: {str(study_error)}")
                        
                        # 원본 이미지도 Orthanc에 저장
                        original_image_path = medical_image.image_file.path if hasattr(medical_image.image_file, 'path') else None
                        logger.info(f"원본 이미지 경로: {original_image_path}, 존재 여부: {os.path.exists(original_image_path) if original_image_path else False}")
                        
                        if original_image_path and os.path.exists(original_image_path):
                            try:
                                logger.info("원본 이미지 Orthanc 저장 시작")
                                original_image = Image.open(original_image_path)
                                original_dicom = pil_image_to_dicom(
                                    original_image,
                                    patient_id=str(medical_image.patient_id),
                                    patient_name=str(medical_image.patient_id),
                                    series_description="Original Mammography",
                                    modality="MG",
                                    orthanc_client=orthanc_client,
                                    study_instance_uid=existing_study_uid
                                )
                                logger.info(f"원본 DICOM 변환 완료. size: {len(original_dicom)} bytes")
                                original_result = orthanc_client.upload_dicom(original_dicom)
                                logger.info(f"원본 맘모그래피 이미지 Orthanc 저장 완료: {original_result}")
                            except Exception as orig_error:
                                logger.error(f"원본 이미지 Orthanc 저장 실패: {str(orig_error)}", exc_info=True)
                        else:
                            logger.warning(f"원본 이미지 경로가 없거나 파일이 존재하지 않습니다: {original_image_path}")
                        
                        # heatmap 이미지를 DICOM으로 변환 (같은 Study에 속하도록)
                        logger.info("히트맵 DICOM 변환 시작")
                        heatmap_dicom = pil_image_to_dicom(
                            heatmap_image,
                            patient_id=str(medical_image.patient_id),
                            patient_name=str(medical_image.patient_id),
                            series_description="Heatmap Image",
                            modality="MG",
                            orthanc_client=orthanc_client,
                            study_instance_uid=existing_study_uid
                        )
                        logger.info(f"히트맵 DICOM 변환 완료. size: {len(heatmap_dicom)} bytes")
                        
                        # Orthanc에 업로드
                        logger.info("히트맵 Orthanc 업로드 시작")
                        heatmap_result = orthanc_client.upload_dicom(heatmap_dicom)
                        logger.info(f"히트맵 이미지 Orthanc 저장 완료: {heatmap_result}")
                        
                        # results에 Orthanc 인스턴스 ID 저장
                        if not analysis_data.get('results'):
                            analysis_data['results'] = {}
                        if isinstance(heatmap_result, dict) and 'ID' in heatmap_result:
                            analysis_data['results']['heatmap_orthanc_instance_id'] = heatmap_result['ID']
                            analysis_data['results']['heatmap_orthanc_url'] = f"{orthanc_client.base_url}/instances/{heatmap_result['ID']}/preview"
                        
                    except Exception as heatmap_error:
                        logger.error(f"히트맵 이미지 Orthanc 저장 실패: {str(heatmap_error)}", exc_info=True)
                        # 히트맵 저장 실패해도 분석 결과는 저장
                
                # 종양분석 결과 저장
                tumor_analysis_result = AIAnalysisResult.objects.create(
                    image=medical_image,
                    analysis_type='BREAST_MRI_CLASSIFICATION',
                    results=analysis_data.get('probabilities', {}),
                    confidence=analysis_data.get('confidence'),
                    findings=analysis_data.get('findings', ''),
                    recommendations=analysis_data.get('recommendations', ''),
                    model_version=analysis_data.get('model_version', '1.0.0')
                )
                
                # 시리얼라이저로 응답 반환
                serializer = self.get_serializer(medical_image)
                return Response(serializer.data, status=status.HTTP_200_OK)
                
            except requests.exceptions.ConnectionError as e:
                return Response(
                    {
                        'error': '딥러닝 서비스에 연결할 수 없습니다.',
                        'detail': f'mosec 서비스가 실행되지 않았습니다. (URL: {DL_SERVICE_URL})',
                        'solution': 'GCP 서버에서 다음 명령어로 서비스 상태를 확인하세요:\nsudo systemctl status breast-ai-service\nsudo systemctl restart breast-ai-service'
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            except requests.exceptions.Timeout as e:
                logger.error(f"딥러닝 서비스 타임아웃: {str(e)}, URL: {DL_SERVICE_URL}")
                return Response(
                    {
                        'error': '딥러닝 서비스 응답 시간 초과',
                        'detail': f'모델 추론에 시간이 너무 오래 걸립니다. (타임아웃: 120초)',
                        'solution': '이미지 크기를 줄이거나, 서버 리소스를 확인하세요.'
                    },
                    status=status.HTTP_408_REQUEST_TIMEOUT
                )
            except requests.exceptions.RequestException as e:
                return Response(
                    {
                        'error': f'딥러닝 서비스 연결 실패: {str(e)}',
                        'detail': 'mosec 서비스가 실행 중인지 확인하세요.'
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            except Exception as e:
                return Response(
                    {'error': f'종양분석 중 오류 발생: {str(e)}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                
        except MedicalImage.DoesNotExist:
            return Response(
                {'error': '의료 이미지를 찾을 수 없습니다.'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f"종양분석 중 예기치 않은 오류 발생: {str(e)}", exc_info=True)
            return Response(
                {'error': f'예상치 못한 오류: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
