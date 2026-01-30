# GCP 서버 설정 가이드 (연구실 컴퓨터 연동)

**작성일**: 2026년 1월  
**상태**: 연구실 컴퓨터 워커 실행 완료 ✅

---

## ✅ 현재 상태

### 연구실 컴퓨터 (완료)
- ✅ 워커 실행 중
- ✅ GPU (RTX 3060) 인식 완료
- ✅ 요청 디렉토리: `/tmp/mri_inference_requests`
- ✅ 폴링 간격: 30초
- ✅ CUDA 디바이스 사용

### GCP 서버 (설정 필요)
- ⏳ 환경 변수 `USE_LOCAL_INFERENCE=true` 설정
- ⏳ Gunicorn 재시작

---

## 🚀 GCP 서버 설정 방법

### 방법 1: systemd 서비스 파일 수정 (권장)

```bash
# 1. Gunicorn 서비스 파일 편집
sudo nano /etc/systemd/system/gunicorn.service

# 2. [Service] 섹션에 환경 변수 추가
[Service]
Environment="USE_LOCAL_INFERENCE=true"
# 기존 다른 환경 변수들도 유지

# 3. 변경 사항 저장 후 재로드
sudo systemctl daemon-reload

# 4. Gunicorn 재시작
sudo systemctl restart gunicorn

# 5. 상태 확인
sudo systemctl status gunicorn
```

### 방법 2: .env 파일 사용

```bash
# 1. Django 프로젝트 디렉토리로 이동
cd /srv/django-react/app

# 2. .env 파일에 추가 (또는 생성)
echo "USE_LOCAL_INFERENCE=true" >> .env

# 3. Django settings.py에서 .env 파일 로드 확인
# (보통 python-decouple 또는 django-environ 사용)

# 4. Gunicorn 재시작
sudo systemctl restart gunicorn
```

### 방법 3: 환경 변수 직접 설정 (임시)

```bash
# 현재 세션에서만 유효 (재부팅 시 사라짐)
export USE_LOCAL_INFERENCE=true
sudo systemctl restart gunicorn
```

---

## 🔍 설정 확인 방법

### 1. 환경 변수 확인

```bash
# systemd 서비스 환경 변수 확인
sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE

# 또는 Django shell에서 확인
cd /srv/django-react/app
python manage.py shell
>>> import os
>>> os.getenv('USE_LOCAL_INFERENCE')
'true'  # 이렇게 나와야 함
```

### 2. Django 로그 확인

```bash
# Gunicorn 로그 실시간 확인
sudo journalctl -u gunicorn -f

# 또는 Django 로그 파일 확인
tail -f /srv/django-react/app/logs/django.log
```

### 3. API 테스트

```bash
# 대기 중인 요청 조회 API 테스트
curl http://localhost/api/mri/segmentation/pending-requests/

# 정상 응답:
# {"success": true, "count": 0, "requests": []}
```

---

## 🎯 설정 후 동작 확인

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
✅ 결과 업로드 완료
```

---

## ⚠️ 주의사항

### 1. 요청 디렉토리 확인

연구실 컴퓨터 워커가 `/tmp/mri_inference_requests`를 사용하고 있으므로, GCP 서버도 같은 경로를 사용해야 합니다.

**GCP 서버에서:**

```bash
# 요청 디렉토리 생성
sudo mkdir -p /tmp/mri_inference_requests
sudo chmod 777 /tmp/mri_inference_requests

# 또는 Django 코드에서 자동 생성되도록 설정됨
```

### 2. HTTP API 방식 vs 파일 시스템 방식

현재 연구실 컴퓨터 워커가 파일 시스템 기반(`/tmp/mri_inference_requests`)을 사용하고 있다면:

- ✅ **파일 시스템 방식**: GCP와 연구실 컴퓨터가 같은 디렉토리를 공유해야 함 (NFS 등)
- ✅ **HTTP API 방식**: 공유 디렉토리 불필요, 인터넷 연결만 필요

**현재 워커 로그를 보면 파일 시스템 방식을 사용 중인 것 같습니다.**

---

## 🔄 두 가지 옵션

### 옵션 1: 파일 시스템 방식 (현재 워커 사용)

**장점:**
- 연구실 컴퓨터 워커 그대로 사용 가능
- 추가 수정 불필요

**단점:**
- GCP와 연구실 컴퓨터가 같은 디렉토리 공유 필요
- NFS 또는 공유 스토리지 필요

**설정:**
```bash
# GCP 서버에서
export USE_LOCAL_INFERENCE=true
sudo systemctl restart gunicorn
```

### 옵션 2: HTTP API 방식 (권장)

**장점:**
- 공유 디렉토리 불필요
- 연구실 내부 IP 불필요
- 인터넷 연결만 있으면 됨

**단점:**
- 연구실 컴퓨터 워커를 `local_inference_worker_http.py`로 변경 필요

**설정:**
```bash
# GCP 서버에서
export USE_LOCAL_INFERENCE=true
sudo systemctl restart gunicorn

# 연구실 컴퓨터에서
# local_inference_worker.py 대신
python local_inference_worker_http.py
```

---

## 📋 체크리스트

### GCP 서버 설정
- [ ] `USE_LOCAL_INFERENCE=true` 환경 변수 설정
- [ ] Gunicorn 재시작 완료
- [ ] 환경 변수 확인 (`sudo systemctl show gunicorn | grep USE_LOCAL_INFERENCE`)
- [ ] Django 로그 확인 (정상 작동 확인)

### 테스트
- [ ] 프론트엔드에서 "AI 분석" 버튼 클릭
- [ ] Django 로그에서 "🏠 연구실 컴퓨터 워커를 통해 추론 요청 생성" 메시지 확인
- [ ] 연구실 컴퓨터 워커에서 요청 처리 확인
- [ ] 프론트엔드에 결과 표시 확인

---

## 🎉 완료 후

모든 설정이 완료되면:

1. ✅ 프론트엔드에서 "AI 분석" 버튼 클릭
2. ✅ Django가 자동으로 연구실 컴퓨터 요청 생성
3. ✅ 연구실 컴퓨터 워커가 자동으로 처리
4. ✅ 결과가 Orthanc에 업로드
5. ✅ 프론트엔드에 결과 표시

**이제 GCP 서버 설정만 하면 완료입니다!** 🚀

---

**작성일**: 2026년 1월
