"""
연구실 컴퓨터에서 실행하는 MRI 세그멘테이션 추론 스크립트
Orthanc에서 DICOM 다운로드 → 추론 → Orthanc에 업로드

사용법:
    python local_inference.py --series-ids series1 series2 series3 series4
    
    또는
    
    python local_inference.py --series-ids series1 series2 series3 series4 --device cuda
"""
import sys
import os
from pathlib import Path
import tempfile
import shutil
import requests
import logging
import argparse
from typing import List, Dict, Any

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 경로 설정
BASE_DIR = Path(__file__).parent
SRC_DIR = BASE_DIR / "src"
sys.path.insert(0, str(SRC_DIR))

# 환경 변수 또는 기본값
ORTHANC_URL = os.getenv("ORTHANC_URL", "http://34.42.223.43:8042")
ORTHANC_USER = os.getenv("ORTHANC_USER", "admin")
ORTHANC_PASSWORD = os.getenv("ORTHANC_PASSWORD", "admin123")
MODEL_PATH = os.getenv("MODEL_PATH", str(SRC_DIR / "best_model.pth"))

# GPU 확인
try:
    import torch
    GPU_AVAILABLE = torch.cuda.is_available()
    if GPU_AVAILABLE:
        logger.info(f"✅ GPU 사용 가능: {torch.cuda.get_device_name(0)}")
    else:
        logger.info("ℹ️ GPU 사용 불가, CPU 모드로 실행")
except ImportError:
    logger.warning("⚠️ PyTorch가 설치되지 않았습니다.")
    GPU_AVAILABLE = False


class OrthancClient:
    """Orthanc REST API 클라이언트"""
    
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip('/')
        self.auth = (username, password) if username and password else None
    
    def get_series_info(self, series_id: str) -> Dict[str, Any]:
        """시리즈 상세 정보"""
        response = requests.get(f"{self.base_url}/series/{series_id}", auth=self.auth)
        response.raise_for_status()
        return response.json()
    
    def get_instance_file(self, instance_id: str) -> bytes:
        """Instance DICOM 파일"""
        response = requests.get(f"{self.base_url}/instances/{instance_id}/file", auth=self.auth)
        response.raise_for_status()
        return response.content
    
    def upload_dicom(self, dicom_data: bytes) -> Dict[str, Any]:
        """DICOM 파일 업로드"""
        response = requests.post(
            f"{self.base_url}/instances",
            data=dicom_data,
            headers={'Content-Type': 'application/dicom'},
            auth=self.auth
        )
        response.raise_for_status()
        return response.json()


def download_dicom_series(orthanc_client: OrthancClient, series_ids: List[str]) -> str:
    """
    Orthanc에서 4개 시리즈의 DICOM 파일 다운로드
    
    Args:
        orthanc_client: OrthancClient 인스턴스
        series_ids: 4개 시리즈 ID 리스트
    
    Returns:
        temp_dir: 임시 디렉토리 경로 (seq_0, seq_1, seq_2, seq_3 폴더 포함)
    """
    temp_dir = tempfile.mkdtemp(prefix="mri_seg_local_")
    logger.info(f"📂 임시 디렉토리 생성: {temp_dir}")
    
    try:
        for seq_idx, series_id in enumerate(series_ids):
            # 시리즈 정보 가져오기
            logger.info(f"🔍 시리즈 {seq_idx+1}/4: {series_id}")
            series_info = orthanc_client.get_series_info(series_id)
            instance_ids = series_info.get("Instances", [])
            
            if len(instance_ids) == 0:
                raise ValueError(f"시리즈 {series_id}에 인스턴스가 없습니다.")
            
            # 시퀀스별 디렉토리 생성
            seq_dir = Path(temp_dir) / f"seq_{seq_idx:02d}"
            seq_dir.mkdir(parents=True, exist_ok=True)
            
            # 각 인스턴스의 DICOM 파일 다운로드
            logger.info(f"📥 다운로드 중: {len(instance_ids)}개 슬라이스...")
            for inst_idx, instance_id in enumerate(instance_ids):
                dicom_bytes = orthanc_client.get_instance_file(instance_id)
                dicom_path = seq_dir / f"slice_{inst_idx:04d}.dcm"
                with open(dicom_path, 'wb') as f:
                    f.write(dicom_bytes)
                
                # 진행률 표시 (20개마다)
                if (inst_idx + 1) % 20 == 0 or (inst_idx + 1) == len(instance_ids):
                    logger.info(f"  → {inst_idx+1}/{len(instance_ids)} 완료")
            
            logger.info(f"✅ 시퀀스 {seq_idx+1}/4 다운로드 완료: {len(instance_ids)}개 슬라이스")
        
        return temp_dir
        
    except Exception as e:
        # 오류 발생 시 임시 디렉토리 삭제
        if temp_dir and Path(temp_dir).exists():
            shutil.rmtree(temp_dir)
        raise e


