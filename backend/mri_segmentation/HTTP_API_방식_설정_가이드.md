# HTTP API 방식 설정 가이드 (권장)

## ✅ 완료: HTTP API 방식으로 변경됨!

**이제 공유 디렉토리나 연구실 내부 IP가 필요 없습니다!**

연구실 컴퓨터가 인터넷을 통해 GCP Django 서버에 접근 가능하면 바로 사용할 수 있습니다.

---

## 🎯 동작 방식

### 전체 흐름

```
1. [프론트엔드] "AI 분석" 버튼 클릭
   ↓
2. [Django] /api/mri/segmentation/series/{series_id}/segment/ API 호출
   ↓
3. [Django] USE_LOCAL_INFERENCE=true 확인
   ↓
4. [Django] 요청을 DB/파일 시스템에 저장 (pending 상태)
   ↓
5. [연구실 컴퓨터 워커] 30초마다 HTTP API 폴링:
   GET http://34.42.223.43/api/mri/segmentation/pending-requests/
   ↓
6. [연구실 컴퓨터 워커] 요청 발견 → 자동 처리
   ↓
7. [연구실 컴퓨터 워커] 상태 업데이트:
   POST http://34.42.223.43/api/mri/segmentation/update-status/{request_id}/
   ↓
8. [연구실 컴퓨터 워커] Orthanc에서 DICOM 다운로드 → 추론 → 업로드
   ↓
9. [연구실 컴퓨터 워커] 결과 업로드:
   POST http://34.42.223.43/api/mri/segmentation/complete-request/{request_id}/
   ↓
10. [Django] 완료 확인 → 결과 반환
   ↓
11. [프론트엔드] 결과 표시
```

---

## 🚀 설정 방법

### 1단계: 연구실 컴퓨터 환경 설정

```bash
cd ~/연구실_컴퓨터_추론_패키지/mri_segmentation

# 환경 변수 설정
cp env.example .env
nano .env
```

**.env 파일 내용:**
```bash
# Django API 설정 (중요!)
DJANGO_API_URL=http://34.42.223.43/api/mri

# Orthanc 서버 설정
ORTHANC_URL=http://34.42.223.43:8042
ORTHANC_USER=admin
ORTHANC_PASSWORD=admin123

# 모델 파일 경로
MODEL_PATH=src/best_model.pth

# 추론 설정
DEVICE=cuda  # 또는 cpu
THRESHOLD=0.5

# 워커 설정
POLL_INTERVAL=30  # Django API 폴링 간격 (초)
```

### 2단계: 워커 실행

```bash
# 가상환경 활성화
source venv/bin/activate

# 워커 실행 (백그라운드)
nohup python local_inference_worker.py > worker.log 2>&1 &

# 또는 systemd 서비스 (권장)
sudo systemctl start mri-inference-worker
```

### 3단계: GCP Django 서버 설정

```bash
# 환경 변수 설정
export USE_LOCAL_INFERENCE=true

# Django 재시작
sudo systemctl restart gunicorn
```

---

## ✅ 장점

### 1. 공유 디렉토리 불필요
- ❌ NFS 마운트 불필요
- ❌ 공유 스토리지 불필요
- ❌ 파일 시스템 동기화 문제 없음

### 2. 연구실 내부 IP 불필요
- ❌ VPN 설정 불필요
- ❌ 방화벽 규칙 복잡하게 설정 불필요
- ✅ 인터넷 연결만 있으면 됨

### 3. 간단한 설정
- ✅ Django API URL만 설정하면 됨
- ✅ 추가 인프라 불필요 (Redis 등)
- ✅ 즉시 사용 가능

---

## 🔍 확인 방법

### 워커 실행 확인

```bash
# 프로세스 확인
ps aux | grep local_inference_worker

# 로그 확인
tail -f worker.log

# Django API 연결 테스트
curl http://34.42.223.43/api/mri/segmentation/pending-requests/
```

### 요청 처리 확인

```bash
# 워커 로그에서 확인
tail -f worker.log | grep "요청 처리"

# Django API로 확인
curl http://34.42.223.43/api/mri/segmentation/requests/
```

---

## 🔧 문제 해결

### Q1: Django API 연결 실패

**증상:**
```
❌ Django API 연결 실패: Connection refused
```

**해결:**
```bash
# 1. Django 서버 상태 확인
curl http://34.42.223.43/api/mri/segmentation/pending-requests/

# 2. 네트워크 연결 확인
ping 34.42.223.43

# 3. 방화벽 확인 (GCP 콘솔)
# 포트 80 (HTTP) 허용 확인

# 4. DJANGO_API_URL 확인
echo $DJANGO_API_URL
```

### Q2: 요청을 가져오지 못함

**확인:**
```bash
# Django API 직접 호출 테스트
curl http://34.42.223.43/api/mri/segmentation/pending-requests/

# 정상 응답 예시:
# {
#   "success": true,
#   "count": 0,
#   "requests": []
# }
```

### Q3: 결과 업로드 실패

**확인:**
```bash
# 워커 로그 확인
tail -f worker.log | grep "결과 업로드"

# Django 로그 확인
sudo journalctl -u gunicorn -f
```

---

## 📊 성능

### 처리 시간

| 단계 | 시간 |
|------|------|
| 요청 생성 | 즉시 |
| 워커 감지 | 최대 30초 (폴링 간격) |
| DICOM 다운로드 | 2-5분 |
| 추론 실행 | 30-60초 (GPU) / 10-20분 (CPU) |
| Orthanc 업로드 | 2-3초 |
| 결과 업로드 | 즉시 |
| **총 소요 시간** | **약 3-7분 (GPU)** |

### 네트워크 사용량

- **요청 가져오기**: ~1KB (JSON)
- **상태 업데이트**: ~500 bytes
- **결과 업로드**: ~1KB (JSON)
- **총 네트워크**: 매우 적음 (JSON만)

---

## 💡 팁

### 1. 폴링 간격 조정

```bash
# 더 빠른 감지 (더 많은 네트워크 사용)
POLL_INTERVAL=10

# 더 느린 감지 (네트워크 절약)
POLL_INTERVAL=60
```

### 2. 여러 워커 실행

여러 연구실 컴퓨터에서 동시에 워커를 실행하면 자동으로 분산 처리됩니다:

```bash
# 연구실 컴퓨터 1
python local_inference_worker.py

# 연구실 컴퓨터 2 (같은 설정)
python local_inference_worker.py
```

### 3. 모니터링

```bash
# 실시간 로그
tail -f worker.log

# Django API로 요청 상태 확인
watch -n 5 'curl -s http://34.42.223.43/api/mri/segmentation/requests/ | jq'
```

---

## 🎉 완료!

이제 **프론트엔드에서 "AI 분석" 버튼을 누르면:**

1. ✅ Django가 자동으로 연구실 컴퓨터 요청 생성
2. ✅ 워커가 HTTP API로 요청 가져오기
3. ✅ 자동으로 추론 실행
4. ✅ 결과를 HTTP API로 업로드
5. ✅ 프론트엔드에 결과 표시

**공유 디렉토리나 연구실 내부 IP 없이 작동합니다!** 🚀

---

**작성일**: 2026년 1월
**버전**: 2.0.0 (HTTP API 방식)
