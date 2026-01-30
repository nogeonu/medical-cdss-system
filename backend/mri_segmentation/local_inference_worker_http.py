"""
연구실 컴퓨터 자동 추론 워커 (HTTP API 버전 - 조원 작업 통합)
GCP Django 서버의 REST API를 폴링하여 추론 요청을 처리합니다.

✅ UTF-8 인코딩 지원 (Windows 호환성)
✅ 기존 Django API와 호환
✅ 조원님의 개선 사항 통합

사용법:
    python local_inference_worker_http.py
    
    # Windows 배치 파일 사용
    start_worker_http.bat
"""
import sys
import os
import time
import logging
import io
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
import requests

# UTF-8 인코딩 지원 (Windows 호환성)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')),
        logging.FileHandler('worker_http.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# 경로 설정
BASE_DIR = Path(__file__).parent
SRC_DIR = BASE_DIR / "src"
sys.path.insert(0, str(SRC_DIR))

# Django API 설정 (기존 API와 호환)
DJANGO_API_URL = os.getenv("DJANGO_API_URL", "http://34.42.223.43/api/mri")
DJANGO_API_AUTH = None  # 필요시 인증 추가

# 폴링 간격 (초)
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# 환경 변수
DEVICE = os.getenv("DEVICE", "cuda")
THRESHOLD = float(os.getenv("THRESHOLD", "0.5"))
REQUEST_TIMEOUT = 30  # HTTP 요청 타임아웃 (초)


def fetch_pending_requests() -> list:
    """
    Django API에서 대기 중인 요청 가져오기 (기존 API 사용)
    
    Returns:
        대기 중인 요청 리스트
    """
    try:
        url = f"{DJANGO_API_URL}/segmentation/pending-requests/"
        response = requests.get(url, timeout=REQUEST_TIMEOUT, auth=DJANGO_API_AUTH)
        response.raise_for_status()
        
        data = response.json()
        if data.get('success'):
            requests_list = data.get('requests', [])
            if requests_list:
                logger.info(f"📋 {len(requests_list)}개 대기 중인 요청 발견")
            return requests_list
        else:
            logger.warning(f"⚠️ API 응답 오류: {data.get('error')}")
            return []
            
    except requests.exceptions.Timeout:
        logger.warning(f"⏱️ 요청 타임아웃 (Django 서버 응답 없음)")
        return []
    except requests.exceptions.ConnectionError:
        logger.error(f"❌ 연결 실패: Django 서버에 접속할 수 없습니다 ({DJANGO_API_URL})")
        return []
    except Exception as e:
        logger.error(f"❌ 요청 확인 중 오류: {str(e)}")
        return []


def update_request_status(request_id: str, status: str, started_at: str = None):
    """
    요청 상태를 Django API로 업데이트 (기존 API 사용)
    
    Args:
        request_id: 요청 ID
        status: 상태 (processing, completed, failed)
        started_at: 시작 시간 (ISO 형식)
    """
    try:
        url = f"{DJANGO_API_URL}/segmentation/update-status/{request_id}/"
        payload = {'status': status}
        if started_at:
            payload['started_at'] = started_at
        
        response = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT, auth=DJANGO_API_AUTH)
        response.raise_for_status()
        
        logger.debug(f"✅ 상태 업데이트 완료: {request_id} → {status}")
        
    except requests.exceptions.Timeout:
        logger.warning(f"⏱️ 상태 업데이트 타임아웃: {request_id}")
    except requests.exceptions.ConnectionError:
        logger.error(f"❌ 연결 실패: 상태를 업데이트할 수 없습니다")
    except Exception as e:
        logger.warning(f"⚠️ 상태 업데이트 실패: {request_id} - {str(e)}")


def complete_request(request_id: str, result: Dict[str, Any]):
    """
    추론 완료 결과를 Django API로 업로드 (기존 API 사용)
    
    Args:
        request_id: 요청 ID
        result: 추론 결과 딕셔너리
    """
    try:
        url = f"{DJANGO_API_URL}/segmentation/complete-request/{request_id}/"
        
        payload = {
            'success': result.get('success', False),
            'seg_instance_id': result.get('seg_instance_id'),
            'tumor_detected': result.get('tumor_detected'),
            'tumor_volume_voxels': result.get('tumor_volume_voxels'),
            'elapsed_time_seconds': result.get('elapsed_time_seconds'),
            'error': result.get('error')
        }
        
        response = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT, auth=DJANGO_API_AUTH)
        response.raise_for_status()
        
        logger.info(f"✅ 결과 업로드 완료: {request_id}")
        
    except requests.exceptions.Timeout:
        logger.error(f"⏱️ 결과 업로드 타임아웃: {request_id}")
        raise
    except requests.exceptions.ConnectionError:
        logger.error(f"❌ 연결 실패: 결과를 전송할 수 없습니다")
        raise
    except Exception as e:
        logger.error(f"❌ 결과 업로드 중 오류: {str(e)}")
        raise


