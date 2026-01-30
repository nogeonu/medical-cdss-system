# GCP 서버 최종 설정 가이드 (마지막 단계!)

**작성일**: 2026년 1월  
**상태**: 코드 배포 완료 ✅, GCP 서버 설정만 남음

---

## ✅ 현재 완료된 상태

### 연구실 컴퓨터 ✅
- ✅ HTTP API 워커 실행 중
- ✅ GPU (RTX 3060) 인식 완료
- ✅ Django API 접근 가능

### Django 코드 ✅
- ✅ 조원님 워커 호환용 API 엔드포인트 추가 완료
- ✅ `/api/inference/pending` 엔드포인트 구현 완료
- ✅ `/api/inference/{request_id}/complete` 엔드포인트 구현 완료
- ✅ 코드 커밋 및 푸시 완료 (GitHub 배포 완료)

### 남은 작업 (마지막 단계!)
- ⏳ **GCP 서버에 `USE_LOCAL_INFERENCE=true` 환경 변수 설정**

---

## 🚀 GCP 서버 설정 (3단계만!)

### 1단계: 환경 변수 설정

```bash
# GCP 서버에서 실행
sudo nano /etc/systemd/system/gunicorn.service
```

**`[Service]` 섹션에 추가:**
```ini
[Service]
Environment="USE_LOCAL_INFERENCE=true"
# 기존 다른 환경 변수들도 유지
```

**저장:** `Ctrl+O`, `Enter`, `Ctrl+X`

### 2단계: 재시작

```bash
# 변경 사항 적용
sudo systemctl daemon-reload

# Gunicorn 재시작
sudo systemctl restart gunicorn

# 상태 확인
sudo systemctl status gunicorn
```

**정상 작동 시:**
```
● gunicorn.service - Gunicorn daemon
     Loaded: loaded
     Active: active (running)
```

### 3단계: 테스트

```bash
# API 테스트
curl http://34.42.223.43/api/inference/pending

# 정상 응답:
# {"id": null}  (요청이 없을 때)
```

**환경 변수 확인:**
```bash
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE

# 출력: USE_LOCAL_INFERENCE=true
```

---

## ✅ 설정 완료 확인

### 1. 환경 변수 확인

```bash
# systemd 서비스 환경 변수 확인
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE

# 출력: USE_LOCAL_INFERENCE=true ✅
```

### 2. Django 로그 확인

```bash
# 실시간 로그 확인
sudo journalctl -u gunicorn -f
```

**프론트엔드에서 "AI 분석" 버튼 클릭 시:**

**연구실 컴퓨터 사용 시 (설정 완료):**
```
🏠 연구실 컴퓨터 워커를 통해 추론 요청 생성
✅ 추론 요청 생성: {request_id}.json
⏳ 연구실 컴퓨터 워커가 요청을 처리할 때까지 대기 중...
```

**GCP 서버 사용 시 (설정 안 됨):**
```
☁️ GCP 서버에서 직접 추론 실행
```

### 3. API 테스트

```bash
# 조원님 워커 호환 API 테스트
curl http://34.42.223.43/api/inference/pending

# 정상 응답 (요청이 없을 때):
# {"id": null}

# 정상 응답 (요청이 있을 때):
# {"id": "series_id_timestamp", "series_id": "...", "series_ids": [...]}
```

---

## 🎯 설정 후 전체 동작 흐름

```
[프론트엔드] MRI 자세히보기 페이지
    ↓
[사용자] "AI 분석" 버튼 클릭
    ↓
[프론트엔드] POST /api/mri/segmentation/series/{series_id}/segment/
    Body: { "sequence_series_ids": [id1, id2, id3, id4] }
    ↓
[Django] segment_series() 함수
    ↓
[Django] USE_LOCAL_INFERENCE=true 확인 ✅
    ↓
[Django] request_local_inference() 호출
    ↓
[Django] 요청 파일 생성 (/tmp/mri_inference_requests/{request_id}.json)
    ↓
[연구실 컴퓨터 워커] 30초마다 HTTP API 폴링:
    GET http://34.42.223.43/api/inference/pending
    ↓
[연구실 컴퓨터 워커] 요청 발견 ({"id": "request_id", ...})
    ↓
[연구실 컴퓨터 워커] 추론 실행:
    - Orthanc에서 DICOM 다운로드
    - GPU로 추론 실행 (30-60초)
    - Orthanc에 결과 업로드
    ↓
[연구실 컴퓨터 워커] 결과 업로드:
    POST /api/inference/{request_id}/complete
    ↓
[Django] 완료 확인 → 결과 반환
    ↓
[프론트엔드] 결과 표시 ✅
```

---

## 📋 최종 체크리스트

### 연구실 컴퓨터 (완료 ✅)
- [x] HTTP API 워커 실행 중
- [x] GPU (RTX 3060) 인식 완료
- [x] Django API 접근 가능
- [x] 404 에러 해결됨 (API 엔드포인트 추가)

### Django 코드 (완료 ✅)
- [x] `/api/inference/pending` 엔드포인트 추가
- [x] `/api/inference/{request_id}/complete` 엔드포인트 추가
- [x] 코드 커밋 및 푸시 완료
- [x] GitHub 배포 완료

### GCP 서버 (설정 필요 ⏳)
- [ ] `USE_LOCAL_INFERENCE=true` 환경 변수 설정
- [ ] Gunicorn 재시작 완료
- [ ] 환경 변수 확인 완료
- [ ] API 테스트 완료

### 통합 테스트 (설정 후)
- [ ] 프론트엔드에서 "AI 분석" 버튼 클릭
- [ ] Django 로그에서 "🏠 연구실 컴퓨터 워커를 통해 추론 요청 생성" 확인
- [ ] 연구실 컴퓨터 워커에서 요청 처리 확인
- [ ] 프론트엔드에 결과 표시 확인

---

## 🎉 완료 후

모든 설정이 완료되면:

1. ✅ 프론트엔드에서 "AI 분석" 버튼 클릭
2. ✅ Django가 자동으로 연구실 컴퓨터 요청 생성
3. ✅ 연구실 컴퓨터 워커가 HTTP API로 요청 가져오기
4. ✅ 연구실 컴퓨터에서 추론 실행 (GPU 사용)
5. ✅ 결과를 HTTP API로 업로드
6. ✅ 프론트엔드에 결과 표시

**이제 GCP 서버에 환경 변수만 설정하면 완료입니다!** 🚀

---

## 🔧 문제 해결

### Q1: 환경 변수가 설정되지 않음

**증상:**
```bash
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE
# 출력 없음
```

**해결:**
```bash
# 1. 서비스 파일 확인
sudo nano /etc/systemd/system/gunicorn.service

# 2. [Service] 섹션에 추가 (확인)
Environment="USE_LOCAL_INFERENCE=true"

# 3. 재로드 및 재시작
sudo systemctl daemon-reload
sudo systemctl restart gunicorn

# 4. 다시 확인
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE
```

### Q2: 여전히 GCP에서 실행됨

**증상:**
Django 로그에 `☁️ GCP 서버에서 직접 추론 실행` 메시지

**해결:**
1. 환경 변수 설정 확인
2. Gunicorn 재시작 확인
3. Django 로그 다시 확인

### Q3: API 404 에러

**증상:**
```bash
curl http://34.42.223.43/api/inference/pending
# 404 Not Found
```

**해결:**
1. Django 코드가 최신인지 확인
2. Gunicorn 재시작
3. URL 설정 확인 (`backend/eventeye/urls.py`)

---

**작성일**: 2026년 1월  
**다음 단계**: GCP 서버에서 위의 3단계 실행!
