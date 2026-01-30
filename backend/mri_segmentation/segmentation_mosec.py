#!/usr/bin/env python3
"""
Mosec 기반 MRI 세그멘테이션 서버
Sliding Window Inference를 사용하여 128×128×128 모델로 전체 볼륨 처리
- 모델 학습 크기: [4, 128, 128, 128] (4 channels, 128 depth, 128 height, 128 width)
- 실제 처리: [4, D, H, W] (D는 전체 슬라이스 수, 예: 134)
- Sliding Window: roi_size=(128, 128, 128), overlap=0.25
"""
import os
import io
import base64
import logging
import numpy as np
import torch
from monai.inferers import sliding_window_inference
from monai.transforms import (
    Compose, LoadImaged, EnsureChannelFirstd, Orientationd,
    Spacingd, NormalizeIntensityd, EnsureTyped
)
import pydicom
from PIL import Image
from scipy import ndimage
from scipy.ndimage import binary_opening, binary_closing, gaussian_filter
from datetime import datetime
from pydicom.uid import generate_uid
from pydicom.dataset import Dataset, FileDataset
import re
import requests
import tempfile
from pathlib import Path
import SimpleITK as sitk
import nibabel as nib

from mosec import Server, Worker, ValidationError
from monai.networks.nets import SwinUNETR

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 환경 변수
MODEL_PATH = '/home/shrjsdn908/models/mri_models/Phase1_Segmentation_best.pth'
ORTHANC_URL = 'http://localhost:8042'
ORTHANC_USER = 'admin'
ORTHANC_PASSWORD = 'admin123'


def dicom_to_numpy(dicom_bytes):
    """DICOM 바이트를 numpy 배열로 변환 (조원 코드와 동일한 정규화)"""
    dicom = pydicom.dcmread(io.BytesIO(dicom_bytes))
    pixel_array = dicom.pixel_array.astype(np.float32)
    
    # 조원 코드와 동일한 정규화: nonzero=True, channel_wise=True (Z-score normalization)
    # nonzero=True: 0이 아닌 값에 대해서만 정규화
    non_zero_mask = pixel_array != 0
    if non_zero_mask.any():
        mean = pixel_array[non_zero_mask].mean()
        std = pixel_array[non_zero_mask].std()
        if std > 0:
            pixel_array[non_zero_mask] = (pixel_array[non_zero_mask] - mean) / std
    
    return pixel_array, dicom



def convert_dicom_series_to_nifti(dicom_dir, output_path=None):
    """DICOM 시리즈를 NIfTI로 변환 (조원 코드와 동일)"""
    try:
        dicom_dir = Path(dicom_dir)
        
        # Read DICOM series using SimpleITK
        reader = sitk.ImageSeriesReader()
        dicom_files = reader.GetGDCMSeriesFileNames(str(dicom_dir))
        
        if len(dicom_files) == 0:
            raise ValueError(f"No DICOM files found in {dicom_dir}")
        
        reader.SetFileNames(dicom_files)
        image = reader.Execute()
        
        # Convert to numpy array
        array = sitk.GetArrayFromImage(image)
        
        # Get affine matrix
        spacing = image.GetSpacing()
        origin = image.GetOrigin()
        direction = np.array(image.GetDirection()).reshape(3, 3)
        
        # Create affine
        affine = np.eye(4)
        affine[:3, :3] = direction * np.array(spacing)
        affine[:3, 3] = origin
        
        # Transpose array to match NIfTI convention (SimpleITK uses different ordering)
        array = np.transpose(array, (2, 1, 0))
        
        # Create NIfTI image
        nifti_img = nib.Nifti1Image(array, affine)
        
        # Save to file
        if output_path is None:
            temp_dir = tempfile.mkdtemp()
            output_path = os.path.join(temp_dir, "converted.nii.gz")
        
        nib.save(nifti_img, output_path)
        logger.info(f"✅ DICOM → NIfTI 변환 완료: {output_path}")
        logger.info(f"  Shape: {array.shape}, Spacing: {spacing}")
        
        return output_path
        
    except Exception as e:
        logger.error(f"❌ DICOM → NIfTI 변환 실패: {e}")
        raise