def process_request(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    추론 요청 처리
    
    Args:
        request_data: 요청 데이터 딕셔너리
    
    Returns:
        처리 결과 딕셔너리
    """
    request_id = request_data.get('request_id')
    series_ids = request_data.get('series_ids', [])
    
    try:
        logger.info(f"📋 요청 처리 시작: {request_id}")
        logger.info(f"   - 요청 시간: {request_data.get('requested_at')}")
        logger.info(f"   - 시리즈 개수: {len(series_ids)}")
        
        # 상태를 'processing'으로 변경
        started_at = datetime.now().isoformat()
        update_request_status(request_id, 'processing', started_at)
        
        # 추론 실행
        start_time = time.time()
        from local_inference import run_inference_local
        
        result = run_inference_local(
            series_ids=series_ids,
            device=DEVICE,
            threshold=THRESHOLD
        )
        
        # 처리 시간 추가
        elapsed_time = time.time() - start_time
        result['elapsed_time_seconds'] = elapsed_time
        
        # 결과 업로드
        complete_request(request_id, result)
        
        if result.get('success'):
            logger.info(f"✅ 요청 처리 완료: {request_id}")
            logger.info(f"   - Instance ID: {result.get('seg_instance_id')}")
            logger.info(f"   - 소요 시간: {elapsed_time:.2f}초")
            logger.info(f"   - 종양 탐지: {result.get('tumor_detected')}")
            logger.info(f"   - 종양 볼륨: {result.get('tumor_volume_voxels')} voxels")
        else:
            logger.error(f"❌ 요청 처리 실패: {request_id}")
            logger.error(f"   - 오류: {result.get('error')}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ 요청 처리 중 예외 발생: {str(e)}", exc_info=True)
        
        # 오류 상태 업로드
        try:
            error_result = {
                'success': False,
                'error': str(e),
                'seg_instance_id': None,
                'tumor_detected': False,
                'tumor_volume_voxels': 0,
                'elapsed_time_seconds': 0
            }
            complete_request(request_id, error_result)
        except:
            pass
        
        return {'success': False, 'error': str(e)}


def main():
    """메인 워커 루프"""
    logger.info("="*60)
    logger.info("🚀 MRI 세그멘테이션 HTTP API 워커 시작")
    logger.info("="*60)
    logger.info(f"🌐 Django API URL: {DJANGO_API_URL}")
    logger.info(f"⏱️ 폴링 간격: {POLL_INTERVAL}초")
    logger.info(f"🖥️ 디바이스: {DEVICE}")
    logger.info(f"📊 임계값: {THRESHOLD}")
    logger.info("="*60)
    logger.info("✅ 공유 디렉토리 불필요!")
    logger.info("✅ 연구실 내부 IP 불필요!")
    logger.info("✅ 인터넷 연결만 있으면 됩니다!")
    logger.info("="*60)
    
    # GPU 사용 가능 여부 확인
    try:
        import torch
        if DEVICE == "cuda" and torch.cuda.is_available():
            logger.info(f"✅ GPU 사용 가능: {torch.cuda.get_device_name(0)}")
        elif DEVICE == "cuda" and not torch.cuda.is_available():
            logger.warning("⚠️ GPU 요청되었으나 사용 불가, CPU 모드로 전환됩니다.")
        else:
            logger.info("ℹ️ CPU 모드로 실행")
    except ImportError:
        logger.warning("⚠️ PyTorch가 설치되지 않았습니다.")
    
    # Django API 연결 테스트
    logger.info("\n🔍 Django API 연결 테스트...")
    try:
        test_requests = fetch_pending_requests()
        logger.info(f"✅ Django API 연결 성공! (대기 중인 요청: {len(test_requests)}개)")
    except Exception as e:
        logger.error(f"❌ Django API 연결 실패: {str(e)}")
        logger.error("⚠️ Django 서버가 실행 중인지, 네트워크 연결이 정상인지 확인하세요.")
        logger.error(f"   API URL: {DJANGO_API_URL}")
        sys.exit(1)
    
    logger.info("\n💡 워커가 실행 중입니다. 종료하려면 Ctrl+C를 누르세요.\n")
    
    processed_count = 0
    consecutive_errors = 0
    max_consecutive_errors = 5
    
    try:
        while True:
            try:
                # Django API에서 대기 중인 요청 가져오기
                pending_requests = fetch_pending_requests()
                
                if pending_requests:
                    for request_data in pending_requests:
                        result = process_request(request_data)
                        
                        if result.get('success'):
                            processed_count += 1
                            consecutive_errors = 0  # 성공 시 에러 카운터 리셋
                else:
                    # 요청이 없으면 조용히 대기
                    if processed_count % 20 == 0:  # 20번마다 한 번만 로그
                        logger.debug("⏳ 대기 중인 요청 없음...")
                
            except Exception as e:
                consecutive_errors += 1
                logger.error(f"❌ 요청 처리 중 오류: {str(e)}", exc_info=True)
                
                if consecutive_errors >= max_consecutive_errors:
                    logger.error(f"❌ 연속 {max_consecutive_errors}회 오류 발생. 워커 종료.")
                    sys.exit(1)
            
            # 다음 폴링까지 대기
            time.sleep(POLL_INTERVAL)
            
    except KeyboardInterrupt:
        logger.info("\n\n⏹️ 워커 종료 요청 받음")
        logger.info(f"📊 총 처리된 요청: {processed_count}개")
        logger.info("👋 워커 종료")
        sys.exit(0)
    except Exception as e:
        logger.error(f"❌ 워커 오류: {str(e)}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
