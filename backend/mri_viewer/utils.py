import os
import numpy as np
import nibabel as nib
from pathlib import Path
import base64
from io import BytesIO
from PIL import Image
import pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import generate_uid
from datetime import datetime
import uuid
import logging

logger = logging.getLogger(__name__)


def load_nifti_file(file_path):
    """NIfTI 파일을 로드하고 numpy 배열로 반환"""
    try:
        nii_img = nib.load(file_path)
        data = nii_img.get_fdata()
        return data, nii_img.affine, nii_img.header
    except Exception as e:
        raise Exception(f"NIfTI 파일 로드 실패: {str(e)}")


def normalize_slice(slice_data):
    """슬라이스 데이터를 0-255 범위로 정규화"""
    if slice_data.max() > slice_data.min():
        normalized = (slice_data - slice_data.min()) / (slice_data.max() - slice_data.min())
        return (normalized * 255).astype(np.uint8)
    return slice_data.astype(np.uint8)


def get_slice_from_volume(volume, slice_idx, axis='axial'):
    """
    3D 볼륨에서 특정 슬라이스 추출
    axis: 'axial' (z축), 'sagittal' (x축), 'coronal' (y축)
    """
    if axis == 'axial':
        slice_data = volume[:, :, slice_idx]
    elif axis == 'sagittal':
        slice_data = volume[slice_idx, :, :]
    elif axis == 'coronal':
        slice_data = volume[:, slice_idx, :]
    else:
        raise ValueError(f"Invalid axis: {axis}")
    
    return slice_data


def create_overlay(image_slice, segmentation_slice, alpha=0.5):
    """
    이미지 슬라이스와 세그멘테이션을 오버레이
    """
    # 이미지를 RGB로 변환
    image_rgb = np.stack([image_slice] * 3, axis=-1)
    
    # 세그멘테이션을 컬러맵으로 변환 (빨간색)
    overlay = image_rgb.copy()
    mask = segmentation_slice > 0
    overlay[mask, 0] = np.minimum(255, overlay[mask, 0] + 100)  # 빨간색 채널 증가
    
    # 알파 블렌딩
    result = (1 - alpha) * image_rgb + alpha * overlay
    return result.astype(np.uint8)


def numpy_to_base64(array):
    """numpy 배열을 base64 인코딩된 PNG 이미지로 변환"""
    img = Image.fromarray(array)
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    img_str = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{img_str}"


def get_patient_mri_data(patient_id, data_root="/Users/nogeon-u/Desktop/건양대_바이오메디컬/Django/mmm"):
    """
    환자의 MRI 데이터 경로 및 정보 반환
    """
    data_root = Path(data_root)
    
    # 이미지 파일들 찾기
    image_dir = data_root / "images" / patient_id.upper()
    if not image_dir.exists():
        raise FileNotFoundError(f"환자 데이터를 찾을 수 없습니다: {patient_id}")
    
    # NIfTI 파일들 수집
    image_files = sorted(list(image_dir.glob("*.nii.gz")))
    
    # 세그멘테이션 파일 찾기
    seg_auto = data_root / "segmentations" / "automatic" / f"{patient_id.lower()}.nii.gz"
    seg_expert = data_root / "segmentations" / "expert" / f"{patient_id.lower()}.nii.gz"
    
    # 환자 정보 파일
    patient_info_file = data_root / "patient_info_files" / f"{patient_id.lower()}.json"
    
    return {
        'image_files': [str(f) for f in image_files],
        'segmentation_auto': str(seg_auto) if seg_auto.exists() else None,
        'segmentation_expert': str(seg_expert) if seg_expert.exists() else None,
        'patient_info_file': str(patient_info_file) if patient_info_file.exists() else None,
    }


def load_mri_series(image_files):
    """
    여러 MRI 시퀀스 파일들을 로드
    """
    series_data = []
    for file_path in image_files:
        data, affine, header = load_nifti_file(file_path)
        series_data.append({
            'data': data,
            'affine': affine,
            'header': header,
            'filename': os.path.basename(file_path),
            'shape': data.shape
        })
    return series_data