def create_4d_input_from_sequences(sequences_3d, target_spatial=None, target_depth=None):
    """4개 시퀀스의 3D 볼륨을 [4, D, H, W]로 변환 (원본 크기 유지 또는 리사이즈)
    
    Args:
        sequences_3d: list of 4 numpy arrays, 각각 [D, H, W] 형태
        target_spatial: 공간 크기 (None이면 원본 유지)
        target_depth: 깊이 크기 (None이면 원본 유지)
    
    Returns:
        volume_4d: [4, D, H, W] numpy array
    """
    from scipy.ndimage import zoom
    
    if target_spatial is None or target_depth is None:
        # 조원 코드와 동일하게 1.5mm spacing으로 리샘플링
        from scipy.ndimage import zoom
        target_spacing = 1.5  # 조원 코드와 동일 (config.SPACING = (1.5, 1.5, 1.5))
        
        resized_sequences = []
        for seq_3d in sequences_3d:
            d, h, w = seq_3d.shape
            # DICOM에서 spacing 정보를 가져와야 하지만, 일단 1.5mm로 가정
            # 실제로는 DICOM 태그에서 PixelSpacing, SliceThickness를 가져와야 함
            # 현재는 원본 크기 유지하되, 나중에 spacing 정보를 추가할 수 있도록 구조 유지
            resized_sequences.append(seq_3d)
        
        volume_4d = np.stack(resized_sequences, axis=0)
        logger.info(f"✅ 3D 볼륨 생성 완료 (원본 크기 유지, spacing 리샘플링은 추후 추가): {volume_4d.shape} (4 channels, {volume_4d.shape[1]} depth, {volume_4d.shape[2]}×{volume_4d.shape[3]})")
        return volume_4d
    
    # 리사이즈 모드
    resized_sequences = []
    for seq_3d in sequences_3d:
        d, h, w = seq_3d.shape
        zoom_factors = (target_depth / d, target_spatial / h, target_spatial / w)
        resized = zoom(seq_3d, zoom_factors, order=1)
        resized_sequences.append(resized)
    
    # [4, D, H, W]
    volume_4d = np.stack(resized_sequences, axis=0)
    
    logger.info(f"✅ 3D 볼륨 생성 완료 (리사이즈): {volume_4d.shape} (4 channels, {target_depth} depth, {target_spatial}×{target_spatial})")
    return volume_4d


def create_mock_4d_input(slice_2d):
    """단일 2D 슬라이스를 4D MRI 입력으로 변환 (fallback)"""
    mock_3d = np.stack([slice_2d] * 128, axis=0)  # [128, H, W]
    return create_4d_input_from_sequences([mock_3d] * 4)


def postprocess_mask(mask, smooth_boundary=False):
    """세그멘테이션 마스크 후처리 (조원 코드와 동일하게)
    
    Args:
        mask: 입력 마스크 (2D numpy array, 이미 이진화됨)
        smooth_boundary: 사용하지 않음 (조원 코드와 동일하게 유지)
    
    Returns:
        mask_cleaned: 후처리된 마스크
    """
    # 조원 코드와 동일한 순서: Keep largest component → Fill holes
    # 1. 가장 큰 연결된 컴포넌트만 유지
    labeled, num_features = ndimage.label(mask)
    if num_features > 0:
        sizes = ndimage.sum(mask, labeled, range(1, num_features + 1))
        largest_component = np.argmax(sizes) + 1
        binary_mask = (labeled == largest_component).astype(np.uint8)
    else:
        binary_mask = mask.astype(np.uint8)
    
    # 2. Fill holes (조원 코드와 동일)
    binary_mask = ndimage.binary_fill_holes(binary_mask).astype(np.uint8)
    
    return binary_mask


def create_dicom_seg(original_dicom, mask_array, seg_series_uid, instance_number, original_series_id):
    """세그멘테이션 마스크를 DICOM SEG 파일로 변환"""
    file_meta = Dataset()
    file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
    file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.7'
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.ImplementationClassUID = generate_uid()
    
    ds = FileDataset(None, {}, file_meta=file_meta, preamble=b"\0" * 128)
    
    # 환자 정보
    ds.PatientName = getattr(original_dicom, 'PatientName', 'Anonymous')
    ds.PatientID = getattr(original_dicom, 'PatientID', 'Unknown')
    ds.PatientBirthDate = getattr(original_dicom, 'PatientBirthDate', '')
    ds.PatientSex = getattr(original_dicom, 'PatientSex', '')
    # 한글 지원을 위한 문자셋 설정
    ds.SpecificCharacterSet = 'ISO_IR 192'  # UTF-8
    
    # 스터디 정보
    ds.StudyInstanceUID = safe_get_uid(original_dicom, 'StudyInstanceUID', generate_uid)
    ds.StudyDate = getattr(original_dicom, 'StudyDate', datetime.now().strftime('%Y%m%d'))
    ds.StudyTime = getattr(original_dicom, 'StudyTime', datetime.now().strftime('%H%M%S'))
    ds.StudyID = getattr(original_dicom, 'StudyID', '')
    ds.AccessionNumber = getattr(original_dicom, 'AccessionNumber', '')
    
    # 세그멘테이션 시리즈 정보
    ds.SeriesInstanceUID = seg_series_uid
    ds.SeriesNumber = '9999'
    # SeriesDescription: 64자 제한 (VR LO 최대 길이)
    series_desc = f'AI Tumor Segmentation (Series: {original_series_id[:30] if len(str(original_series_id)) > 30 else original_series_id})'[:64]
    ds.SeriesDescription = series_desc
    ds.Modality = 'SEG'
    
    # SOP Instance 정보
    ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.7'
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.InstanceNumber = str(instance_number)
    
    # 픽셀 데이터 정보
    ds.Rows = mask_array.shape[0]
    ds.Columns = mask_array.shape[1]
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    
    pixel_data = (mask_array * 255).astype(np.uint8)
    ds.PixelData = pixel_data.tobytes()
    
    # 기타 정보
    ds.ContentDate = datetime.now().strftime('%Y%m%d')
    ds.ContentTime = datetime.now().strftime('%H%M%S')
    ds.ImageType = ['DERIVED', 'SECONDARY', 'AI_SEGMENTATION']
    
    logger.info(f"✅ DICOM SEG 파일 생성 완료: {ds.SOPInstanceUID} (Series: {seg_series_uid}, Instance: {instance_number})")
    return ds



