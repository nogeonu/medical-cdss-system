"""
MRI 세그멘테이션 API Views (MAMA_MIA_DELIVERY_PKG 파이프라인 사용)
- Orthanc 연동: 기존 시스템 로직 유지
- 추론: 새로운 MAMA_MIA 파이프라인 사용
- 연구실 컴퓨터 추론: 로컬 환경에서 추론 실행 가능
"""
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
import requests
import io
import logging
import os
import base64
import numpy as np
import pydicom
import tempfile
import shutil
import json
from pathlib import Path
from .orthanc_client import OrthancClient
import sys

# 새로운 MAMA_MIA 세그멘테이션 모듈 import (지연 로드로 변경)
# Django 시작 시 import 오류 방지를 위해 함수 내부에서 import

logger = logging.getLogger(__name__)

# Orthanc 설정
ORTHANC_URL = os.getenv('ORTHANC_URL', 'http://34.42.223.43:8042')
ORTHANC_USER = os.getenv('ORTHANC_USER', 'admin')
ORTHANC_PASSWORD = os.getenv('ORTHANC_PASSWORD', 'admin123')

# Mosec 서비스 URL 설정 (포트 5006: MRI 세그멘테이션)
SEGMENTATION_MOSEC_URL = os.getenv('SEGMENTATION_MOSEC_URL', 'http://127.0.0.1:5006/inference')

# 모델 경로 (우선순위: src/best_model.pth -> checkpoints/best_model.pth)
MODEL_PATH = Path(__file__).parent.parent / "mri_segmentation" / "src" / "best_model.pth"
if not MODEL_PATH.exists():
    MODEL_PATH = Path(__file__).parent.parent / "mri_segmentation" / "checkpoints" / "best_model.pth"
if not MODEL_PATH.exists():
    logger.warning(f"Model file not found at expected locations. Searched: {MODEL_PATH}")

# 전역 추론 파이프라인 (한 번만 로드)
_pipeline = None

def get_pipeline():
    """추론 파이프라인 싱글톤 (지연 로드)"""
    global _pipeline
    if _pipeline is None:
        # 지연 import로 Django 시작 시 오류 방지
        sys.path.insert(0, str(Path(__file__).parent.parent / "mri_segmentation" / "src"))
        from inference_pipeline import SegmentationInferencePipeline
        
        logger.info(f"Loading segmentation model from: {MODEL_PATH}")
        
        # GPU 사용 가능 여부 확인
        import torch
        device = "cpu"  # 기본값은 CPU
        if os.getenv('USE_GPU', 'false').lower() == 'true':
            if torch.cuda.is_available():
                device = "cuda"
                logger.info("Using CUDA GPU for inference")
            else:
                logger.warning("GPU requested but not available. Using CPU instead.")
        else:
            logger.info("Using CPU for inference (set USE_GPU=true to enable GPU)")
        
        _pipeline = SegmentationInferencePipeline(
            model_path=str(MODEL_PATH),
            device=device,
            threshold=0.5
        )
        logger.info("Model loaded successfully!")
    return _pipeline


# CSRF 체크를 건너뛰는 커스텀 인증 클래스
class CSRFExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return  # CSRF 체크를 건너뜀


