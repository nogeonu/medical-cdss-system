# 연구실 컴퓨터 추론 시스템 - 완전 가이드

## 📋 시스템 개요

이 시스템은 **연구실 컴퓨터**에서 MRI 세그멘테이션 추론을 실행하고, 결과를 **Orthanc (GCP)**에 자동으로 업로드하는 구조입니다.

### 장점
- ✅ GCP 서버 리소스 절약 (CPU/메모리)
- ✅ 연구실 GPU 활용 (빠른 추론 속도)
- ✅ GCP 비용 절감
- ✅ 기존 Django 코드 변경 최소화

---

## 🚀 설치 및 설정

### 1단계: 저장소 클론 및 환경 설정

```bash
# 1. 저장소 클론 (연구실 컴퓨터)
cd ~
git clone https://github.com/your-repo/Django-React.git
cd Django-React/backend/mri_segmentation

# 2. Python 가상환경 생성
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 또는
venv\Scripts\activate  # Windows

# 3. 의존성 설치
pip install -r src/requirements.txt

# 4. GPU 버전 PyTorch 설치 (NVIDIA GPU가 있는 경우)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 2단계: 모델 파일 다운로드

```bash
# GCP 서버에서 모델 파일 복사
scp user@34.42.223.43:/srv/django-react/app/backend/mri_segmentation/src/best_model.pth src/

# 또는 다른 위치에서 복사
# 모델 파일 크기: 약 500MB-1GB
```

### 3단계: 환경 변수 설정

```bash
# env.example을 .env로 복사
cp env.example .env

# .env 파일 수정
nano .env
```

**.env 파일 내용:**
```bash
# Orthanc 서버 설정
ORTHANC_URL=http://34.42.223.43:8042
ORTHANC_USER=admin
ORTHANC_PASSWORD=your-actual-password

# 모델 파일 경로
MODEL_PATH=src/best_model.pth

# 추론 설정
DEVICE=cuda  # 또는 cpu
THRESHOLD=0.5

# 워커 설정 (자동 모드용)
REQUEST_DIR=/tmp/mri_inference_requests
POLL_INTERVAL=30
```

### 4단계: 네트워크 접근 확인

```bash
# Orthanc 서버 접근 테스트
curl -u admin:your-password http://34.42.223.43:8042/system

# 정상 응답 예시:
# {
#   "Name": "Orthanc",
#   "Version": "1.11.0",
#   ...
# }
```

---

## 💻 사용 방법

### 방법 1: 수동 실행 (간단)

```bash
# 1. Orthanc Web UI에서 시리즈 ID 확인
# http://34.42.223.43:8042 접속

# 2. 추론 실행
python local_inference.py \
    --series-ids \
    "series-id-1" \
    "series-id-2" \
    "series-id-3" \
    "series-id-4"

# GPU 모드 (권장)
python local_inference.py \
    --series-ids \
    "series-id-1" \
    "series-id-2" \
    "series-id-3" \
    "series-id-4" \
    --device cuda

# 임계값 조정
python local_inference.py \
    --series-ids \
    "series-id-1" \
    "series-id-2" \
    "series-id-3" \
    "series-id-4" \
    --threshold 0.7
```

### 방법 2: 자동 워커 실행 (권장)

워커가 자동으로 요청을 감지하고 처리합니다.

#### 2-1. 포그라운드 실행 (테스트용)
```bash
python local_inference_worker.py
```

#### 2-2. 백그라운드 실행
```bash
# Linux/Mac
nohup python local_inference_worker.py > worker.log 2>&1 &

# 프로세스 확인
ps aux | grep local_inference_worker

# 중지
pkill -f local_inference_worker
```

#### 2-3. systemd 서비스 실행 (프로덕션 권장)

```bash
# 1. 서비스 파일 수정
sudo nano systemd/mri-inference-worker.service

# User, WorkingDirectory, ExecStart 경로를 실제 환경에 맞게 수정
# User=your-username
# WorkingDirectory=/home/your-username/Django-React/backend/mri_segmentation
# ExecStart=/home/your-username/Django-React/backend/mri_segmentation/venv/bin/python local_inference_worker.py

# 2. 서비스 파일 복사
sudo cp systemd/mri-inference-worker.service /etc/systemd/system/

# 3. 서비스 활성화 및 시작
sudo systemctl daemon-reload
sudo systemctl enable mri-inference-worker
sudo systemctl start mri-inference-worker

# 4. 상태 확인
sudo systemctl status mri-inference-worker

# 5. 로그 확인
sudo journalctl -u mri-inference-worker -f

# 6. 재시작 (필요시)
sudo systemctl restart mri-inference-worker
```

---

## 🔗 Django 연동

### Django에서 추론 요청 생성

**backend/mri_viewer/segmentation_views.py**에 다음 코드 추가:

```python
import json
from pathlib import Path
from django.utils import timezone

REQUEST_DIR = Path('/tmp/mri_inference_requests')