def run_inference_local(series_ids: List[str], device: str = "cpu", threshold: float = 0.5) -> Dict[str, Any]:
    """
    연구실 컴퓨터에서 추론 실행
    
    Args:
        series_ids: 4개 시리즈 ID 리스트
        device: 'cuda' 또는 'cpu'
        threshold: 세그멘테이션 임계값 (기본: 0.5)
    
    Returns:
        결과 딕셔너리 (seg_instance_id, tumor_detected, tumor_volume_voxels 포함)
    """
    temp_dir = None
    
    try:
        # 1. 시리즈 개수 확인
        if len(series_ids) != 4:
            raise ValueError(f"4개 시리즈가 필요합니다. 현재: {len(series_ids)}개")
        
        logger.info("="*60)
        logger.info("🚀 MRI 세그멘테이션 추론 시작 (연구실 컴퓨터)")
        logger.info("="*60)
        logger.info(f"📍 시리즈 개수: {len(series_ids)}")
        logger.info(f"🖥️ 디바이스: {device}")
        logger.info(f"📊 임계값: {threshold}")
        logger.info(f"🔗 Orthanc URL: {ORTHANC_URL}")
        logger.info("="*60)
        
        # 2. Orthanc 클라이언트 초기화
        logger.info("\n[1/5] Orthanc 클라이언트 초기화...")
        orthanc_client = OrthancClient(
            base_url=ORTHANC_URL,
            username=ORTHANC_USER,
            password=ORTHANC_PASSWORD
        )
        
        # 3. Orthanc에서 DICOM 다운로드
        logger.info("\n[2/5] Orthanc에서 DICOM 다운로드...")
        temp_dir = download_dicom_series(orthanc_client, series_ids)
        
        # 4. 추론 파이프라인 로드
        logger.info("\n[3/5] 추론 파이프라인 로드...")
        from inference_pipeline import SegmentationInferencePipeline
        
        if not Path(MODEL_PATH).exists():
            raise FileNotFoundError(f"모델 파일을 찾을 수 없습니다: {MODEL_PATH}")
        
        pipeline = SegmentationInferencePipeline(
            model_path=MODEL_PATH,
            device=device,
            threshold=threshold
        )
        logger.info(f"✅ 모델 로드 완료: {MODEL_PATH}")
        
        # 5. 추론 실행
        logger.info("\n[4/5] 세그멘테이션 추론 실행...")
        logger.info("⏳ 이 작업은 GPU에서 약 30-60초, CPU에서 10-20분 소요될 수 있습니다...")
        
        seg_dicom_path = Path(temp_dir) / "segmentation.dcm"
        
        import time
        start_time = time.time()
        
        result = pipeline.predict(
            image_path=temp_dir,  # 4개 seq_XX 폴더가 있는 루트 폴더
            output_path=str(seg_dicom_path),
            output_format="dicom"
        )
        
        elapsed_time = time.time() - start_time
        logger.info(f"✅ 추론 완료 ({elapsed_time:.2f}초)")
        logger.info(f"   - 종양 검출: {result['tumor_detected']}")
        logger.info(f"   - 종양 볼륨: {result['tumor_volume_voxels']} voxels")
        
        # 6. DICOM SEG를 Orthanc에 업로드
        logger.info("\n[5/5] Orthanc에 결과 업로드...")
        
        if not seg_dicom_path.exists():
            raise FileNotFoundError("세그멘테이션 결과 파일(DICOM SEG)이 생성되지 않았습니다.")
        
        with open(seg_dicom_path, 'rb') as f:
            seg_dicom_bytes = f.read()
        
        file_size_mb = len(seg_dicom_bytes) / 1024 / 1024
        logger.info(f"📦 업로드 파일 크기: {file_size_mb:.2f} MB")
        
        upload_result = orthanc_client.upload_dicom(seg_dicom_bytes)
        seg_instance_id = upload_result.get('ID')
        
        logger.info(f"✅ Orthanc 업로드 완료!")
        logger.info(f"   - Instance ID: {seg_instance_id}")
        
        # 7. 최종 결과 반환
        logger.info("\n" + "="*60)
        logger.info("🎉 추론 완료!")
        logger.info("="*60)
        
        return {
            'success': True,
            'seg_instance_id': seg_instance_id,
            'tumor_detected': result['tumor_detected'],
            'tumor_volume_voxels': result['tumor_volume_voxels'],
            'elapsed_time_seconds': elapsed_time
        }
        
    except Exception as e:
        logger.error(f"\n❌ 추론 실패: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': str(e)
        }
        
    finally:
        # 임시 파일 정리
        if temp_dir and Path(temp_dir).exists():
            try:
                shutil.rmtree(temp_dir)
                logger.info("\n🧹 임시 파일 정리 완료")
            except Exception as cleanup_error:
                logger.warning(f"⚠️ 임시 파일 정리 중 오류: {cleanup_error}")