@api_view(['POST'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def mri_segmentation(request, instance_id):
    """
    MRI 세그멘테이션 실행 및 Orthanc에 저장 (단일 인스턴스 또는 4채널)
    
    POST /api/mri/segmentation/instances/<instance_id>/segment/
    """
    try:
        # Request body에서 4개 시퀀스 ID 가져오기 (없으면 단일 이미지 모드)
        sequence_ids = request.data.get('sequence_instance_ids', [instance_id])
        
        logger.info(f"🔍 MRI 세그멘테이션 시작: {len(sequence_ids)}개 시퀀스")
        logger.info(f"   Instance IDs: {sequence_ids}")
        
        # 4채널인 경우 perform_segment_series_logic 사용
        if len(sequence_ids) == 4:
            # 각 인스턴스의 시리즈 ID 찾기
            client = OrthancClient()
            sequence_series_ids = []
            for inst_id in sequence_ids:
                inst_info = client.get_instance_info(inst_id)
                parent_series = inst_info.get('ParentSeries')
                if parent_series:
                    sequence_series_ids.append(parent_series)
            
            if len(sequence_series_ids) == 4:
                return _perform_segment_series_logic(request, sequence_series_ids[0], sequence_series_ids)
            else:
                return Response({
                    'success': False,
                    'error': '4개 시퀀스의 시리즈 ID를 찾을 수 없습니다.'
                }, status=400)
        else:
            # 단일 이미지 모드는 아직 지원하지 않음
            return Response({
                'success': False,
                'error': '단일 이미지 모드는 지원하지 않습니다. 4채널 DCE-MRI만 지원합니다.'
            }, status=400)
            
    except Exception as e:
        logger.error(f"❌ 세그멘테이션 실패: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'instance_id': instance_id,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def segmentation_health(request):
    """
    세그멘테이션 API 서버 상태 확인
    
    GET /api/mri/segmentation/health/
    """
    try:
        # 모델 파일 존재 여부 확인
        model_file_exists = MODEL_PATH.exists()
        
        # 모델 로드 가능 여부 확인
        model_loaded = False
        error_msg = None
        try:
            pipeline = get_pipeline()
            model_loaded = pipeline is not None
        except Exception as e:
            logger.warning(f"모델 로드 실패: {e}")
            error_msg = str(e)
            model_loaded = False
        
        return Response({
            'success': True,
            'status': 'healthy' if model_loaded else 'model_not_loaded',
            'service': 'New Segmentation Pipeline',
            'model_loaded': model_loaded,
            'model_file_exists': model_file_exists,
            'model_path': str(MODEL_PATH),
            'orthanc_url': ORTHANC_URL,
            'error': error_msg if error_msg else None
        })
    except Exception as e:
        return Response({
            'success': False,
            'status': 'unavailable',
            'error': str(e)
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(['POST'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def segment_series(request, series_id):
    """
    시리즈 전체를 3D 세그멘테이션하고 Orthanc에 저장
    
    POST /api/mri/segmentation/series/<series_id>/segment/
    """
    sequence_series_ids = request.data.get("sequence_series_ids", [])
    if len(sequence_series_ids) != 4:
        return Response({
            "success": False,
            "error": "4개 시리즈가 모두 필요합니다."
        }, status=400)
    
    return _perform_segment_series_logic(request, series_id, sequence_series_ids)


def _perform_segment_series_logic(request, series_id, sequence_series_ids):
    """
    시리즈 세그멘테이션의 핵심 로직 (Mosec 서비스 사용)
    Django는 Mosec에 series_ids만 전달하고, Mosec이 Orthanc에서 직접 다운로드하여 추론 후 저장
    """
    try:
        logger.info(f"🔍 시리즈 3D 세그멘테이션 시작: series_id={series_id}")
        logger.info("☁️ Mosec 서비스를 통한 추론 실행")
        
        client = OrthancClient()
        
        # 1. Orthanc에서 4개 시퀀스의 Instance ID 수집
        orthanc_instance_ids = []
        for seq_idx, seq_series_id in enumerate(sequence_series_ids):
            seq_info = client.get(f"/series/{seq_series_id}")
            seq_instances = seq_info.get("Instances", [])
            
            if len(seq_instances) == 0:
                return Response({
                    "success": False,
                    "error": f"시퀀스 {seq_idx+1}에 슬라이스가 없습니다."
                }, status=400)
            
            orthanc_instance_ids.append(seq_instances)
            logger.info(f"✅ 시퀀스 {seq_idx+1}/4: {len(seq_instances)}개 슬라이스 ID 수집 완료")
        
        # 2. 세그멘테이션 시리즈 UID 생성
        from pydicom.uid import generate_uid
        seg_series_uid = generate_uid()
        
        # 3. Mosec에 요청 전송 (instance_ids만 전송)
        logger.info(f"🚀 Mosec 서비스 호출 중... (4개 시퀀스, Orthanc API 사용)")
        
        payload = {
            "orthanc_instance_ids": orthanc_instance_ids,
            "orthanc_url": ORTHANC_URL,
            "orthanc_auth": [ORTHANC_USER, ORTHANC_PASSWORD],
            "seg_series_uid": seg_series_uid,
            "original_series_id": series_id,
            "start_instance_number": 1
        }
        
        response = requests.post(
            SEGMENTATION_MOSEC_URL,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=2400  # 40분 타임아웃 (대용량 처리 고려)
        )
        
        if response.status_code != 200:
            logger.error(f"❌ Mosec 서비스 오류: {response.status_code} - {response.text}")
            return Response({
                'success': False,
                'error': f'Mosec 서비스 오류: {response.status_code} - {response.text[:500]}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        # 4. Mosec 응답 처리
        try:
            mosec_result = response.json()
            logger.info(f"📥 Mosec 응답 수신: {type(mosec_result)}")
            
            if not isinstance(mosec_result, dict):
                logger.error(f"❌ Mosec 응답 형식 오류: 예상 dict, 실제 {type(mosec_result)}")
                return Response({
                    'success': False,
                    'error': f'Mosec 응답 형식 오류: 예상 dict, 실제 {type(mosec_result)}'
                }, status=500)
            
            # Mosec이 Orthanc에 저장한 seg_instance_id 확인
            seg_instance_id = mosec_result.get('seg_instance_id')
            tumor_ratio_percent = mosec_result.get('tumor_ratio_percent', 0.0)
            tumor_pixel_count = mosec_result.get('tumor_pixel_count', 0)

            # 슬라이스 정보 (Mosec 응답에서 가져오거나, orthanc_instance_ids에서 계산)
            total_slices = mosec_result.get('total_slices', 0)
            successful_slices = mosec_result.get('successful_slices', 0)

            # total_slices가 없으면 orthanc_instance_ids에서 계산
            if total_slices == 0 and orthanc_instance_ids:
                total_slices = len(orthanc_instance_ids[0]) if orthanc_instance_ids else 0
                successful_slices = total_slices  # Mosec 성공 시 모든 슬라이스 처리 완료로 가정

            # tumor_detected는 tumor_ratio_percent가 0보다 크면 True
            tumor_detected = tumor_ratio_percent > 0.0
            # tumor_volume_voxels는 tumor_pixel_count를 사용 (또는 계산)
            tumor_volume_voxels = tumor_pixel_count

            if not seg_instance_id:
                logger.warning("⚠️ Mosec 응답에 seg_instance_id가 없습니다. Mosec이 Orthanc에 저장했는지 확인하세요.")

            logger.info(f"✅ 세그멘테이션 완료: tumor_detected={tumor_detected}, tumor_ratio={tumor_ratio_percent:.2f}%, seg_instance_id={seg_instance_id}, slices={successful_slices}/{total_slices}")

            return Response({
                'success': True,
                'series_id': series_id,
                'tumor_detected': tumor_detected,
                'tumor_volume_voxels': tumor_volume_voxels,
                'tumor_ratio_percent': tumor_ratio_percent,
                'seg_instance_id': seg_instance_id,
                'saved_to_orthanc': seg_instance_id is not None,
                'processed_by': 'mosec',
                'total_slices': total_slices,
                'successful_slices': successful_slices
            })
            
        except Exception as e:
            logger.error(f"❌ Mosec 응답 처리 실패: {str(e)}", exc_info=True)
            return Response({
                'success': False,
                'error': f'Mosec 응답 처리 실패: {str(e)}'
            }, status=500)
    
    except requests.exceptions.Timeout:
        logger.error(f"❌ Mosec 서비스 타임아웃")
        return Response({
            'success': False,
            'error': 'AI 분석 타임아웃 (40분 초과)'
        }, status=status.HTTP_504_GATEWAY_TIMEOUT)
    except requests.exceptions.ConnectionError:
        logger.error(f"❌ Mosec 서비스 연결 실패")
        return Response({
            'success': False,
            'error': 'Mosec 서비스에 연결할 수 없습니다. 서비스가 실행 중인지 확인하세요.'
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception as e:
        logger.error(f"❌ 세그멘테이션 로직 실패: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'series_id': series_id,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_segmentation_frames(request, seg_instance_id):
    """
    DICOM SEG 파일에서 모든 프레임을 추출하여 반환
    """
    try:
        logger.info(f"🔍 DICOM SEG 프레임 추출 시작: {seg_instance_id}")
        client = OrthancClient()
        seg_dicom_bytes = client.get_instance_file(seg_instance_id)
        
        dicom_data = io.BytesIO(seg_dicom_bytes)
        ds = pydicom.dcmread(dicom_data, force=True)
        
        num_frames = getattr(ds, 'NumberOfFrames', 1)
        rows = ds.Rows
        cols = ds.Columns
        
        try:
            pixel_array = ds.pixel_array
            if pixel_array.ndim == 2:
                pixel_array = pixel_array[np.newaxis, ...]
        except:
            pixel_data = np.frombuffer(ds.PixelData, dtype=np.uint8)
            if ds.BitsAllocated == 1:
                pixel_array = np.unpackbits(pixel_data).reshape(num_frames, rows, cols)
            else:
                pixel_array = pixel_data.reshape(num_frames, rows, cols)
        
        frames = []
        for i in range(num_frames):
            frame_data = (pixel_array[i] > 0).astype(np.uint8) * 255
            from PIL import Image
            img = Image.fromarray(frame_data, mode='L')
            buffer = io.BytesIO()
            img.save(buffer, format='PNG')
            mask_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            
            frames.append({
                "index": i,
                "mask_base64": mask_base64
            })
        
        return Response({
            "success": True,
            "num_frames": len(frames),
            "frames": frames
        })
        
    except Exception as e:
        logger.error(f"❌ 프레임 추출 실패: {str(e)}", exc_info=True)
        return Response({
            "success": False,
            "error": str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_segmentation_volume_instances(request, seg_instance_id):
    """
    DICOM SEG 파일의 각 프레임을 개별 DICOM 인스턴스로 변환하여 Orthanc에 업로드하고 인스턴스 ID 목록 반환
    3D 볼륨 렌더링을 위해 사용
    """
    try:
        logger.info(f"🔍 DICOM SEG → 개별 인스턴스 변환 시작: {seg_instance_id}")
        # OrthancClient는 환경 변수에서 ORTHANC_URL을 읽지만, 명시적으로 전달하여 일관성 유지
        client = OrthancClient(
            base_url=ORTHANC_URL,
            username=ORTHANC_USER,
            password=ORTHANC_PASSWORD
        )
        
        # 1. DICOM SEG 파일 로드
        seg_dicom_bytes = client.get_instance_file(seg_instance_id)
        dicom_data = io.BytesIO(seg_dicom_bytes)
        ds = pydicom.dcmread(dicom_data, force=True)
        
        # 2. 원본 DICOM 정보 가져오기 (참조용)
        study_instance_uid = getattr(ds, 'StudyInstanceUID', None)
        if not study_instance_uid:
            return Response({
                'success': False,
                'error': 'StudyInstanceUID not found in SEG file'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # 원본 시리즈의 첫 번째 인스턴스 가져오기 (메타데이터 참조용)
        reference_dicom = None
        try:
            # StudyInstanceUID로 Study 찾기
            studies_response = requests.get(f"{client.base_url}/studies", auth=client.auth)
            studies_response.raise_for_status()
            all_studies = studies_response.json()
            
            study_id = None
            for study in all_studies:
                study_id_str = study if isinstance(study, str) else study.get('ID', study)
                study_info_response = requests.get(
                    f"{client.base_url}/studies/{study_id_str}",
                    auth=client.auth
                )
                if study_info_response.status_code == 200:
                    study_info = study_info_response.json()
                    tags = study_info.get('MainDicomTags', {})
                    if tags.get('StudyInstanceUID') == study_instance_uid:
                        study_id = study_id_str
                        break
            
            if study_id:
                # Study의 Series 목록 가져오기
                series_response = requests.get(
                    f"{client.base_url}/studies/{study_id}/series",
                    auth=client.auth
                )
                if series_response.status_code == 200:
                    series_list = series_response.json()
                    
                    # SEG가 아닌 원본 시리즈 찾기
                    for series_id in series_list:
                        series_info_response = requests.get(
                            f"{client.base_url}/series/{series_id}",
                            auth=client.auth
                        )
                        if series_info_response.status_code == 200:
                            series_info = series_info_response.json()
                            modality = series_info.get('MainDicomTags', {}).get('Modality', '')
                            if modality != 'SEG':
                                instances = series_info.get('Instances', [])
                                if instances:
                                    reference_instance_id = instances[0]
                                    ref_bytes = client.get_instance_file(reference_instance_id)
                                    reference_dicom = pydicom.dcmread(io.BytesIO(ref_bytes), force=True)
                                    break
        except Exception as e:
            logger.warning(f"원본 DICOM 참조 실패, 기본값 사용: {e}")
        
        # 3. 프레임 데이터 추출
        num_frames = getattr(ds, 'NumberOfFrames', 1)
        rows = ds.Rows
        cols = ds.Columns
        
        try:
            pixel_array = ds.pixel_array
            if pixel_array.ndim == 2:
                pixel_array = pixel_array[np.newaxis, ...]
        except:
            pixel_data = np.frombuffer(ds.PixelData, dtype=np.uint8)
            if ds.BitsAllocated == 1:
                pixel_array = np.unpackbits(pixel_data).reshape(num_frames, rows, cols)
            else:
                pixel_array = pixel_data.reshape(num_frames, rows, cols)
        
        # 4. 각 프레임을 개별 DICOM 인스턴스로 변환
        instance_ids = []
        from pydicom.dataset import FileDataset, FileMetaDataset
        from pydicom.uid import generate_uid, ExplicitVRLittleEndian
        
        for frame_idx in range(num_frames):
            frame_data = (pixel_array[frame_idx] > 0).astype(np.uint8) * 255
            
            # 새 DICOM 인스턴스 생성
            file_meta = FileMetaDataset()
            file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
            file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'  # CT Image Storage
            file_meta.MediaStorageSOPInstanceUID = generate_uid()
            file_meta.ImplementationClassUID = generate_uid()
            
            new_ds = FileDataset(None, {}, file_meta=file_meta, preamble=b"\0" * 128)
            
            # 원본 DICOM에서 메타데이터 복사 (있는 경우)
            if reference_dicom:
                new_ds.PatientName = getattr(reference_dicom, 'PatientName', 'Anonymous')
                new_ds.PatientID = getattr(reference_dicom, 'PatientID', 'Unknown')
                new_ds.PatientBirthDate = getattr(reference_dicom, 'PatientBirthDate', '')
                new_ds.PatientSex = getattr(reference_dicom, 'PatientSex', '')
                new_ds.StudyInstanceUID = getattr(reference_dicom, 'StudyInstanceUID', study_instance_uid)
                new_ds.StudyDate = getattr(reference_dicom, 'StudyDate', '')
                new_ds.StudyTime = getattr(reference_dicom, 'StudyTime', '')
                new_ds.StudyID = getattr(reference_dicom, 'StudyID', '')
                new_ds.AccessionNumber = getattr(reference_dicom, 'AccessionNumber', '')
                
                # ImagePositionPatient, ImageOrientationPatient 등 복사 (있는 경우)
                if hasattr(reference_dicom, 'ImagePositionPatient') and hasattr(reference_dicom, 'ImageOrientationPatient'):
                    # Z 위치를 프레임 인덱스에 따라 조정
                    pos = np.array(reference_dicom.ImagePositionPatient)
                    slice_thickness = float(getattr(reference_dicom, 'SliceThickness', 1.0))
                    iop = np.array(reference_dicom.ImageOrientationPatient)
                    # 슬라이스 노말 계산
                    row_cos = iop[:3]
                    col_cos = iop[3:6]
                    slice_normal = np.cross(row_cos, col_cos)
                    # 프레임 인덱스에 따라 위치 조정
                    new_pos = pos + slice_normal * slice_thickness * frame_idx
                    new_ds.ImagePositionPatient = new_pos.tolist()
                    new_ds.ImageOrientationPatient = iop.tolist()
                
                if hasattr(reference_dicom, 'PixelSpacing'):
                    new_ds.PixelSpacing = reference_dicom.PixelSpacing
                if hasattr(reference_dicom, 'SliceThickness'):
                    new_ds.SliceThickness = reference_dicom.SliceThickness
                if hasattr(reference_dicom, 'SpacingBetweenSlices'):
                    new_ds.SpacingBetweenSlices = reference_dicom.SpacingBetweenSlices
            else:
                # 기본값
                new_ds.PatientName = getattr(ds, 'PatientName', 'Anonymous')
                new_ds.PatientID = getattr(ds, 'PatientID', 'Unknown')
                new_ds.StudyInstanceUID = study_instance_uid
                new_ds.StudyDate = getattr(ds, 'StudyDate', '')
                new_ds.StudyTime = getattr(ds, 'StudyTime', '')
            
            # 시리즈 정보 (세그멘테이션 전용 시리즈)
            seg_series_uid = getattr(ds, 'SeriesInstanceUID', generate_uid())
            new_ds.SeriesInstanceUID = f"{seg_series_uid}_volume"  # 볼륨 렌더링용 시리즈
            new_ds.SeriesNumber = '9998'
            new_ds.SeriesDescription = 'AI Tumor Segmentation (Volume Rendering)'
            new_ds.Modality = 'MR'  # MRI로 표시 (볼륨 렌더링 호환성)
            
            # SOP Instance 정보
            new_ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.4'  # MR Image Storage
            new_ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
            new_ds.InstanceNumber = str(frame_idx + 1)
            
            # 픽셀 데이터
            new_ds.Rows = rows
            new_ds.Columns = cols
            new_ds.SamplesPerPixel = 1
            new_ds.PhotometricInterpretation = 'MONOCHROME2'
            new_ds.BitsAllocated = 8
            new_ds.BitsStored = 8
            new_ds.HighBit = 7
            new_ds.PixelRepresentation = 0
            
            # 종양 영역을 255로, 배경을 0으로 설정 (이미 처리됨)
            # frame_data는 이미 (pixel_array[frame_idx] > 0).astype(np.uint8) * 255로 처리됨
            new_ds.PixelData = frame_data.tobytes()
            
            # Window/Level 설정 (볼륨 렌더링을 위해)
            new_ds.WindowCenter = 127.5
            new_ds.WindowWidth = 255.0
            
            # DICOM 인코딩 설정
            new_ds.is_little_endian = True
            new_ds.is_implicit_VR = False
            
            # Orthanc에 업로드
            dicom_bytes = io.BytesIO()
            new_ds.save_as(dicom_bytes, write_like_original=False)
            dicom_bytes.seek(0)
            
            # Orthanc 업로드
            upload_response = requests.post(
                f"{client.base_url}/instances",
                data=dicom_bytes.read(),
                headers={'Content-Type': 'application/dicom'},
                auth=client.auth
            )
            upload_response.raise_for_status()
            uploaded_id = upload_response.json()['ID']
            instance_ids.append(uploaded_id)
            
            logger.debug(f"프레임 {frame_idx + 1}/{num_frames} 변환 완료: {uploaded_id}")
        
        logger.info(f"✅ DICOM SEG → {len(instance_ids)}개 인스턴스 변환 완료")
        
        return Response({
            'success': True,
            'num_frames': len(instance_ids),
            'instance_ids': instance_ids,
            'series_instance_uid': f"{seg_series_uid}_volume",
        })
        
    except Exception as e:
        logger.error(f"❌ DICOM SEG → 인스턴스 변환 실패: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ============================================================
# 연구실 컴퓨터 추론 요청 API
# ============================================================

REQUEST_DIR = Path(os.getenv('INFERENCE_REQUEST_DIR', '/tmp/mri_inference_requests'))

def _create_local_inference_request(request, series_id, sequence_series_ids):
    """
    연구실 컴퓨터에서 추론 실행 요청 생성 (내부 함수)
    """
    try:
        REQUEST_DIR.mkdir(exist_ok=True, parents=True)
        
        request_data = {
            'series_ids': sequence_series_ids,
            'main_series_id': series_id,
            'requested_at': timezone.now().isoformat(),
            'status': 'pending',
            'requested_by': getattr(request.user, 'username', 'anonymous') if hasattr(request, 'user') and hasattr(request.user, 'is_authenticated') and request.user.is_authenticated else 'anonymous'
        }
        
        timestamp = int(timezone.now().timestamp() * 1000)
        request_id = f"{series_id}_{timestamp}"
        request_file = REQUEST_DIR / f"{request_id}.json"
        
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(request_data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ 추론 요청 생성: {request_file.name}")
        
        import time
        max_wait_time = 600  # 10분 (다운로드 시간이 길 수 있음)
        check_interval = 2
        elapsed_time = 0
        
        while elapsed_time < max_wait_time:
            time.sleep(check_interval)
            elapsed_time += check_interval
            
            try:
                with open(request_file, 'r', encoding='utf-8') as f:
                    current_data = json.load(f)
                
                current_status = current_data.get('status')
                if current_status == 'completed':
                    result = current_data.get('result', {})
                    return Response({
                        'success': True,
                        'series_id': series_id,
                        'request_id': request_id,
                        'tumor_detected': result.get('tumor_detected'),
                        'tumor_volume_voxels': result.get('tumor_volume_voxels'),
                        'seg_instance_id': result.get('seg_instance_id'),
                        'elapsed_time_seconds': result.get('elapsed_time_seconds'),
                        'saved_to_orthanc': True,
                        'processed_by': 'local_worker'
                    })
                elif current_status == 'failed':
                    result = current_data.get('result', {})
                    return Response({
                        'success': False,
                        'error': result.get('error', '알 수 없는 오류'),
                        'request_id': request_id
                    }, status=500)
            except:
                pass
        
        return Response({
            'success': False,
            'error': f'요청 처리 시간 초과 (최대 {max_wait_time}초)',
            'request_id': request_id
        }, status=504)
        
    except Exception as e:
        logger.error(f"❌ 추론 요청 생성 실패: {str(e)}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
def request_local_inference(request, series_id):
    """
    연구실 컴퓨터에서 추론 실행 요청
    """
    sequence_series_ids = request.data.get("sequence_series_ids", [])
    if len(sequence_series_ids) != 4:
        return Response({'success': False, 'error': '4개 시리즈 필요'}, status=400)
    return _create_local_inference_request(request, series_id, sequence_series_ids)


@api_view(['GET'])
def check_inference_status(request, request_id):
    """
    추론 요청 상태 확인
    """
    try:
        request_files = list(REQUEST_DIR.glob(f"{request_id}.json"))
        if not request_files:
            return Response({'success': False, 'error': '요청 없음'}, status=404)
        
        with open(request_files[0], 'r', encoding='utf-8') as f:
            request_data = json.load(f)
        
        return Response({'success': True, 'request_id': request_id, 'status': request_data.get('status'), 'result': request_data.get('result')})
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
def list_inference_requests(request):
    """
    추론 요청 목록 조회
    """
    try:
        request_files = sorted(REQUEST_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)
        requests_list = []
        for rf in request_files[:50]:
            with open(rf, 'r', encoding='utf-8') as f:
                d = json.load(f)
                requests_list.append({'request_id': rf.stem, 'status': d.get('status'), 'requested_at': d.get('requested_at')})
        return Response({'success': True, 'requests': requests_list})
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
def get_pending_requests(request):
    """
    워커용: 대기 중인 요청 조회
    """
    try:
        request_files = sorted(REQUEST_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime)
        pending = []
        for rf in request_files:
            with open(rf, 'r', encoding='utf-8') as f:
                d = json.load(f)
                if d.get('status') == 'pending':
                    pending.append({'request_id': rf.stem, 'series_ids': d.get('series_ids'), 'main_series_id': d.get('main_series_id')})
        return Response({'success': True, 'requests': pending})
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
def get_pending_inference(request):
    """
    조원님 워커 호환용
    """
    try:
        request_files = sorted(REQUEST_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime)
        for rf in request_files:
            with open(rf, 'r', encoding='utf-8') as f:
                d = json.load(f)
                if d.get('status') == 'pending':
                    d['status'] = 'processing'
                    with open(rf, 'w', encoding='utf-8') as f2:
                        json.dump(d, f2, indent=2, ensure_ascii=False)
                    return Response({'id': rf.stem, 'series_id': d.get('main_series_id'), 'series_ids': d.get('series_ids', [])})
        return Response({'id': None})
    except Exception as e:
        return Response({'id': None, 'error': str(e)}, status=500)


@api_view(['POST'])
def complete_inference(request, request_id):
    """
    조원님 워커 호환용
    """
    try:
        request_file = REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists(): return Response({'success': False}, status=404)
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        d['status'] = 'completed' if request.data.get('success') else 'failed'
        d['result'] = request.data
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        return Response({'success': True})
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
@authentication_classes([CSRFExemptSessionAuthentication])
@permission_classes([AllowAny])
def complete_inference_request(request, request_id):
    return complete_inference(request, request_id)


@api_view(['POST'])
def update_request_status(request, request_id):
    try:
        request_file = REQUEST_DIR / f"{request_id}.json"
        if not request_file.exists(): return Response({'success': False}, status=404)
        with open(request_file, 'r', encoding='utf-8') as f:
            d = json.load(f)
        d['status'] = request.data.get('status', d['status'])
        with open(request_file, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        return Response({'success': True})
    except Exception as e:
        return Response({'success': False}, status=500)