def nifti_to_dicom_slices(nifti_file, patient_id=None, patient_name=None, birth_date=None, gender=None, accession_number=None, referring_physician=None, image_type=None, orthanc_client=None):
    """
    NIfTI 파일을 DICOM 슬라이스들로 변환
    
    Args:
        nifti_file: 파일 경로(str/Path) 또는 파일 객체(BytesIO 등)
        patient_id: 환자 ID (선택사항)
        patient_name: 환자 이름 (선택사항)
        birth_date: 환자 생년월일 (YYYYMMDD 형식 문자열 또는 date 객체)
        gender: 환자 성별 ('M', 'F', 'O')
        accession_number: Accession Number
        referring_physician: 의뢰 의사 이름
        image_type: 영상 유형 ('유방촬영술 영상', '병리 영상', 'MRI 영상') - Study/Series 구분용
    
    Returns:
        List[bytes]: DICOM 인스턴스들의 바이트 데이터 리스트
    """
    import tempfile
    import os
    import logging
    from datetime import date
    
    logger = logging.getLogger(__name__)
    
    if hasattr(nifti_file, 'read'):
        if hasattr(nifti_file, 'seek'):
            nifti_file.seek(0)
        file_data = nifti_file.read()
        if len(file_data) == 0:
            raise ValueError("NIfTI file data is empty")
        
        file_suffix = '.nii.gz'
        if hasattr(nifti_file, 'name') and nifti_file.name:
            if nifti_file.name.endswith('.nii.gz'):
                file_suffix = '.nii.gz'
            elif nifti_file.name.endswith('.nii'):
                file_suffix = '.nii'
        
        temp_dir = tempfile.gettempdir()
        tmp_file_path = os.path.join(temp_dir, f"nifti_{uuid.uuid4().hex}{file_suffix}")
        
        try:
            with open(tmp_file_path, 'wb') as tmp_file:
                tmp_file.write(file_data)
                tmp_file.flush()
            nii_img = nib.load(tmp_file_path)
            volume = nii_img.get_fdata()
            header = nii_img.header
            affine = nii_img.affine
        finally:
            if tmp_file_path and os.path.exists(tmp_file_path):
                try:
                    os.unlink(tmp_file_path)
                except:
                    pass
    elif isinstance(nifti_file, (str, Path)):
        nii_img = nib.load(str(nifti_file))
        volume = nii_img.get_fdata()
        header = nii_img.header
        affine = nii_img.affine
    else:
        raise ValueError(f"Unsupported nifti_file type: {type(nifti_file)}")
    
    if patient_id is None:
        patient_id = "UNKNOWN"
    if patient_name is None:
        patient_name = patient_id
    
    dicom_gender = ""
    if gender:
        if gender.upper() in ['M', 'MALE', '남', '남성']:
            dicom_gender = 'M'
        elif gender.upper() in ['F', 'FEMALE', '여', '여성']:
            dicom_gender = 'F'
        elif gender.upper() in ['O', 'OTHER', '기타']:
            dicom_gender = 'O'
    
    dicom_birth_date = ""
    if birth_date:
        if isinstance(birth_date, (date, datetime)):
            dicom_birth_date = birth_date.strftime("%Y%m%d")
        elif isinstance(birth_date, str):
            dicom_birth_date = birth_date.replace("-", "").replace(".", "").replace("/", "")[:8]
    
    image_type_map = {
        '유방촬영술 영상': {
            'study_description': '유방촬영술',
            'series_description': 'Mammography Series',
            'modality': 'MG',
            'sop_class_uid': '1.2.840.10008.5.1.4.1.1.1.2'
        },
        '병리 영상': {
            'study_description': '병리 영상',
            'series_description': 'Pathology Series',
            'modality': 'SM',
            'sop_class_uid': '1.2.840.10008.5.1.4.1.1.77.1.6'
        },
        'MRI 영상': {
            'study_description': 'MRI Study',
            'series_description': 'MRI Series',
            'modality': 'MR',
            'sop_class_uid': '1.2.840.10008.5.1.4.1.1.4'
        }
    }
    settings = image_type_map.get(image_type, image_type_map['MRI 영상'])
    
    study_instance_uid = None
    if orthanc_client is not None and patient_id:
        try:
            study_instance_uid = orthanc_client.get_existing_study_instance_uid(patient_id)
        except:
            pass
    if study_instance_uid is None:
        study_instance_uid = generate_uid()
    
    series_instance_uid = generate_uid()
    frame_of_reference_uid = generate_uid()
    
    series_number = 1
    if orthanc_client is not None and study_instance_uid:
        try:
            series_number = orthanc_client.get_next_series_number(study_instance_uid)
        except:
            pass
    
    if not accession_number:
        accession_number = str(uuid.uuid4())[:8].upper()

    if len(volume.shape) == 2:
        volume = volume[:, :, np.newaxis]
        num_slices = 1
    elif len(volume.shape) == 3:
        num_slices = volume.shape[2]
    elif len(volume.shape) == 4:
        num_slices = volume.shape[2]
        volume = volume[:, :, :, 0]
    else:
        raise ValueError(f"Unsupported volume shape: {volume.shape}")
    
    dicom_slices = []
    now = datetime.now()
    
    for slice_idx in range(num_slices):
        slice_data = volume[:, :, slice_idx]
        if slice_data.dtype != np.uint16 and slice_data.dtype != np.int16:
            min_val = slice_data.min()
            max_val = slice_data.max()
            if max_val > 32767:
                slice_data = np.clip(slice_data, -1024, 3071).astype(np.int16)
            else:
                slice_data = slice_data.astype(np.int16)
        
        ds = Dataset()
        ds.SpecificCharacterSet = 'ISO_IR 192'
        ds.PatientID = str(patient_id)
        ds.PatientName = str(patient_name)
        ds.PatientBirthDate = dicom_birth_date
        ds.PatientSex = dicom_gender
        ds.StudyInstanceUID = study_instance_uid
        ds.StudyDate = now.strftime("%Y%m%d")
        ds.StudyTime = now.strftime("%H%M%S")
        ds.StudyID = accession_number[:8]
        ds.StudyDescription = settings['study_description']
        ds.AccessionNumber = accession_number
        ds.ReferringPhysicianName = str(referring_physician or "")
        ds.SeriesInstanceUID = series_instance_uid
        ds.SeriesNumber = str(series_number)
        ds.SeriesDescription = settings['series_description']
        ds.Modality = settings['modality']
        ds.InstanceNumber = str(slice_idx + 1)
        ds.SOPInstanceUID = generate_uid()
        ds.SOPClassUID = settings['sop_class_uid']
        ds.Manufacturer = "Konyang Univ Biomedical"
        ds.ManufacturerModelName = "NII-to-DICOM Converter"
        ds.InstitutionName = "GYU Hospital"
        ds.Rows = slice_data.shape[0]
        ds.Columns = slice_data.shape[1]
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 1 if slice_data.dtype == np.int16 else 0
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        
        try:
            if affine is not None and affine.shape == (4, 4):
                px_x = float(np.sqrt(affine[0, 0]**2 + affine[1, 0]**2 + affine[2, 0]**2))
                px_y = float(np.sqrt(affine[0, 1]**2 + affine[1, 1]**2 + affine[2, 1]**2))
                ds.PixelSpacing = [str(px_y), str(px_x)]
                thick = float(np.sqrt(affine[0, 2]**2 + affine[1, 2]**2 + affine[2, 2]**2))
                ds.SliceThickness = str(thick)
                col_dir = affine[:3, 0] / (px_x if px_x > 0 else 1.0)
                row_dir = affine[:3, 1] / (px_y if px_y > 0 else 1.0)
                ds.ImageOrientationPatient = [
                    str(float(col_dir[0])), str(float(col_dir[1])), str(float(col_dir[2])),
                    str(float(row_dir[0])), str(float(row_dir[1])), str(float(row_dir[2]))
                ]
                pos = affine @ np.array([0, 0, slice_idx, 1])
                ds.ImagePositionPatient = [str(float(pos[0])), str(float(pos[1])), str(float(pos[2]))]
                ds.SliceLocation = str(float(pos[2]))
            else:
                ds.PixelSpacing = ["1.0", "1.0"]
                ds.SliceThickness = "1.0"
                ds.ImageOrientationPatient = ["1", "0", "0", "0", "1", "0"]
                ds.ImagePositionPatient = ["0", "0", str(float(slice_idx))]
                ds.SliceLocation = str(float(slice_idx))
        except:
            ds.PixelSpacing = ["1.0", "1.0"]
            ds.SliceThickness = "1.0"
            ds.ImageOrientationPatient = ["1", "0", "0", "0", "1", "0"]
            ds.ImagePositionPatient = ["0", "0", str(float(slice_idx))]
            ds.SliceLocation = str(float(slice_idx))
            
        ds.FrameOfReferenceUID = frame_of_reference_uid
        ds.PixelData = slice_data.tobytes()
        
        buffer = BytesIO()
        file_meta = Dataset()
        file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
        file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
        file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9"
        file_meta.TransferSyntaxUID = '1.2.840.10008.1.2.1'
        ds.file_meta = file_meta
        ds.is_implicit_VR = False
        ds.is_little_endian = True
        pydicom.dcmwrite(buffer, ds, write_like_original=False)
        dicom_slices.append(buffer.getvalue())
    
    return dicom_slices

