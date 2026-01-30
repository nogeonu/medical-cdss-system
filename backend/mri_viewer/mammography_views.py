"""
맘모그래피 AI 분석 API
Mosec 서비스 (포트 5007)를 호출하여 4-class 분류 수행
"""

import logging
import base64
import requests
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from .orthanc_client import OrthancClient
from .utils import pil_image_to_dicom
from PIL import Image
from io import BytesIO

logger = logging.getLogger(__name__)

# CSRF 체크를 건너뛰는 커스텀 인증 클래스
class CSRFExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return  # CSRF 체크를 건너뜀

# Mosec 맘모그래피 서비스 URL
MAMMOGRAPHY_API_URL = "http://localhost:5007"


@api_view(['POST'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def mammography_ai_analysis(request):
    """
    맘모그래피 4장 이미지 AI 분석
    
    POST /api/mri/mammography/analyze/
    Body: {
        "instance_ids": ["id1", "id2", "id3", "id4"]
    }
    
    Returns: {
        "success": true,
        "results": [
            {
                "instance_id": "...",
                "view": "L-CC",
                "predicted_class": 0,
                "probability": 0.95,
                "all_probabilities": [0.95, 0.03, 0.01, 0.01]
            },
            ...
        ]
    }
    """
    try:
        instance_ids = request.data.get('instance_ids')
        
        if not instance_ids or not isinstance(instance_ids, list):
            return Response({
                'success': False,
                'error': 'instance_ids 배열이 필요합니다.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if len(instance_ids) != 4:
            return Response({
                'success': False,
                'error': '맘모그래피는 4장의 이미지가 필요합니다 (L-CC, L-MLO, R-CC, R-MLO).'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        logger.info(f"📊 맘모그래피 4장 분석 시작: {instance_ids}")
        
        # 1. Orthanc 클라이언트 설정 (Mosec에서 사용할 정보)
        import os
        client = OrthancClient()
        
        # 2. Mosec에 instance_ids만 전송 (MRI 세그멘테이션 방식)
        # Mosec 내부에서 Orthanc API로 직접 DICOM 파일 다운로드
        logger.info(f"🚀 Mosec 서비스 호출 중... (4장, Orthanc API 사용)")
        
        import json
        payload = json.dumps({
            "instance_ids": instance_ids,
            "orthanc_url": os.getenv('ORTHANC_URL', 'http://localhost:8042'),
            "orthanc_auth": [os.getenv('ORTHANC_USER', 'admin'), os.getenv('ORTHANC_PASSWORD', 'admin123')]
        })
        
        response = requests.post(
            f"{MAMMOGRAPHY_API_URL}/inference",
            data=payload,
            headers={'Content-Type': 'application/json'},
            timeout=300  # 5분 (4장 처리)
        )
        
        if response.status_code != 200:
            raise Exception(f"Mosec 서비스 오류: {response.status_code} - {response.text}")
        
        # Mosec 응답 확인 (MRI 세그멘테이션과 동일하게 단일 딕셔너리)
        try:
            mosec_result = response.json()
            logger.info(f"📥 Mosec 응답 타입: {type(mosec_result)}")
            logger.info(f"📥 Mosec 응답 내용: {mosec_result}")
            
            if not isinstance(mosec_result, dict):
                logger.error(f"❌ Mosec 응답 형식 오류: 예상 dict, 실제 {type(mosec_result)}")
                logger.error(f"❌ 실제 응답: {mosec_result}")
                raise Exception(f"Mosec 응답 형식 오류: 예상 dict, 실제 {type(mosec_result)}")
            
            # results 배열 추출
            mosec_results = mosec_result.get("results", [])
            logger.info(f"📥 results 타입: {type(mosec_results)}, 길이: {len(mosec_results) if isinstance(mosec_results, list) else 'N/A'}")
            
            if not isinstance(mosec_results, list):
                logger.error(f"❌ results가 리스트가 아님: {type(mosec_results)}")
                logger.error(f"❌ results 내용: {mosec_results}")
                raise Exception(f"Mosec 응답 형식 오류: results가 리스트가 아님")
            
            if len(mosec_results) != len(instance_ids):
                logger.error(f"❌ 결과 개수 불일치: 기대 {len(instance_ids)}, 실제 {len(mosec_results)}")
                raise Exception(f"결과 개수 불일치: 기대 {len(instance_ids)}, 실제 {len(mosec_results)}")
                
        except Exception as e:
            logger.error(f"❌ Mosec 응답 처리 실패: {str(e)}, 응답 텍스트: {response.text[:500]}")
            raise Exception(f"Mosec 응답 처리 실패: {str(e)}")
        
        # 3. 결과 매핑 (뷰 정보는 DICOM 태그에서 추출)
        # 첫 번째 인스턴스에서 PatientID와 PatientName 가져오기 (DICOM 파일에서 직접 읽기)
        common_patient_id = None
        common_patient_name = None
        if instance_ids and len(instance_ids) > 0:
            try:
                # 방법 1: DICOM 파일 직접 읽기 (가장 확실한 방법)
                try:
                    import pydicom
                    from io import BytesIO
                    logger.info(f"📋 DICOM 파일에서 PatientID 직접 읽기 시도: {instance_ids[0]}")
                    dicom_file_bytes = client.get_instance_file(instance_ids[0])
                    dicom_dataset = pydicom.dcmread(BytesIO(dicom_file_bytes))
                    common_patient_id = str(dicom_dataset.get('PatientID', ''))
                    common_patient_name = str(dicom_dataset.get('PatientName', ''))
                    logger.info(f"✅ DICOM 파일에서 읽음 - PatientID: '{common_patient_id}', PatientName: '{common_patient_name}'")
                except Exception as dicom_error:
                    logger.warning(f"⚠️ DICOM 파일 직접 읽기 실패: {dicom_error}, 다른 방법 시도")
                
                # 방법 2: Orthanc API에서 메타데이터 가져오기
                if not common_patient_id:
                    first_instance_info = client.get_instance_info(instance_ids[0])
                    first_tags = first_instance_info.get('MainDicomTags', {})
                    common_patient_id = first_tags.get('PatientID', '')
                    common_patient_name = first_tags.get('PatientName', '')
                    logger.info(f"📋 Orthanc API에서 읽음 - PatientID: '{common_patient_id}', PatientName: '{common_patient_name}'")
                    
                    # PatientID가 없으면 Study에서 가져오기
                    if not common_patient_id:
                        study_id = first_instance_info.get('ParentStudy', '')
                        if study_id:
                            study_info = client.get_study_info(study_id)
                            study_tags = study_info.get('MainDicomTags', {})
                            common_patient_id = study_tags.get('PatientID', '')
                            common_patient_name = study_tags.get('PatientName', '')
                    
                    # 여전히 없으면 Orthanc Patient ID에서 가져오기
                    if not common_patient_id:
                        orthanc_patient_id = first_instance_info.get('ParentPatient', '')
                        if orthanc_patient_id:
                            patient_info = client.get_patient_info(orthanc_patient_id)
                            patient_tags = patient_info.get('MainDicomTags', {})
                            common_patient_id = patient_tags.get('PatientID', '')
                            common_patient_name = patient_tags.get('PatientName', '')
                
                if not common_patient_id:
                    logger.error(f"❌ PatientID를 찾을 수 없습니다. instance_id: {instance_ids[0]}")
                    common_patient_id = 'UNKNOWN'
                if not common_patient_name:
                    common_patient_name = common_patient_id
                
                logger.info(f"📋 최종 공통 PatientID: '{common_patient_id}', PatientName: '{common_patient_name}'")
            except Exception as e:
                logger.error(f"❌ 공통 PatientID 가져오기 실패: {e}", exc_info=True)
                common_patient_id = 'UNKNOWN'
                common_patient_name = 'UNKNOWN'
        
        results = []
        
        for idx, (instance_id, mosec_result) in enumerate(zip(instance_ids, mosec_results)):
            if not mosec_result.get('success'):
                raise Exception(f"이미지 {idx+1} 분석 실패: {mosec_result.get('error', 'Unknown error')}")
            
            # Orthanc에서 인스턴스 메타데이터 가져오기
            try:
                instance_info = client.get_instance_info(instance_id)
                main_tags = instance_info.get('MainDicomTags', {})
                
                view_position = main_tags.get('ViewPosition', '')  # CC, MLO 등
                image_laterality = main_tags.get('ImageLaterality', '')  # L, R
                
                # 뷰 이름 생성
                if view_position and image_laterality:
                    view_name = f"{image_laterality}-{view_position}"  # L-CC, R-MLO 등
                else:
                    view_name = f"Image {idx+1}"
                    
                logger.info(f"📋 메타데이터: {instance_id} → {view_name} (ViewPosition={view_position}, ImageLaterality={image_laterality})")
            except Exception as e:
                logger.warning(f"⚠️ 메타데이터 로드 실패: {instance_id}, 기본값 사용")
                view_name = f"Image {idx+1}"
            
            # 클래스 이름 매핑
            class_names = ['Mass', 'Calcification', 'Architectural/Asymmetry', 'Normal']
            predicted_class = mosec_result['class_id']
            
            # 모든 확률값 배열로 변환
            all_probs = [
                mosec_result['probabilities'].get('Mass', 0.0),
                mosec_result['probabilities'].get('Calcification', 0.0),
                mosec_result['probabilities'].get('Architectural/Asymmetry', 0.0),
                mosec_result['probabilities'].get('Normal', 0.0)
            ]
            
            result_item = {
                'instance_id': instance_id,
                'view': view_name,
                'predicted_class': predicted_class,
                'class_name': class_names[predicted_class],
                'probability': mosec_result['confidence'],
                'all_probabilities': all_probs
            }
            
            # Grad-CAM 오버레이가 있으면 추가
            if 'gradcam_overlay' in mosec_result:
                result_item['gradcam_overlay'] = mosec_result['gradcam_overlay']
                
                # 히트맵 이미지를 Orthanc에 저장
                try:
                    logger.info(f"🔥 히트맵 이미지 Orthanc 저장 시작: {instance_id} ({view_name})")
                    
                    # gradcam_overlay는 base64 인코딩된 이미지
                    gradcam_data = mosec_result['gradcam_overlay']
                    
                    # base64 디코딩
                    if isinstance(gradcam_data, str):
                        if gradcam_data.startswith('data:image'):
                            gradcam_data = gradcam_data.split(',')[1]
                        gradcam_bytes = base64.b64decode(gradcam_data)
                    else:
                        gradcam_bytes = gradcam_data
                    
                    # PIL Image로 변환
                    gradcam_image = Image.open(BytesIO(gradcam_bytes))
                    logger.info(f"✅ PIL Image 변환 완료. size: {gradcam_image.size}, mode: {gradcam_image.mode}")
                    
                    # Orthanc에서 환자 ID 가져오기 (공통 PatientID 우선 사용)
                    patient_id = common_patient_id
                    
                    # 공통 PatientID가 없으면 개별 인스턴스에서 가져오기 시도
                    if not patient_id or patient_id == '':
                        try:
                            # 먼저 인스턴스의 PatientID 확인
                            patient_id = main_tags.get('PatientID', '')
                            logger.info(f"📋 인스턴스 {instance_id}에서 가져온 PatientID: '{patient_id}'")
                            
                            if not patient_id or patient_id == '':
                                # Study에서 환자 ID 가져오기
                                study_id = instance_info.get('ParentStudy', '')
                                logger.info(f"📋 Study ID: {study_id}")
                                if study_id:
                                    study_info = client.get_study_info(study_id)
                                    study_tags = study_info.get('MainDicomTags', {})
                                    patient_id = study_tags.get('PatientID', '')
                                    logger.info(f"📋 Study에서 가져온 PatientID: '{patient_id}'")
                            
                            # PatientID가 여전히 없으면 Orthanc 내부 Patient ID 사용
                            if not patient_id or patient_id == '':
                                orthanc_patient_id = instance_info.get('ParentPatient', '')
                                if orthanc_patient_id:
                                    patient_info = client.get_patient_info(orthanc_patient_id)
                                    patient_tags = patient_info.get('MainDicomTags', {})
                                    patient_id = patient_tags.get('PatientID', '')
                                    logger.info(f"📋 Orthanc Patient에서 가져온 PatientID: '{patient_id}'")
                            
                            if not patient_id or patient_id == '':
                                logger.error(f"❌ PatientID를 찾을 수 없습니다. instance_id: {instance_id}")
                                logger.error(f"❌ instance_info 구조: {list(instance_info.keys())}")
                                logger.error(f"❌ main_tags 내용: {main_tags}")
                                patient_id = 'UNKNOWN'
                        except Exception as e:
                            logger.error(f"❌ 환자 ID 가져오기 실패: {e}", exc_info=True)
                            import traceback
                            logger.error(f"상세 에러: {traceback.format_exc()}")
                            patient_id = 'UNKNOWN'
                    
                    logger.info(f"📋 최종 사용할 환자 ID: '{patient_id}' (instance_id: {instance_id})")
                    
                    # 기존 StudyInstanceUID 찾기 (같은 환자의 기존 Study에 속하도록)
                    existing_study_uid = None
                    if patient_id:
                        try:
                            existing_study_uid = client.get_existing_study_instance_uid(patient_id)
                            if existing_study_uid:
                                logger.info(f"✅ 기존 StudyInstanceUID 찾음: {existing_study_uid[:20]}...")
                            else:
                                logger.info(f"ℹ️ 기존 Study 없음, 새로 생성")
                        except Exception as e:
                            logger.warning(f"⚠️ 기존 StudyInstanceUID 찾기 실패: {e}")
                    
                    # 히트맵 이미지를 DICOM으로 변환 (PatientName도 함께 설정)
                    logger.info("🔥 히트맵 DICOM 변환 시작")
                    gradcam_dicom = pil_image_to_dicom(
                        gradcam_image,
                        patient_id=patient_id,
                        patient_name=common_patient_name or patient_id,  # PatientName 사용
                        series_description=f"Heatmap Image - {view_name}",
                        modality="MG",
                        orthanc_client=client,
                        study_instance_uid=existing_study_uid
                    )
                    logger.info(f"✅ 히트맵 DICOM 변환 완료. size: {len(gradcam_dicom)} bytes")
                    
                    # Orthanc에 업로드
                    logger.info("🔥 히트맵 Orthanc 업로드 시작")
                    gradcam_result = client.upload_dicom(gradcam_dicom)
                    logger.info(f"✅ 히트맵 이미지 Orthanc 저장 완료: {gradcam_result}")
                    
                    # 결과에 Orthanc 인스턴스 ID 추가
                    if isinstance(gradcam_result, dict) and 'ID' in gradcam_result:
                        result_item['heatmap_orthanc_instance_id'] = gradcam_result['ID']
                        result_item['heatmap_orthanc_url'] = f"{client.base_url}/instances/{gradcam_result['ID']}/preview"
                        logger.info(f"✅ 히트맵 Orthanc 인스턴스 ID 저장: {gradcam_result['ID']}")
                    
                except Exception as heatmap_error:
                    logger.error(f"❌ 히트맵 이미지 Orthanc 저장 실패: {str(heatmap_error)}", exc_info=True)
                    import traceback
                    logger.error(f"상세 에러: {traceback.format_exc()}")
                    # 히트맵 저장 실패해도 분석 결과는 반환
            
            results.append(result_item)
            
            logger.info(f"✅ {view_name}: {class_names[predicted_class]} (신뢰도: {mosec_result['confidence']:.4f})")
        
        return Response({
            'success': True,
            'results': results
        })
        
    except requests.exceptions.Timeout:
        logger.error("❌ Mosec 서비스 타임아웃")
        return Response({
            'success': False,
            'error': 'AI 분석 서비스 타임아웃'
        }, status=status.HTTP_504_GATEWAY_TIMEOUT)
        
    except Exception as e:
        logger.error(f"❌ 맘모그래피 분석 실패: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def mammography_health(request):
    """
    맘모그래피 AI 서비스 헬스 체크
    
    GET /api/mri/mammography/health/
    """
    try:
        response = requests.get(f"{MAMMOGRAPHY_API_URL}/", timeout=5)
        
        return Response({
            'success': True,
            'service': 'mammography',
            'status': 'healthy',
            'mosec_status_code': response.status_code
        })
        
    except Exception as e:
        logger.error(f"❌ 맘모그래피 서비스 헬스 체크 실패: {str(e)}")
        return Response({
            'success': False,
            'service': 'mammography',
            'status': 'unhealthy',
            'error': str(e)
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

