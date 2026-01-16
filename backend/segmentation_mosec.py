#!/usr/bin/env python3
"""
Mosec 기반 MRI 세그멘테이션 서버
Sliding Window Inference를 사용하여 96×96×96 모델로 전체 볼륨 처리
- 모델 학습 크기: [4, 96, 96, 96] (4 channels, 96 depth, 96 height, 96 width)
- 실제 처리: [4, D, H, W] (D는 전체 슬라이스 수, 예: 134)
- Sliding Window: roi_size=(96, 96, 96), overlap=0.75
"""
import os
import io
import base64
import logging
import numpy as np
import torch
from monai.inferers import sliding_window_inference
import pydicom
from PIL import Image
from scipy import ndimage
from scipy.ndimage import binary_opening, binary_closing, gaussian_filter
from datetime import datetime
from pydicom.uid import generate_uid
from pydicom.dataset import Dataset, FileDataset
import requests
import tempfile

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
    """DICOM 바이트를 numpy 배열로 변환"""
    dicom = pydicom.dcmread(io.BytesIO(dicom_bytes))
    pixel_array = dicom.pixel_array.astype(np.float32)
    
    # 정규화
    if pixel_array.max() > pixel_array.min():
        pixel_array = (pixel_array - pixel_array.min()) / (pixel_array.max() - pixel_array.min())
    
    return pixel_array, dicom


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
        # 원본 크기 유지
        volume_4d = np.stack(sequences_3d, axis=0)
        logger.info(f"✅ 3D 볼륨 생성 완료 (원본 크기): {volume_4d.shape} (4 channels, {volume_4d.shape[1]} depth, {volume_4d.shape[2]}×{volume_4d.shape[3]})")
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
    mock_3d = np.stack([slice_2d] * 96, axis=0)  # [96, H, W]
    return create_4d_input_from_sequences([mock_3d] * 4)


def postprocess_mask(mask, smooth_boundary=True):
    """세그멘테이션 마스크 후처리 (경계 정확도 향상)
    
    Args:
        mask: 입력 마스크 (2D numpy array)
        smooth_boundary: 경계 부드럽게 처리 여부
    
    Returns:
        mask_cleaned: 후처리된 마스크
    """
    # 1. 구멍 채우기
    mask_filled = ndimage.binary_fill_holes(mask)
    
    # 2. 작은 노이즈 제거 (opening: erosion 후 dilation)
    # 작은 돌출부 제거
    structure = np.ones((3, 3), dtype=bool)
    mask_opened = binary_opening(mask_filled, structure=structure)
    
    # 3. 작은 구멍 채우기 (closing: dilation 후 erosion)
    mask_closed = binary_closing(mask_opened, structure=structure)
    
    # 4. 가장 큰 연결된 컴포넌트만 유지
    labeled, num_features = ndimage.label(mask_closed)
    if num_features > 0:
        sizes = ndimage.sum(mask_closed, labeled, range(1, num_features + 1))
        max_label = np.argmax(sizes) + 1
        mask_cleaned = (labeled == max_label).astype(np.uint8)
    else:
        mask_cleaned = mask_closed.astype(np.uint8)
    
    # 5. 경계 부드럽게 처리 (선택사항)
    if smooth_boundary:
        # 경계를 약간 부드럽게 (가우시안 필터 + 임계값)
        smoothed = gaussian_filter(mask_cleaned.astype(float), sigma=1.0)
        mask_cleaned = (smoothed > 0.5).astype(np.uint8)
    
    return mask_cleaned


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
    
    # 스터디 정보
    ds.StudyInstanceUID = getattr(original_dicom, 'StudyInstanceUID', generate_uid())
    ds.StudyDate = getattr(original_dicom, 'StudyDate', datetime.now().strftime('%Y%m%d'))
    ds.StudyTime = getattr(original_dicom, 'StudyTime', datetime.now().strftime('%H%M%S'))
    ds.StudyID = getattr(original_dicom, 'StudyID', '')
    ds.AccessionNumber = getattr(original_dicom, 'AccessionNumber', '')
    
    # 세그멘테이션 시리즈 정보
    ds.SeriesInstanceUID = seg_series_uid
    ds.SeriesNumber = '9999'
    ds.SeriesDescription = f'AI Tumor Segmentation (Original Series: {original_series_id})'
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
    
    # 스터디 정보
    ds.StudyInstanceUID = getattr(original_dicom, 'StudyInstanceUID', generate_uid())
    ds.StudyDate = getattr(original_dicom, 'StudyDate', datetime.now().strftime('%Y%m%d'))
    ds.StudyTime = getattr(original_dicom, 'StudyTime', datetime.now().strftime('%H%M%S'))
    ds.StudyID = getattr(original_dicom, 'StudyID', '')
    ds.AccessionNumber = getattr(original_dicom, 'AccessionNumber', '')
    
    # 세그멘테이션 시리즈 정보
    ds.SeriesInstanceUID = seg_series_uid
    ds.SeriesNumber = '9999'
    ds.SeriesDescription = f'AI Tumor Segmentation (Original Series: {original_series_id})'
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
    
    # 기타 정보
    ds.ContentDate = datetime.now().strftime('%Y%m%d')
    ds.ContentTime = datetime.now().strftime('%H%M%S')
    ds.ImageType = ['DERIVED', 'SECONDARY', 'AI_SEGMENTATION']
    
    logger.info(f"✅ DICOM SEG 파일 생성 완료: {ds.SOPInstanceUID} (Series: {seg_series_uid}, Instance: {start_instance_number}, Frames: {num_frames})")
    return ds


