# GCP 서버 HTTP API 방식 설정 가이드

**작성일**: 2026년 1월  
**상태**: 연구실 컴퓨터 HTTP API 방식 설정 완료 ✅

---

## ✅ 현재 상태

### 연구실 컴퓨터 (완료)
- ✅ HTTP API 방식으로 설정 완료
- ✅ `local_inference_worker_http.py` 실행 중
- ✅ Django API 폴링 중 (`/api/mri/segmentation/pending-requests/`)

### GCP 서버 (설정 필요)
- ⏳ 환경 변수 `USE_LOCAL_INFERENCE=true` 설정
- ⏳ Gunicorn 재시작

---

## 🚀 GCP 서버 설정 (간단 2단계)

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

### 2단계: 재시작

```bash
# 변경 사항 적용
sudo systemctl daemon-reload

# Gunicorn 재시작
sudo systemctl restart gunicorn

# 상태 확인
sudo systemctl status gunicorn
```

---

## ✅ 설정 확인

### 1. 환경 변수 확인

```bash
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE
# 출력: USE_LOCAL_INFERENCE=true
```

### 2. Django API 엔드포인트 확인

```bash
# 대기 중인 요청 조회 API 테스트
curl http://localhost/api/mri/segmentation/pending-requests/

# 정상 응답:
# {"success": true, "count": 0, "requests": []}
```

### 3. Django 로그 확인

```bash
# 실시간 로그 확인
sudo journalctl -u gunicorn -f
```

---

## 🔄 전체 동작 흐름 (HTTP API 방식)

```
[프론트엔드] "AI 분석" 버튼 클릭
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
[Django] 요청 파일 생성 (/tmp/mri_inference_requests/*.json)
    ↓
[연구실 컴퓨터 워커] 30초마다 HTTP API 폴링:
    GET http://34.42.223.43/api/mri/segmentation/pending-requests/
    ↓
[연구실 컴퓨터 워커] 요청 발견
    ↓
[연구실 컴퓨터 워커] 상태 업데이트:
    POST /api/mri/segmentation/update-status/{request_id}/
    ↓
[연구실 컴퓨터 워커] 추론 실행:
    - Orthanc에서 DICOM 다운로드
    - 추론 실행 (GPU: 30-60초)
    - Orthanc에 결과 업로드
    ↓
[연구실 컴퓨터 워커] 결과 업로드:
    POST /api/mri/segmentation/complete-request/{request_id}/
    ↓
[Django] 완료 확인 → 결과 반환
    ↓
[프론트엔드] 결과 표시 ✅
```

---

## 🎯 테스트 방법

### 1. 프론트엔드에서 테스트

1. MRI 뷰어 페이지 접속
2. "AI 분석" 버튼 클릭
3. Django 로그에서 다음 메시지 확인:

```
🏠 연구실 컴퓨터 워커를 통해 추론 요청 생성
✅ 추론 요청 생성: {request_id}.json
```

### 2. 연구실 컴퓨터 워커 로그 확인

연구실 컴퓨터에서 워커 로그를 확인하면:

```
📋 {N}개 대기 중인 요청 발견
📋 요청 처리 시작: {request_id}
🔄 추론 시작...
✅ 추론 완료
✅ 결과 업로드 완료: {request_id}
```

---

## ✅ HTTP API 방식의 장점

1. **공유 디렉토리 불필요**
   - NFS, SMB 등 네트워크 공유 스토리지 불필요
   - 파일 시스템 공유 설정 불필요

2. **연구실 내부 IP 불필요**
   - 인터넷 연결만 있으면 됨
   - 방화벽 설정 간단

3. **설정 간단**
   - GCP 서버: 환경 변수만 설정
   - 연구실 컴퓨터: 워커만 실행

4. **모니터링 쉬움**
   - Django API로 요청 상태 확인 가능
   - 로그 확인 용이

---

## 📋 체크리스트

### GCP 서버 설정
- [ ] `USE_LOCAL_INFERENCE=true` 환경 변수 설정
- [ ] Gunicorn 재시작 완료
- [ ] 환경 변수 확인
- [ ] Django API 엔드포인트 테스트

### 연구실 컴퓨터 (이미 완료)
- [x] HTTP API 방식 워커 실행 중
- [x] Django API 접근 가능
- [x] GPU 인식 완료

### 통합 테스트
- [ ] 프론트엔드에서 "AI 분석" 버튼 클릭
- [ ] Django 로그에서 "🏠 연구실 컴퓨터 워커를 통해 추론 요청 생성" 확인
- [ ] 연구실 컴퓨터 워커에서 요청 처리 확인
- [ ] 프론트엔드에 결과 표시 확인

---

## 🔧 문제 해결

### Q1: 여전히 GCP에서 실행됨

**원인**: 환경 변수가 설정되지 않았거나 Gunicorn이 재시작되지 않음

**해결**:
```bash
# 환경 변수 확인
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE

# 없으면 다시 설정
sudo nano /etc/systemd/system/gunicorn.service
# Environment="USE_LOCAL_INFERENCE=true" 추가

# 재로드 및 재시작
sudo systemctl daemon-reload
sudo systemctl restart gunicorn
```

### Q2: 워커가 요청을 받지 못함

**원인**: Django API에 접근 불가 또는 워커가 실행되지 않음

**해결**:
```bash
# Django API 테스트
curl http://34.42.223.43/api/mri/segmentation/pending-requests/

# 연구실 컴퓨터에서 워커 실행 확인
ps aux | grep local_inference_worker_http

# 워커 로그 확인
tail -f worker_http.log
```

### Q3: API 응답 오류

**원인**: Django API 엔드포인트가 제대로 구현되지 않음

**해결**:
```bash
# URL 설정 확인
cat backend/mri_viewer/urls.py | grep pending-requests

# Django 서버 재시작
sudo systemctl restart gunicorn
```

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

**작성일**: 2026년 1월