def is_valid_uid(uid):
    """DICOM UID 형식 검증: 점(.)으로 구분된 숫자만 허용"""
    if not uid or not isinstance(uid, str):
        return False
    pattern = r'^[0-9]+(\.[0-9]+)*$'
    return bool(re.match(pattern, str(uid)))

def safe_get_uid(dicom_obj, attr_name, default_func):
    """원본 DICOM에서 UID를 안전하게 가져오기 (검증 후)"""
    uid = getattr(dicom_obj, attr_name, None)
    if uid and is_valid_uid(str(uid)):
        return str(uid)
    logger.warning(f"⚠️ 잘못된 {attr_name} 형식: {uid}, 새 UID 생성")
    return default_func()

def create_dicom_seg_multiframe(original_dicom, mask_array_3d, seg_series_uid, start_instance_number, original_series_id):
    """
    3D 세그멘테이션 마스크를 Multi-frame DICOM SEG로 변환
    
    Args:
        original_dicom: 원본 DICOM 파일
        mask_array_3d: (96, H, W) 형태의 3D 마스크
        seg_series_uid: 세그멘테이션 시리즈 UID
        start_instance_number: 시작 Instance 번호
        original_series_id: 원본 시리즈 ID
    """
    num_frames = mask_array_3d.shape[0]
    
    file_meta = Dataset()
    file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
    file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.66.4'  # Segmentation Storage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.ImplementationClassUID = generate_uid()
    
    ds = FileDataset(None, {}, file_meta=file_meta, preamble=b"\0" * 128)
    
    # 환자 정보
    ds.PatientName = getattr(original_dicom, 'PatientName', 'Anonymous')
    ds.PatientID = getattr(original_dicom, 'PatientID', 'Unknown')
    ds.PatientBirthDate = getattr(original_dicom, 'PatientBirthDate', '')
    ds.PatientSex = getattr(original_dicom, 'PatientSex', '')
    # 한글 지원을 위한 문자셋 설정
    ds.SpecificCharacterSet = 'ISO_IR 192'  # UTF-8
    
    # 스터디 정보
    ds.StudyInstanceUID = safe_get_uid(original_dicom, 'StudyInstanceUID', generate_uid)
    ds.StudyDate = getattr(original_dicom, 'StudyDate', datetime.now().strftime('%Y%m%d'))
    ds.StudyTime = getattr(original_dicom, 'StudyTime', datetime.now().strftime('%H%M%S'))
    ds.StudyID = getattr(original_dicom, 'StudyID', '')
    ds.AccessionNumber = getattr(original_dicom, 'AccessionNumber', '')
    
    # 세그멘테이션 시리즈 정보
    ds.SeriesInstanceUID = seg_series_uid
    ds.SeriesNumber = '9999'
    # SeriesDescription: 64자 제한 (VR LO 최대 길이)
    series_desc = f'AI Tumor Segmentation (Series: {original_series_id[:30] if len(str(original_series_id)) > 30 else original_series_id})'[:64]
    ds.SeriesDescription = series_desc
    ds.Modality = 'SEG'
    
    # SOP Instance 정보
    ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.66.4'  # Segmentation Storage
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.InstanceNumber = str(start_instance_number)
    
    # Multi-frame 픽셀 데이터 정보
    ds.NumberOfFrames = num_frames
    ds.Rows = mask_array_3d.shape[1]
    ds.Columns = mask_array_3d.shape[2]
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    
    # 96개 프레임을 하나의 PixelData로 결합
    pixel_data_list = []
    for i in range(num_frames):
        frame_data = (mask_array_3d[i] * 255).astype(np.uint8)
        pixel_data_list.append(frame_data.tobytes())
    
    ds.PixelData = b''.join(pixel_data_list)
    
    # DICOM 인코딩 설정 (필수!)
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    
    # 기타 정보
    ds.ContentDate = datetime.now().strftime('%Y%m%d')
    ds.ContentTime = datetime.now().strftime('%H%M%S')
    ds.ImageType = ['DERIVED', 'SECONDARY', 'AI_SEGMENTATION']
    
    logger.info(f"✅ DICOM SEG 파일 생성 완료: {ds.SOPInstanceUID} (Series: {seg_series_uid}, Instance: {start_instance_number}, Frames: {num_frames})")
    return ds