def main():
    """메인 함수"""
    parser = argparse.ArgumentParser(
        description="연구실 컴퓨터에서 MRI 세그멘테이션 추론 실행",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  # CPU 모드 (기본)
  python local_inference.py --series-ids series1 series2 series3 series4
  
  # GPU 모드
  python local_inference.py --series-ids series1 series2 series3 series4 --device cuda
  
  # 임계값 조정
  python local_inference.py --series-ids series1 series2 series3 series4 --threshold 0.7
  
환경 변수:
  ORTHANC_URL       Orthanc 서버 URL (기본: http://34.42.223.43:8042)
  ORTHANC_USER      Orthanc 사용자명 (기본: admin)
  ORTHANC_PASSWORD  Orthanc 비밀번호 (기본: admin123)
  MODEL_PATH        모델 파일 경로 (기본: src/best_model.pth)
        """
    )
    
    parser.add_argument(
        "--series-ids",
        nargs=4,
        required=True,
        metavar=("SEQ0", "SEQ1", "SEQ2", "SEQ3"),
        help="4개 시리즈 ID (공백으로 구분)"
    )
    
    parser.add_argument(
        "--device",
        choices=["cuda", "cpu"],
        default="cuda" if GPU_AVAILABLE else "cpu",
        help=f"추론 디바이스 (기본: {'cuda' if GPU_AVAILABLE else 'cpu'})"
    )
    
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.5,
        help="세그멘테이션 임계값 (기본: 0.5)"
    )
    
    args = parser.parse_args()
    
    # 추론 실행
    result = run_inference_local(
        series_ids=args.series_ids,
        device=args.device,
        threshold=args.threshold
    )
    
    # 결과 출력
    print("\n" + "="*60)
    print("📊 최종 결과")
    print("="*60)
    if result['success']:
        print(f"✅ 성공!")
        print(f"   - Orthanc Instance ID: {result['seg_instance_id']}")
        print(f"   - 종양 검출: {result['tumor_detected']}")
        print(f"   - 종양 볼륨: {result['tumor_volume_voxels']} voxels")
        print(f"   - 소요 시간: {result['elapsed_time_seconds']:.2f}초")
        print("\n💡 GCP Django에서 결과를 확인할 수 있습니다.")
        sys.exit(0)
    else:
        print(f"❌ 실패: {result['error']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