def pil_image_to_dicom(pil_image, patient_id=None, patient_name=None, birth_date=None, gender=None, accession_number=None, series_description="Heatmap Image", modality="MG", orthanc_client=None, study_instance_uid=None):
    """
    PIL Image를 DICOM으로 변환
    
    Args:
        pil_image: PIL Image 객체
        patient_id: 환자 ID
        patient_name: 환자 이름
        birth_date: 환자 생년월일
        gender: 환자 성별
        accession_number: Accession Number
        series_description: Series 설명
        modality: Modality (기본값: MG - Mammography)
        orthanc_client: OrthancClient 인스턴스 (기존 Study 찾기용, 선택사항)
        study_instance_uid: 기존 StudyInstanceUID (제공되면 재사용)
    
    Returns:
        bytes: DICOM 파일의 바이트 데이터
    """
    import numpy as np
    from datetime import date
    
    # PIL Image를 numpy 배열로 변환 (컬러 이미지 유지)
    is_color = pil_image.mode in ('RGB', 'RGBA')
    
    if pil_image.mode == 'RGBA':
        # RGBA를 RGB로 변환 (알파 채널 제거)
        pil_image = pil_image.convert('RGB')
        img_array = np.array(pil_image)
    elif pil_image.mode == 'RGB':
        # RGB 이미지는 그대로 유지
        img_array = np.array(pil_image)
    else:
        # 그레이스케일 이미지
        img_array = np.array(pil_image)
        if len(img_array.shape) == 2:
            # 2D 그레이스케일을 3D로 확장 (H, W) -> (H, W, 1)
            img_array = img_array[:, :, np.newaxis]
    
    # SM 모달리티(병리 이미지)는 uint8 사용, 다른 모달리티는 uint16 사용
    if modality == "SM":
        # SM 모달리티: RGB 이미지를 uint8로 유지 (병리 이미지는 컬러 정보가 중요)
        if is_color and len(img_array.shape) == 3 and img_array.shape[2] == 3:
            # RGB 이미지를 uint8로 유지
            if img_array.dtype != np.uint8:
                img_array = img_array.astype(np.uint8)
        else:
            # 그레이스케일 이미지 처리
            if len(img_array.shape) == 3:
                img_array = img_array[:, :, 0]  # 첫 번째 채널만 사용
            if img_array.dtype != np.uint8:
                img_array = img_array.astype(np.uint8)
    else:
        # 다른 모달리티: uint16 사용
        if is_color and len(img_array.shape) == 3 and img_array.shape[2] == 3:
            # RGB 이미지를 uint16으로 변환 (각 채널별로)
            if img_array.dtype != np.uint16:
                # 0-65535 범위로 스케일링 (각 채널별)
                if img_array.max() > 0:
                    img_array = (img_array.astype(np.float32) / 255.0 * 65535).astype(np.uint16)
                else:
                    img_array = img_array.astype(np.uint16)
        else:
            # 그레이스케일 이미지 처리
            if len(img_array.shape) == 3:
                img_array = img_array[:, :, 0]  # 첫 번째 채널만 사용
            
            # uint16으로 변환
            if img_array.dtype != np.uint16:
                if img_array.max() > 0:
                    img_array = (img_array.astype(np.float32) / img_array.max() * 65535).astype(np.uint16)
                else:
                    img_array = img_array.astype(np.uint16)
    
    # 환자 정보 설정
    if patient_id is None:
        patient_id = "UNKNOWN"
    if patient_name is None:
        patient_name = patient_id
    
    # 기존 Study 찾기 (같은 환자의 기존 Study에 속하도록)
    if study_instance_uid is None and orthanc_client is not None and patient_id:
        try:
            existing_uid = orthanc_client.get_existing_study_instance_uid(patient_id)
            if existing_uid:
                study_instance_uid = existing_uid
                logger.info(f"기존 StudyInstanceUID 재사용: {study_instance_uid[:20]}... (patient_id: {patient_id})")
        except Exception as e:
            logger.warning(f"기존 StudyInstanceUID 찾기 실패, 새로 생성: {e}")
    
    # Study 정보
    if study_instance_uid is None:
        study_instance_uid = generate_uid()
        logger.info(f"새 StudyInstanceUID 생성: {study_instance_uid[:20]}... (patient_id: {patient_id})")
    
    # DICOM 데이터셋 생성
    ds = Dataset()
    
    # 한글 지원을 위한 문자셋 설정 (PatientName에 한글이 포함될 수 있음)
    ds.SpecificCharacterSet = 'ISO_IR 192'  # UTF-8
    
    # 필수 DICOM 태그
    ds.PatientID = str(patient_id)
    ds.PatientName = str(patient_name)
    ds.PatientBirthDate = ""
    ds.PatientSex = ""
    
    # Study 정보
    ds.StudyInstanceUID = study_instance_uid
    ds.StudyDate = datetime.now().strftime("%Y%m%d")
    ds.StudyTime = datetime.now().strftime("%H%M%S")
    ds.StudyID = str(uuid.uuid4())[:8]
    # Modality에 따라 StudyDescription 설정
    if modality == "SM":
        ds.StudyDescription = "Pathology Analysis"
    else:
        ds.StudyDescription = "Mammography Analysis"
    ds.AccessionNumber = ""  # Accession Number
    ds.ReferringPhysicianName = ""  # Referring Physician Name
    
    # Series 정보
    ds.SeriesInstanceUID = generate_uid()
    ds.SeriesNumber = "1"
    ds.SeriesDescription = series_description
    ds.Modality = modality
    
    # Instance 정보
    ds.InstanceNumber = "1"
    ds.SOPInstanceUID = generate_uid()
    # Modality에 따라 SOPClassUID 설정
    if modality == "SM":
        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.77.1.6"  # VL Whole Slide Microscopy Image Storage
    else:
        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.1.2"  # Digital Mammography X-Ray Image Storage
    
    # 이미지 파라미터 (SM 모달리티는 uint8, 다른 모달리티는 uint16)
    ds.Rows = img_array.shape[0]
    ds.Columns = img_array.shape[1]
    
    if modality == "SM":
        # SM 모달리티: uint8 사용
        ds.BitsAllocated = 8
        ds.BitsStored = 8
        ds.HighBit = 7
        ds.PixelRepresentation = 0  # Unsigned
        
        # 컬러 이미지인 경우 RGB 설정
        if is_color and len(img_array.shape) == 3 and img_array.shape[2] == 3:
            ds.SamplesPerPixel = 3
            ds.PhotometricInterpretation = "RGB"
            ds.PlanarConfiguration = 0  # 0 = interleaved (RGBRGBRGB...)
            # 픽셀 데이터를 interleaved 형식으로 변환 (R, G, B 순서)
            h, w = img_array.shape[:2]
            pixel_data = img_array.reshape(h * w, 3).astype(np.uint8)
            pixel_data = pixel_data.tobytes()
            logger.info(f"✅ SM 모달리티 RGB 컬러 이미지 처리: shape={img_array.shape}, pixel_data size={len(pixel_data)} bytes")
        else:
            ds.SamplesPerPixel = 1
            ds.PhotometricInterpretation = "MONOCHROME2"
            if len(img_array.shape) == 3:
                img_array = img_array[:, :, 0]
            pixel_data = img_array.astype(np.uint8).tobytes()
            logger.info(f"✅ SM 모달리티 그레이스케일 이미지 처리: shape={img_array.shape}, pixel_data size={len(pixel_data)} bytes")
    else:
        # 다른 모달리티: uint16 사용
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0  # Unsigned
        
        # 컬러 이미지인 경우 RGB 설정
        if is_color and len(img_array.shape) == 3 and img_array.shape[2] == 3:
            ds.SamplesPerPixel = 3
            ds.PhotometricInterpretation = "RGB"
            ds.PlanarConfiguration = 0  # 0 = interleaved (RGBRGBRGB...)
            # 픽셀 데이터를 interleaved 형식으로 변환 (R, G, B 순서)
            h, w = img_array.shape[:2]
            pixel_data = img_array.reshape(h * w, 3).astype(np.uint16)
            pixel_data = pixel_data.tobytes()
            logger.info(f"✅ RGB 컬러 이미지 처리: shape={img_array.shape}, pixel_data size={len(pixel_data)} bytes")
        else:
            ds.SamplesPerPixel = 1
            ds.PhotometricInterpretation = "MONOCHROME2"
            # 그레이스케일 이미지
            if len(img_array.shape) == 3:
                img_array = img_array[:, :, 0]
            pixel_data = img_array.astype(np.uint16).tobytes()
            logger.info(f"✅ 그레이스케일 이미지 처리: shape={img_array.shape}, pixel_data size={len(pixel_data)} bytes")
    
    # 픽셀 데이터
    ds.PixelData = pixel_data
    
    # 파일로 저장 (메모리)
    buffer = BytesIO()
    
    # DICOM File Meta Information 설정
    file_meta = Dataset()
    file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9"
    file_meta.TransferSyntaxUID = '1.2.840.10008.1.2.1'  # Explicit VR Little Endian
    
    ds.file_meta = file_meta
    ds.is_implicit_VR = False
    ds.is_little_endian = True
    
    pydicom.dcmwrite(buffer, ds, write_like_original=False)
    return buffer.getvalue()