def upload_to_orthanc(dicom_dataset, orthanc_url=None, orthanc_auth=None):
    """DICOM 파일을 Orthanc에 업로드"""
    with tempfile.NamedTemporaryFile(suffix='.dcm', delete=False) as tmp:
        try:
            dicom_dataset.save_as(tmp.name)
            with open(tmp.name, 'rb') as f:
                dicom_bytes = f.read()
            
            response = requests.post(
                f"{orthanc_url or ORTHANC_URL}/instances",
                auth=orthanc_auth or (ORTHANC_USER, ORTHANC_PASSWORD),
                headers={'Content-Type': 'application/dicom'},
                data=dicom_bytes,
                timeout=30
            )
            
            # 에러 응답 자세히 로깅
            if response.status_code != 200:
                logger.error(f"❌ Orthanc 업로드 실패: {response.status_code}")
                try:
                    error_detail = response.json()
                    logger.error(f"   에러 상세: {error_detail}")
                except:
                    logger.error(f"   에러 응답: {response.text[:500]}")
                response.raise_for_status()
            
            result = response.json()
            instance_id = result.get('ID')
            logger.info(f"✅ Orthanc 업로드 완료: Instance ID = {instance_id}")
            return instance_id
        except Exception as e:
            logger.error(f"⚠️ Orthanc 저장 실패: {type(e).__name__}: {e}")
            raise
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)