@api_view(['POST'])
def request_local_inference(request, series_id):
    """
    연구실 컴퓨터에서 추론 실행 요청
    """
    sequence_series_ids = request.data.get("sequence_series_ids", [])
    
    if len(sequence_series_ids) != 4:
        return Response({
            'success': False,
            'error': '4개 시리즈가 필요합니다.'
        }, status=400)
    
    # 요청 파일 생성
    REQUEST_DIR.mkdir(exist_ok=True, parents=True)
    
    request_data = {
        'series_ids': sequence_series_ids,
        'series_id': series_id,
        'requested_at': timezone.now().isoformat(),
        'status': 'pending',
        'requested_by': request.user.username if request.user.is_authenticated else 'anonymous'
    }
    
    request_file = REQUEST_DIR / f"{series_id}_{int(timezone.now().timestamp())}.json"
    with open(request_file, 'w', encoding='utf-8') as f:
        json.dump(request_data, f, indent=2, ensure_ascii=False)
    
    logger.info(f"✅ 추론 요청 생성: {request_file.name}")
    
    return Response({
        'success': True,
        'message': '추론 요청이 큐에 추가되었습니다.',
        'request_id': request_file.stem,
        'series_id': series_id
    })


@api_view(['GET'])
def check_inference_status(request, request_id):
    """
    추론 요청 상태 확인
    """
    request_files = list(REQUEST_DIR.glob(f"{request_id}.json"))
    
    if not request_files:
        return Response({
            'success': False,
            'error': '요청을 찾을 수 없습니다.'
        }, status=404)
    
    with open(request_files[0], 'r', encoding='utf-8') as f:
        request_data = json.load(f)
    
    return Response({
        'success': True,
        'status': request_data.get('status'),
        'requested_at': request_data.get('requested_at'),
        'started_at': request_data.get('started_at'),
        'completed_at': request_data.get('completed_at'),
        'result': request_data.get('result')
    })
```

**urls.py에 추가:**
```python
path('segmentation/request-local/<str:series_id>/', segmentation_views.request_local_inference),
path('segmentation/status/<str:request_id>/', segmentation_views.check_inference_status),
```

---

## 📊 성능 및 모니터링

### 성능 비교

| 환경 | 디바이스 | 추론 시간 | 비용 |
|------|---------|----------|------|
| 연구실 (RTX 4090) | GPU | ~20초 | 무료 |
| 연구실 (RTX 3090) | GPU | ~30초 | 무료 |
| 연구실 (i9 CPU) | CPU | ~15분 | 무료 |
| GCP (4 vCPU) | CPU | ~20분 | 유료 |

### 로그 모니터링

```bash
# 워커 로그 확인 (systemd)
sudo journalctl -u mri-inference-worker -f

# 워커 로그 확인 (파일)
tail -f worker.log

# 최근 100줄 확인
tail -n 100 worker.log
```

### GPU 사용률 모니터링

```bash
# NVIDIA GPU 사용률 확인
watch -n 1 nvidia-smi

# 또는 간단히
nvidia-smi
```

---

## 🔧 문제 해결

### Q1: 워커가 요청을 처리하지 않음
**확인 사항:**
1. 워커가 실행 중인지 확인
   ```bash
   ps aux | grep local_inference_worker
   # 또는
   sudo systemctl status mri-inference-worker
   ```

2. 요청 파일이 생성되었는지 확인
   ```bash
   ls -lh /tmp/mri_inference_requests/
   ```

3. 로그 확인
   ```bash
   tail -f worker.log
   ```

### Q2: Orthanc 연결 실패
**해결:**
```bash
# 1. 네트워크 연결 확인
ping 34.42.223.43

# 2. Orthanc 서버 상태 확인
curl http://34.42.223.43:8042/system

# 3. 인증 정보 확인
curl -u admin:your-password http://34.42.223.43:8042/system
```

### Q3: GPU 메모리 부족
**해결:**
```bash
# 1. GPU 사용률 확인
nvidia-smi

# 2. 다른 프로세스 종료
kill -9 <PID>

# 3. CPU 모드로 전환
# .env 파일 수정: DEVICE=cpu
```

### Q4: 모델 파일 없음
**해결:**
```bash
# GCP 서버에서 모델 파일 복사
scp user@34.42.223.43:/srv/django-react/app/backend/mri_segmentation/src/best_model.pth src/

# 또는 다른 위치에서 복사
# 모델 파일 위치 확인
find ~ -name "best_model.pth"
```

---

## 🔒 보안 권장사항

1. **인증 정보 보호**
   ```bash
   # .env 파일 권한 설정
   chmod 600 .env
   
   # .gitignore에 추가
   echo ".env" >> .gitignore
   ```

2. **방화벽 설정**
   - GCP 콘솔에서 연구실 컴퓨터 IP만 허용
   - Orthanc 포트 (8042) 접근 제한

3. **HTTPS 사용 (권장)**
   - Orthanc에 SSL 인증서 설정
   - `ORTHANC_URL=https://34.42.223.43:8042`

---

## 📝 체크리스트

### 초기 설정
- [ ] Python 환경 설정 완료
- [ ] 의존성 설치 완료
- [ ] 모델 파일 다운로드 완료
- [ ] .env 파일 설정 완료
- [ ] Orthanc 접근 테스트 성공

### 수동 실행
- [ ] 시리즈 ID 확인
- [ ] 추론 실행 성공
- [ ] Orthanc 업로드 성공
- [ ] GCP Django에서 결과 확인

### 자동 워커
- [ ] 워커 실행 성공
- [ ] systemd 서비스 등록 완료
- [ ] 로그 모니터링 설정 완료
- [ ] Django 연동 완료

---

## 📞 지원 및 문의

문제가 발생하면:
1. 로그 확인 (`worker.log`, `journalctl`)
2. 네트워크 연결 확인
3. GPU 상태 확인 (`nvidia-smi`)
4. 문서 재확인

---

**작성일**: 2026년 1월
**작성자**: AI Assistant
**버전**: 1.0.0