def upload_to_orthanc(dicom_dataset):
    """DICOM 파일을 Orthanc에 업로드"""
    with tempfile.NamedTemporaryFile(suffix='.dcm', delete=False) as tmp:
        try:
            dicom_dataset.save_as(tmp.name)
            with open(tmp.name, 'rb') as f:
                dicom_bytes = f.read()
            
            response = requests.post(
                f"{ORTHANC_URL}/instances",
                auth=(ORTHANC_USER, ORTHANC_PASSWORD),
                headers={'Content-Type': 'application/dicom'},
                data=dicom_bytes,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            instance_id = result.get('ID')
            logger.info(f"✅ Orthanc 업로드 완료: Instance ID = {instance_id}")
            return instance_id
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)


class SegmentationWorker(Worker):
    def __init__(self):
        super().__init__()
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = None
        logger.info(f"💻 Device: {self.device}")
    
    def deserialize(self, data: bytes) -> dict:
        """요청 데이터 역직렬화 (Orthanc API 방식)"""
        try:
            import json
            import requests
            import base64
            
            json_data = json.loads(data.decode('utf-8'))
            
            logger.info(f"📥 수신한 데이터 키: {list(json_data.keys())}")
            
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
                    "total_slices": json_data.get("total_slices", total_slices)  # 전체 슬라이스 수 전달
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
                    feature_size=24,
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
            
            # DICOM 변환
            if "sequences_3d" in data and len(data["sequences_3d"]) == 4:
                # 4-channel 3D DCE-MRI 모드 (전체 슬라이스 처리)
                total_slices = data.get("total_slices", len(data["sequences_3d"][0]))
                logger.info(f"📊 4-channel 3D DCE-MRI 입력 감지 ({total_slices} slices per sequence) - Sliding Window 사용")
                sequences_3d = []
                original_dicom = None
                
                for seq_idx, seq_slices_b64 in enumerate(data["sequences_3d"]):
                    slices_2d = []
                    for slice_idx, slice_b64 in enumerate(seq_slices_b64):
                        slice_bytes = base64.b64decode(slice_b64)
                        slice_2d, dicom = dicom_to_numpy(slice_bytes)
                        slices_2d.append(slice_2d)
                        if seq_idx == 0 and slice_idx == len(seq_slices_b64) // 2:  # 중앙 슬라이스
                            original_dicom = dicom
                    
                    # [D, H, W] 형태로 스택 (D는 전체 슬라이스 수)
                    seq_volume = np.stack(slices_2d, axis=0)
                    sequences_3d.append(seq_volume)
                
                logger.info(f"✅ 3D 볼륨 로드 완료: 4 sequences × {len(seq_slices_b64)} slices")
                
                # 4D 입력 생성: [4, D, H, W] (원본 크기 유지)
                volume_4d = create_4d_input_from_sequences(sequences_3d)
                logger.info(f"✅ 4채널 3D 입력 생성 완료: {volume_4d.shape}")
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
            
            input_tensor = torch.from_numpy(volume_4d).unsqueeze(0).float().to(self.device)
            logger.info(f"📊 Input shape: {input_tensor.shape}")
            
            # Sliding Window Inference로 전체 볼륨 처리
            # 모델은 96×96×96 패치로 학습되었지만, sliding window로 더 큰 볼륨 처리 가능
            with torch.no_grad():
                logger.info(f"🔄 Sliding Window Inference 시작: roi_size=(96, 96, 96), overlap=0.5")
                output = sliding_window_inference(
                    inputs=input_tensor,              # [1, 4, D, H, W] (D는 전체 슬라이스 수)
                    roi_size=(96, 96, 96),            # 모델이 학습한 패치 크기
                    sw_batch_size=1,
                    predictor=self.model,
                    overlap=0.5  # 50% overlap (메모리 절약)
                )
                # output: [1, 1, D, H, W] (out_channels=1이므로)
                pred_prob = torch.sigmoid(output).squeeze(0).squeeze(0).cpu().numpy()  # [D, H, W]
                
                # 임계값 조정 가능 (0.5보다 낮게 설정하면 더 민감하게 검출)
                threshold = 0.5
                pred_mask = (pred_prob > threshold).astype(np.uint8)
                logger.info(f"📊 Output shape: {pred_mask.shape}")
                logger.info(f"📊 모델 출력 통계: min={pred_prob.min():.4f}, max={pred_prob.max():.4f}, mean={pred_prob.mean():.4f}")
                logger.info(f"📊 마스크 통계: 총 픽셀={pred_mask.size}, 종양 픽셀={pred_mask.sum()}, 비율={pred_mask.sum()/pred_mask.size*100:.2f}%")
            
            # 전체 슬라이스 후처리 (원본 크기 유지 또는 리사이즈)
            logger.info(f"📍 {pred_mask.shape[0]}개 슬라이스 전체 후처리 시작")
            from scipy.ndimage import zoom
            
            # 원본 크기 가져오기 (4-channel 모드에서는 original_dicom에서, 단일 이미지 모드에서는 slice_2d에서)
            if original_dicom is not None:
                h = getattr(original_dicom, 'Rows', 256)
                w = getattr(original_dicom, 'Columns', 256)
            elif 'slice_2d' in locals() and slice_2d is not None:
                h, w = slice_2d.shape
            else:
                # 모델 출력 크기 사용
                h, w = pred_mask.shape[1], pred_mask.shape[2]
            
            # 모델 출력 크기 확인
            model_h, model_w = pred_mask.shape[1], pred_mask.shape[2]
            
            # 크기가 다르면 리사이즈, 같으면 그대로 사용
            if h != model_h or w != model_w:
                logger.info(f"📍 원본 크기: {h}×{w}, 모델 출력 크기: {model_h}×{model_w} → 리사이즈 필요")
                zoom_factors = (h / model_h, w / model_w)
            
            mask_resized_3d = []
            for i in range(pred_mask.shape[0]):
                    # 후처리 (경계 정확도 향상)
                    mask_cleaned = postprocess_mask(pred_mask[i, :, :], smooth_boundary=True)
                    # Nearest neighbor로 리사이즈 (경계 보존)
                mask_resized = zoom(mask_cleaned, zoom_factors, order=0)
                    # 리사이즈 후 추가 후처리 (경계 부드럽게)
                    mask_resized = postprocess_mask(mask_resized, smooth_boundary=True)
                mask_resized_3d.append(mask_resized)
            
                mask_resized_3d = np.stack(mask_resized_3d, axis=0)  # [D, H, W]
            else:
                logger.info(f"📍 원본 크기와 모델 출력 크기 동일: {h}×{w} → 리사이즈 불필요")
                # 후처리만 수행 (경계 정확도 향상)
                mask_resized_3d = []
                for i in range(pred_mask.shape[0]):
                    mask_cleaned = postprocess_mask(pred_mask[i, :, :], smooth_boundary=True)
                    mask_resized_3d.append(mask_cleaned)
                
                mask_resized_3d = np.stack(mask_resized_3d, axis=0)  # [D, H, W]
            
            logger.info(f"✅ {mask_resized_3d.shape[0]}개 슬라이스 후처리 완료: {mask_resized_3d.shape}")
            logger.info(f"📊 후처리 후 마스크 통계: min={mask_resized_3d.min()}, max={mask_resized_3d.max()}, 총 픽셀={mask_resized_3d.size}, 종양 픽셀={mask_resized_3d.sum()}")
            
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
                seg_series_uid = data.get('seg_series_uid')
                start_instance_number = data.get('start_instance_number', 1)
                original_series_id = data.get('original_series_id', 'unknown')
                
                dicom_seg = create_dicom_seg_multiframe(original_dicom, mask_resized_3d, seg_series_uid, start_instance_number, original_series_id)
                seg_instance_id = upload_to_orthanc(dicom_seg)
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