class SegmentationWorker(Worker):
    def __init__(self):
        super().__init__()
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = None
        self.pipeline = None  # MAMA_MIA_JO_WON_PKG pipeline
        logger.info(f"💻 Device: {self.device}")
    
    def deserialize(self, data: bytes) -> dict:
        """요청 데이터 역직렬화 (Orthanc API 방식)"""
        try:
            import json
            import requests
            import base64
            
            json_data = json.loads(data.decode('utf-8'))
            
            logger.info(f"📥 수신한 데이터 키: {list(json_data.keys())}")
            
            # 기본 Orthanc 설정 (orthanc_instance_ids가 없을 경우 대비)
            orthanc_url = ORTHANC_URL
            orthanc_auth = (ORTHANC_USER, ORTHANC_PASSWORD)
            # Orthanc Instance ID 목록이 있으면 Orthanc API로 다운로드
            if "orthanc_instance_ids" in json_data:
                orthanc_url = json_data["orthanc_url"]
                orthanc_auth = tuple(json_data["orthanc_auth"])
                
                total_slices = len(json_data['orthanc_instance_ids'][0])
                logger.info(f"📥 Orthanc에서 데이터 다운로드 중: {orthanc_url}")
                logger.info(f"📊 총 {len(json_data['orthanc_instance_ids'])}개 시퀀스, 각 {total_slices}개 슬라이스 (전체 처리)")
                
                sequences_3d = []
                for seq_idx, seq_instances in enumerate(json_data["orthanc_instance_ids"]):
                    slices_data = []
                    for slice_idx, instance_id in enumerate(seq_instances):
                        # Orthanc API로 DICOM 파일 다운로드
                        response = requests.get(
                            f"{orthanc_url}/instances/{instance_id}/file",
                            auth=orthanc_auth,
                            timeout=30
                        )
                        response.raise_for_status()
                        
                        # Base64 인코딩
                        slices_data.append(base64.b64encode(response.content).decode('utf-8'))
                        
                        if (slice_idx + 1) % 20 == 0:
                            logger.info(f"  시퀀스 {seq_idx+1}: {slice_idx+1}/{len(seq_instances)} 슬라이스 다운로드 완료")
                    
                    sequences_3d.append(slices_data)
                    logger.info(f"✅ 시퀀스 {seq_idx+1}/4 다운로드 완료: {len(slices_data)}개 슬라이스")
                
                return {
                    "sequences_3d": sequences_3d,
                    "seg_series_uid": json_data.get("seg_series_uid"),
                    "original_series_id": json_data.get("original_series_id"),
                    "start_instance_number": json_data.get("start_instance_number", 1),
                    "total_slices": json_data.get("total_slices", total_slices),  # 전체 슬라이스 수 전달
                    "orthanc_url": orthanc_url,
                    "orthanc_auth": orthanc_auth
                }
            
            # 기존 방식 (sequences_3d가 직접 포함된 경우)
            if "sequences_3d" in json_data or "sequences" in json_data:
                logger.info("📥 4-channel JSON 입력 감지")
                return json_data
                
        except Exception as e:
            logger.error(f"역직렬화 실패: {e}", exc_info=True)
            return {"error": str(e)}
        
        logger.warning(f"알 수 없는 데이터 형식. 받은 키: {list(json_data.keys()) if 'json_data' in locals() else 'JSON 파싱 실패'}")
        return {}

    def forward(self, data: dict) -> dict:
        """세그멘테이션 추론"""
        try:
            # 모델 로드
            if self.model is None:
                logger.info(f"🔄 세그멘테이션 모델 로딩 중: {MODEL_PATH}")
                
                self.model = SwinUNETR(
                    spatial_dims=3,
                    in_channels=4,
                    out_channels=1,
                    feature_size=24,  # 128×128×128 모델과 동일한 feature_size
                    use_checkpoint=False,
                )
                
                checkpoint = torch.load(MODEL_PATH, map_location=self.device, weights_only=False)
                
                if 'model_state_dict' in checkpoint:
                    state_dict = checkpoint['model_state_dict']
                else:
                    state_dict = checkpoint
                
                # 키 이름 변환
                new_state_dict = {}
                for key, value in state_dict.items():
                    if 'lora_A' in key or 'lora_B' in key:
                        continue
                    new_key = key.replace('model.base_model.model.', '')
                    new_key = new_key.replace('.base_layer', '')
                    new_state_dict[new_key] = value
                
                self.model.load_state_dict(new_state_dict, strict=False)
                self.model = self.model.to(self.device)
                self.model.eval()
                logger.info("✅ 세그멘테이션 모델 로드 완료")
            
            # 조원 코드와 동일하게: DICOM → NIfTI 변환 → MONAI transforms
            original_dicom = None  # 초기화 (후처리에서 사용 가능하도록)
            if "sequences_3d" in data and len(data["sequences_3d"]) == 4:
                # 첫 번째 시퀀스의 첫 번째 슬라이스에서 원본 DICOM 메타데이터 추출
                if len(data["sequences_3d"]) > 0 and len(data["sequences_3d"][0]) > 0:
                    first_slice_b64 = data["sequences_3d"][0][0]
                    first_slice_bytes = base64.b64decode(first_slice_b64)
                    original_dicom = pydicom.dcmread(io.BytesIO(first_slice_bytes))
                    # 원본 spacing 정보 추출

                    original_spacing = None

                    if hasattr(original_dicom, 'PixelSpacing') and hasattr(original_dicom, 'SliceThickness'):

                        pixel_spacing = list(original_dicom.PixelSpacing)  # [row, col] in mm

                        slice_thickness = float(original_dicom.SliceThickness)  # in mm

                        original_spacing = [pixel_spacing[0], pixel_spacing[1], slice_thickness]  # [x, y, z] in mm

                        logger.info(f"📏 원본 spacing 추출: {original_spacing} mm")

                    elif hasattr(original_dicom, 'PixelSpacing'):

                        pixel_spacing = list(original_dicom.PixelSpacing)

                        original_spacing = [pixel_spacing[0], pixel_spacing[1], 1.0]  # 기본값

                        logger.info(f"📏 원본 spacing 추출 (SliceThickness 없음): {original_spacing} mm")

                    # spacing 추출 실패 시 기본값 사용
                    if original_spacing is None:
                        logger.warning("⚠️ 원본 spacing 정보를 찾을 수 없어 기본값 [0.5, 0.5, 0.5] 사용")
                        original_spacing = [0.5, 0.5, 0.5]  # 기본값 (일반적인 MRI spacing)
                    
                    logger.info(f"✅ 원본 DICOM 메타데이터 추출: PatientID={getattr(original_dicom, 'PatientID', 'Unknown')}, PatientName={getattr(original_dicom, 'PatientName', 'Unknown')}")
                else:
                    logger.warning("⚠️ 첫 번째 슬라이스를 찾을 수 없어 original_dicom을 None으로 설정")
                
                # 4-channel 3D DCE-MRI 모드 (조원 코드와 동일한 파이프라인)
                total_slices = data.get("total_slices", len(data["sequences_3d"][0]))
                logger.info(f"📊 4-channel 3D DCE-MRI 입력 감지 ({total_slices} slices per sequence) - 조원 코드와 동일한 전처리")
                
                # 원본 DICOM 크기 정보 저장 (spacing 복원용)
                if original_dicom is not None:
                    original_size = [
                        total_slices,  # D (슬라이스 수)
                        int(original_dicom.Rows) if hasattr(original_dicom, "Rows") else 256,  # H
                        int(original_dicom.Columns) if hasattr(original_dicom, "Columns") else 256  # W
                    ]
                    logger.info(f"📏 원본 DICOM 크기 저장: {original_size} (슬라이스 수, H, W)")

                # 1. DICOM 슬라이스들을 임시 디렉토리에 저장
                temp_base_dir = tempfile.mkdtemp()
                nifti_files = []
                
                try:
                    for seq_idx, seq_slices_b64 in enumerate(data["sequences_3d"]):
                        # 각 시퀀스별 임시 디렉토리 생성
                        seq_dir = os.path.join(temp_base_dir, f"sequence_{seq_idx}")
                        os.makedirs(seq_dir, exist_ok=True)
                        
                        # DICOM 슬라이스들을 파일로 저장
                        for slice_idx, slice_b64 in enumerate(seq_slices_b64):
                            slice_bytes = base64.b64decode(slice_b64)
                            dicom_file = os.path.join(seq_dir, f"slice_{slice_idx:04d}.dcm")
                            with open(dicom_file, "wb") as f:
                                f.write(slice_bytes)
                        
                        # DICOM 시리즈를 NIfTI로 변환 (조원 코드와 동일)
                        nifti_file = convert_dicom_series_to_nifti(seq_dir)
                        nifti_files.append(nifti_file)
                        logger.info(f"✅ 시퀀스 {seq_idx+1}/4: DICOM → NIfTI 변환 완료")
                    
                    # 2. MONAI transforms 적용 (조원 코드와 완전히 동일)
                    transforms = Compose([
                        LoadImaged(keys=["image"], image_only=False),  # NIfTI 로드
                        EnsureChannelFirstd(keys=["image"]),  # 채널 순서 확인
                        Orientationd(keys=["image"], axcodes="RAS"),  # ✅ RAS 변환
                        Spacingd(keys=["image"], pixdim=(1.5, 1.5, 1.5), mode="bilinear"),  # ✅ 1.5mm 리샘플링
                        NormalizeIntensityd(keys=["image"], nonzero=True, channel_wise=True),  # ✅ 정규화
                        EnsureTyped(keys=["image"], dtype=torch.float32)  # Tensor 변환
                    ])
                    
                    # 3. 각 시퀀스를 전처리하고 4채널로 합치기
                    preprocessed_sequences = []
                    for nifti_file in nifti_files:
                        data_dict = {"image": nifti_file}
                        preprocessed = transforms(data_dict)
                        seq_tensor = preprocessed["image"]  # [C, H, W, D] 형태 (C=1)
                        preprocessed_sequences.append(seq_tensor)
                    
                    # 4. 4채널로 합치기: [4, H, W, D]
                    volume_4d = torch.cat(preprocessed_sequences, dim=0)  # [4, H, W, D]
                    logger.info(f"✅ 조원 코드와 동일한 전처리 완료: {volume_4d.shape}")
                    
                    # 5. Batch dimension 추가: [1, 4, H, W, D]
                    input_tensor = volume_4d.unsqueeze(0).to(self.device)
                    
                    # MAMA_MIA_JO_WON_PKG 추론 파이프라인 사용
                    if self.pipeline is None:
                        import sys
                        sys.path.insert(0, "/home/shrjsdn908/MAMA_MIA_JO_WON_PKG/src")
                        from inference_pipeline import SegmentationInferencePipeline
                        
                        logger.info(f"🔄 MAMA_MIA_JO_WON_PKG 추론 파이프라인 로딩 중: {MODEL_PATH}")
                        self.pipeline = SegmentationInferencePipeline(
                            model_path=MODEL_PATH,
                            device="cpu",
                            threshold=0.5
                        )
                        logger.info("✅ MAMA_MIA_JO_WON_PKG 파이프라인 로드 완료")
                    
                    # MAMA_MIA_JO_WON_PKG pipeline으로 추론
                    logger.info(f"🚀 MAMA_MIA_JO_WON_PKG 파이프라인으로 추론 시작...")
                    result = self.pipeline.predict(
                        image_path=temp_base_dir,
                        output_format="dicom",
                        return_probabilities=False
                    )
                    
                    # 결과 추출
                    tumor_detected = result.get("tumor_detected", False)
                    tumor_volume_voxels = result.get("tumor_volume_voxels", 0)
                    segmentation_mask = result.get("segmentation")
                    
                    logger.info(f"✅ MAMA_MIA_JO_WON_PKG 추론 완료: tumor_detected={tumor_detected}, volume={tumor_volume_voxels}")
                    
                    # segmentation_mask를 mask_resized_3d로 변환
                    if segmentation_mask is not None:
                        # segmentation_mask는 numpy array [D, H, W] 형태
                        if segmentation_mask.ndim == 2:
                            segmentation_mask = segmentation_mask[np.newaxis, ...]
                        elif segmentation_mask.ndim == 4:
                            segmentation_mask = segmentation_mask.squeeze(0).squeeze(0)
                        elif segmentation_mask.ndim == 3 and segmentation_mask.shape[0] == 1:
                            segmentation_mask = segmentation_mask.squeeze(0)
                        
                        # mask_resized_3d 초기화 (기존 코드와 호환)
                        mask_resized_3d = segmentation_mask.astype(np.uint8)
                        logger.info(f"✅ MAMA_MIA_JO_WON_PKG 결과 변환 완료: {mask_resized_3d.shape}")
                        
                        # 원본 크기 정보 가져오기
                        if original_dicom is not None:
                            h = getattr(original_dicom, "Rows", mask_resized_3d.shape[1])
                            w = getattr(original_dicom, "Columns", mask_resized_3d.shape[2])
                        else:
                            h, w = mask_resized_3d.shape[1], mask_resized_3d.shape[2]
                    else:
                        # 에러 발생 시 빈 배열로 초기화 (에러 방지)
                        mask_resized_3d = np.zeros((1, 256, 256), dtype=np.uint8)
                        raise ValueError("MAMA_MIA_JO_WON_PKG 파이프라인에서 segmentation_mask를 반환하지 않았습니다.")
                    
                    
                finally:
                    # 임시 파일 정리
                    import shutil
                    try:
                        shutil.rmtree(temp_base_dir)
                    except:
                        pass
            elif "dicom_data" in data:
                # 단일 이미지 모드 (JSON with base64)
                logger.info("📊 단일 이미지 입력 감지 (JSON)")
                dicom_bytes = base64.b64decode(data["dicom_data"])
                slice_2d, original_dicom = dicom_to_numpy(dicom_bytes)
                volume_4d = create_mock_4d_input(slice_2d)
            elif "dicom_bytes" in data:
                # 단일 이미지 모드 (raw bytes - fallback)
                logger.info("📊 단일 이미지 입력 감지 (raw bytes)")
                dicom_bytes = data["dicom_bytes"]
                slice_2d, original_dicom = dicom_to_numpy(dicom_bytes)
                volume_4d = create_mock_4d_input(slice_2d)
            else:
                raise ValueError(f"지원하지 않는 데이터 형식입니다. Keys: {list(data.keys())}")
            
            # input_tensor가 아직 정의되지 않았으면 생성 (단일 이미지 모드)
            if "input_tensor" not in locals():
                input_tensor = torch.from_numpy(volume_4d).unsqueeze(0).float().to(self.device)
            
            # Sliding Window Inference로 전체 볼륨 처리
            # 모델은 128×128×128 패치로 학습되었지만, sliding window로 더 큰 볼륨 처리 가능
                    # 기존 추론 코드는 MAMA_MIA_JO_WON_PKG로 대체됨
                    # with torch.no_grad():
                    # logger.info(f"🔄 Sliding Window Inference 시작: roi_size=(128, 128, 128), overlap=0.25, mode=gaussian")
                    # output = sliding_window_inference(
                    # inputs=input_tensor,              # [1, 4, D, H, W] (D는 전체 슬라이스 수)
                    # roi_size=(128, 128, 128),        # 모델이 학습한 패치 크기 (128×128×128)
                    # sw_batch_size=1,
                    # predictor=self.model,
                    # overlap=0.25,  # 25% overlap (조원 코드와 동일)
                    # mode="gaussian"  # Smooth blending (조원 코드와 동일)
                    # )
                    # # output: [1, 1, D, H, W] (out_channels=1이므로)
                    # pred_prob = torch.sigmoid(output).squeeze(0).squeeze(0).cpu().numpy()  # [D, H, W]
                
                    # # 임계값 조정 가능 (0.5보다 낮게 설정하면 더 민감하게 검출)
                    # threshold = 0.5
                    # pred_mask = (pred_prob > threshold).astype(np.uint8)
                    # logger.info(f"📊 Output shape: {pred_mask.shape}")
                    # logger.info(f"📊 모델 출력 통계: min={pred_prob.min():.4f}, max={pred_prob.max():.4f}, mean={pred_prob.mean():.4f}")
                    # logger.info(f"📊 마스크 통계: 총 픽셀={pred_mask.size}, 종양 픽셀={pred_mask.sum()}, 비율={pred_mask.sum()/pred_mask.size*100:.2f}%")
            
                    # # 전체 슬라이스 후처리 (원본 크기 유지 또는 리사이즈)
                    # logger.info(f"📍 {pred_mask.shape[0]}개 슬라이스 전체 후처리 시작")
                    # from scipy.ndimage import zoom
            
                    # # 원본 크기 가져오기 (4-channel 모드에서는 original_dicom에서, 단일 이미지 모드에서는 slice_2d에서)
                    # if original_dicom is not None:
                    # h = getattr(original_dicom, 'Rows', 256)
                    # w = getattr(original_dicom, 'Columns', 256)
                    # elif 'slice_2d' in locals() and slice_2d is not None:
                    # h, w = slice_2d.shape
                    # else:
                    # # 모델 출력 크기 사용
                    # h, w = pred_mask.shape[1], pred_mask.shape[2]
            
                    # # 모델 출력 크기 확인
                    # model_h, model_w = pred_mask.shape[1], pred_mask.shape[2]
            
                    # # 크기가 다르면 리사이즈, 같으면 그대로 사용
                    # if h != model_h or w != model_w:
                    # logger.info(f"📍 원본 크기: {h}×{w}, 모델 출력 크기: {model_h}×{model_w} → 리사이즈 필요")
                    # zoom_factors = (h / model_h, w / model_w)
                
                    # mask_resized_3d = []
                    # for i in range(pred_mask.shape[0]):
                    # # 후처리 (경계 정확도 향상)
                    # mask_cleaned = postprocess_mask(pred_mask[i, :, :], smooth_boundary=False)
                    # # Nearest neighbor로 리사이즈 (경계 보존)
                    # mask_resized = zoom(mask_cleaned, zoom_factors, order=0)
                    # # 리사이즈 후 추가 후처리 (경계 부드럽게)
                    # mask_resized = postprocess_mask(mask_resized, smooth_boundary=False)
                    # mask_resized_3d.append(mask_resized)
                    # mask_resized_3d = np.stack(mask_resized_3d, axis=0)  # [D, H, W]
                
            # 원본 spacing으로 복원 (0.5mm)
            if original_spacing is not None:
                logger.info(f"📏 원본 spacing으로 복원: {original_spacing} mm (현재: 1.5mm)")
                # scipy.ndimage.zoom으로 원본 크기로 직접 리샘플링
                from scipy.ndimage import zoom
                if original_size is not None:
                    # 원본 크기로 직접 리샘플링
                    logger.info(f"📏 원본 크기로 복원: {original_size} (현재: {mask_resized_3d.shape})")
                    zoom_factors = [
                        original_size[0] / mask_resized_3d.shape[0],  # D
                        original_size[1] / mask_resized_3d.shape[1],  # H
                        original_size[2] / mask_resized_3d.shape[2]   # W
                    ]
                    logger.info(f"📏 Zoom factors (원본 크기 기준): {zoom_factors}")
                    mask_resized_3d = zoom(mask_resized_3d, zoom_factors, order=0, mode="nearest")
                    mask_resized_3d = mask_resized_3d.astype(np.uint8)
                    logger.info(f"✅ 원본 크기로 복원 완료: {mask_resized_3d.shape}")
                else:
                    # 기존 방식: spacing 비율로 리샘플링
                    current_spacing = [1.5, 1.5, 1.5]  # 모델 출력 spacing
                    zoom_factors = [
                        current_spacing[0] / original_spacing[0],
                        current_spacing[1] / original_spacing[1],
                        current_spacing[2] / original_spacing[2]
                    ]
                    logger.info(f"📏 Zoom factors (spacing 비율): {zoom_factors}")
                    mask_resized_3d = zoom(mask_resized_3d, zoom_factors, order=0, mode="nearest")
                    mask_resized_3d = mask_resized_3d.astype(np.uint8)
                # 메모리 정리
                import gc
                gc.collect()
            
            # 중앙 슬라이스를 대표 이미지로 사용 (PNG 미리보기용)
            center_idx = mask_resized_3d.shape[0] // 2
            mask_resized = mask_resized_3d[center_idx]
            
            # Base64 인코딩
            mask_pil = Image.fromarray((mask_resized * 255).astype(np.uint8), mode='L')
            mask_bytes = io.BytesIO()
            mask_pil.save(mask_bytes, format='PNG')
            mask_base64 = base64.b64encode(mask_bytes.getvalue()).decode('utf-8')
            
            # 통계
            tumor_pixels = int(np.sum(mask_resized))
            total_pixels = int(mask_resized.size)
            tumor_ratio = float(tumor_pixels / total_pixels)
            
            # Orthanc에 저장 (전체 슬라이스 Multi-frame DICOM SEG)
            seg_instance_id = None
            successful_slices = mask_resized_3d.shape[0]
            try:
                # Orthanc 설정 추출
                orthanc_url = data.get('orthanc_url', ORTHANC_URL)
                orthanc_auth = data.get('orthanc_auth', (ORTHANC_USER, ORTHANC_PASSWORD))
                
                seg_series_uid = data.get('seg_series_uid')
                start_instance_number = data.get('start_instance_number', 1)
                original_series_id = data.get('original_series_id', 'unknown')
                
                dicom_seg = create_dicom_seg_multiframe(original_dicom, mask_resized_3d, seg_series_uid, start_instance_number, original_series_id)
                seg_instance_id = upload_to_orthanc(dicom_seg, orthanc_url=orthanc_url, orthanc_auth=orthanc_auth)
                logger.info(f"✅ 세그멘테이션 결과 Orthanc 저장 완료: {seg_instance_id} ({successful_slices} frames)")
            except Exception as e:
                logger.error(f"⚠️ Orthanc 저장 실패 (계속 진행): {e}")
            
            return {
                "success": True,
                "segmentation_mask_base64": mask_base64,
                "tumor_pixel_count": tumor_pixels,
                "total_pixel_count": total_pixels,
                "tumor_ratio_percent": tumor_ratio * 100,
                "image_size": [int(w), int(h)],
                "seg_instance_id": seg_instance_id,
                "saved_to_orthanc": seg_instance_id is not None,
                "successful_slices": successful_slices,  # 처리된 슬라이스 수
                "total_slices": mask_resized_3d.shape[0]  # 전체 슬라이스 수
            }
            
        except Exception as e:
            logger.error(f"세그멘테이션 오류: {e}")
            import traceback
            traceback.print_exc()
            raise ValidationError(f"Segmentation failed: {e}")
    
    def serialize(self, data: dict) -> bytes:
        """응답 데이터 직렬화"""
        import json
        return json.dumps(data).encode('utf-8')


if __name__ == "__main__":
    server = Server()
    server.append_worker(
        SegmentationWorker,
        num=1,
        max_batch_size=1,
        timeout=2400000,  # 40분 (2400초 = 2,400,000 밀리초)
    )
    # CLI arguments are automatically parsed by Mosec
    # max_body_size is set via --max-body-size CLI arg
    # 최대 body size 설정: 500MB (바이트 단위)
    server.run()
