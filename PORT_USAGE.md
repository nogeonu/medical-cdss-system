# GCP 서버 포트 사용 현황

**서버 IP**: 34.42.223.43  
**서버 사용자**: shrjsdn908  
**확인 일시**: 2026-01-23

---

## 📋 실행 중인 포트 목록

### 웹 서버 및 애플리케이션

| 포트 | 서비스 | 바인딩 | 용도 | 상태 |
|------|--------|--------|------|------|
| **80** | Nginx | 0.0.0.0 | HTTP 웹 서버 (프론트엔드 + API 프록시) | ✅ 실행 중 |
| **8000** | Daphne (ASGI) | 127.0.0.1 | Django 메인 애플리케이션 서버 (WebSocket 지원) | ✅ 실행 중 |
| **8001** | Gunicorn | 0.0.0.0 | 챗봇 서버 (chat_django) | ✅ 실행 중 |
| **8002** | Uvicorn | 0.0.0.0 | ASGI 서버 (WebSocket 지원) | ✅ 실행 중 |

### AI 추론 서비스 (Mosec)

| 포트 | 서비스 | 바인딩 | 용도 | 상태 |
|------|--------|--------|------|------|
| **5006** | Mosec | 0.0.0.0 | MRI 세그멘테이션 추론 서비스 | ✅ 실행 중 |
| **5007** | Mosec | 0.0.0.0 | 맘모그래피 AI 분석 서비스 | ✅ 실행 중 |
| **5008** | Mosec | 0.0.0.0 | 병리 이미지 분류 서비스 | ✅ 실행 중 |

### 데이터베이스 및 캐시

| 포트 | 서비스 | 바인딩 | 용도 | 상태 |
|------|--------|--------|------|------|
| **3306** | MySQL | 0.0.0.0 | 메인 데이터베이스 | ✅ 실행 중 |
| **33060** | MySQL | 127.0.0.1 | MySQL X Protocol | ✅ 실행 중 |
| **6379** | Redis | 127.0.0.1 | 캐시 및 채팅 세션 관리 | ✅ 실행 중 |

### 의료 영상 서버 (PACS)

| 포트 | 서비스 | 바인딩 | 용도 | 상태 |
|------|--------|--------|------|------|
| **4242** | Orthanc (Docker) | 0.0.0.0 | DICOM 서버 (외부 접근) | ✅ 실행 중 |
| **8042** | Orthanc (Docker) | 0.0.0.0 | Orthanc 웹 UI | ✅ 실행 중 |

### 시스템 서비스

| 포트 | 서비스 | 바인딩 | 용도 | 상태 |
|------|--------|--------|------|------|
| **22** | SSH | 0.0.0.0 | 원격 접속 | ✅ 실행 중 |
| **53** | systemd-resolve | 127.0.0.53 | DNS 해석 | ✅ 실행 중 |
| **20201** | otelopscol | * | OpenTelemetry 수집기 | ✅ 실행 중 |
| **20202** | fluent-bit | 0.0.0.0 | 로그 수집 | ✅ 실행 중 |

### 기타

| 포트 | 서비스 | 바인딩 | 용도 | 상태 |
|------|--------|--------|------|------|
| **5002** | Python | 0.0.0.0 | 미확인 서비스 (추정: 다른 AI 서비스) | ⚠️ 확인 필요 |
| **42971** | containerd | 127.0.0.1 | Docker 컨테이너 관리 | ✅ 실행 중 |

---

## 🔧 서비스 상세 정보

### 1. Nginx (포트 80)
- **역할**: 리버스 프록시 및 정적 파일 서빙
- **프록시 대상**:
  - `/api/` → `http://127.0.0.1:8000` (Django 메인)
  - `/orthanc/` → `http://localhost:8042/` (Orthanc PACS)
- **정적 파일**: `/srv/django-react/app/frontend/dist`
- **상태**: ✅ 실행 중 (4개 워커 프로세스)

### 2. Django 메인 서버 (포트 8000)
- **서비스**: Daphne (ASGI 서버)
- **바인딩**: 127.0.0.1:8000 (로컬 전용)
- **용도**: WebSocket 지원을 위한 ASGI 서버 (채팅 실시간 통신)
- **경로**: `/srv/django-react/app/backend`
- **애플리케이션**: `eventeye.asgi:application`
- **systemd 서비스**: `daphne.service`
- **상태**: ✅ 실행 중
- **참고**: Gunicorn 서비스는 비활성화되어 있음 (WebSocket 지원을 위해 Daphne로 전환)

### 3. 챗봇 서버 (포트 8001)
- **서비스**: Gunicorn
- **바인딩**: 0.0.0.0:8001 (외부 접근 가능)
- **워커 수**: 4
- **경로**: `/home/shrjsdn908/chatbot_server`
- **애플리케이션**: `chat_django.wsgi:application`
- **타임아웃**: 600초
- **상태**: ✅ 실행 중

### 4. ASGI 서버 (포트 8002)
- **서비스**: Uvicorn
- **바인딩**: 0.0.0.0:8002
- **용도**: WebSocket 지원 (채팅 실시간 통신)
- **상태**: ✅ 실행 중

### 5. MRI 세그멘테이션 Mosec (포트 5006)
- **서비스**: Mosec
- **바인딩**: 0.0.0.0:5006
- **스크립트**: `/home/shrjsdn908/segmentation_mosec.py`
- **타임아웃**: 2400000ms (40분)
- **systemd 서비스**: `dl-service.service`
- **상태**: ✅ 실행 중

### 6. 맘모그래피 Mosec (포트 5007)
- **서비스**: Mosec
- **바인딩**: 0.0.0.0:5007
- **스크립트**: `/home/shrjsdn908/mammography_mosec.py`
- **타임아웃**: 120000ms (2분)
- **최대 본문 크기**: 209715200 bytes (200MB)
- **systemd 서비스**: `mammography-mosec.service`
- **상태**: ✅ 실행 중

### 7. 병리 이미지 Mosec (포트 5008)
- **서비스**: Mosec
- **바인딩**: 0.0.0.0:5008
- **스크립트**: `/home/shrjsdn908/pathology_mosec.py`
- **타임아웃**: 300000ms (5분)
- **최대 본문 크기**: 524288000 bytes (500MB)
- **systemd 서비스**: `pathology-mosec.service`
- **상태**: ✅ 실행 중

### 8. MySQL (포트 3306)
- **서비스**: MySQL Community Server
- **바인딩**: 0.0.0.0:3306
- **데이터베이스**: `hospital_db`
- **사용자**: `acorn`
- **systemd 서비스**: `mysql.service`
- **상태**: ✅ 실행 중

### 9. Redis (포트 6379)
- **서비스**: Redis Server
- **바인딩**: 127.0.0.1:6379 (로컬 전용)
- **용도**: 채팅 세션 관리, 캐시
- **systemd 서비스**: `redis-server.service`
- **상태**: ✅ 실행 중

### 10. Orthanc PACS (포트 4242, 8042)
- **서비스**: Orthanc (Docker 컨테이너)
- **컨테이너 이름**: `hospital-orthanc`
- **이미지**: `jodogne/orthanc-plugins:latest`
- **포트**:
  - 4242: DICOM 서버
  - 8042: 웹 UI
- **바인딩**: 0.0.0.0 (외부 접근 가능)
- **상태**: ✅ 실행 중 (4일째 실행 중)

---

## 🔍 포트별 접근 경로

### 외부 접근 가능 (0.0.0.0)
- **80**: http://34.42.223.43/
- **8001**: http://34.42.223.43:8001/ (챗봇)
- **8002**: http://34.42.223.43:8002/ (WebSocket)
- **5006**: http://34.42.223.43:5006/ (MRI 세그멘테이션)
- **5007**: http://34.42.223.43:5007/ (맘모그래피)
- **5008**: http://34.42.223.43:5008/ (병리 이미지)
- **4242**: DICOM 서버
- **8042**: http://34.42.223.43:8042/ (Orthanc UI)
- **3306**: MySQL (외부 접근 가능하지만 보안상 권장하지 않음)

### 로컬 전용 (127.0.0.1)
- **8000**: Django 메인 서버 (Nginx를 통해서만 접근)
- **6379**: Redis (로컬 전용)
- **33060**: MySQL X Protocol

---

## ⚠️ 주의사항

1. **Gunicorn 서비스**: Django 메인 서버는 더 이상 Gunicorn을 사용하지 않습니다. WebSocket 지원을 위해 Daphne(ASGI)로 전환되었습니다. Gunicorn 서비스는 비활성화(disabled) 상태입니다.
2. **포트 5002**: Python 프로세스가 실행 중이지만 용도가 불명확합니다. 확인이 필요합니다.
3. **MySQL 외부 접근**: 포트 3306이 0.0.0.0에 바인딩되어 있어 외부에서 접근 가능합니다. 보안을 위해 방화벽 규칙을 확인하세요.
4. **챗봇 서버**: 포트 8001이 외부에 직접 노출되어 있습니다. Nginx를 통한 프록시 설정을 권장합니다.

---

## 📝 서비스 관리 명령어

### 서비스 상태 확인
```bash
# 모든 서비스 상태 확인
sudo systemctl status daphne nginx mysql redis-server dl-service mammography-mosec pathology-mosec

# 특정 서비스 상태 확인
sudo systemctl status daphne  # Django 메인 서버 (ASGI)
sudo systemctl status dl-service  # MRI 세그멘테이션

# 참고: Gunicorn은 더 이상 사용하지 않음 (비활성화 상태)
sudo systemctl status gunicorn  # disabled 상태
```

### 서비스 재시작
```bash
# Django 메인 서버 (Daphne)
sudo systemctl restart daphne

# Nginx
sudo systemctl restart nginx

# Mosec 서비스들
sudo systemctl restart dl-service
sudo systemctl restart mammography-mosec
sudo systemctl restart pathology-mosec

# 참고: Gunicorn은 더 이상 사용하지 않음 (Daphne로 전환됨)
```

### 포트 사용 확인
```bash
# 모든 리스닝 포트 확인
sudo ss -tlnp | grep LISTEN

# 특정 포트 확인
sudo ss -tlnp | grep :8000
```

---

## 🔄 네트워크 흐름

```
인터넷
  ↓
Nginx (포트 80)
  ├─ /api/* → Gunicorn (127.0.0.1:8000) → Django
  ├─ /orthanc/* → Orthanc (localhost:8042)
  └─ /* → 정적 파일 (/srv/django-react/app/frontend/dist)

Django (포트 8000)
  ├─ Mosec API 호출
  │   ├─ MRI 세그멘테이션 → 127.0.0.1:5006
  │   ├─ 맘모그래피 → 127.0.0.1:5007
  │   └─ 병리 이미지 → 127.0.0.1:5008
  ├─ MySQL → 127.0.0.1:3306
  ├─ Redis → 127.0.0.1:6379
  └─ Orthanc → localhost:8042

챗봇 서버 (포트 8001)
  └─ 직접 외부 접근 가능

ASGI 서버 (포트 8002)
  └─ WebSocket 연결 (채팅 실시간 통신)
```

---

**최종 업데이트**: 2026-01-23  
**확인 방법**: GCP SSH 접속 후 `sudo ss -tlnp` 및 `sudo systemctl status` 명령어로 검증 완료

---

## 📌 중요 변경사항

### Gunicorn → Daphne 전환 (2026-01-23 확인)

**Django 메인 서버 (포트 8000)**:
- ❌ **Gunicorn**: 비활성화됨 (disabled)
- ✅ **Daphne**: 활성화됨 (enabled, 실행 중)

**전환 이유**:
- WebSocket 지원 필요 (채팅 실시간 통신)
- Django Channels를 통한 비동기 통신
- ASGI 프로토콜 지원

**현재 상태**:
- Gunicorn 서비스: `inactive (dead)`, `disabled`
- Daphne 서비스: `active (running)`, `enabled`
- 포트 8000: Daphne가 사용 중

**참고**: 챗봇 서버(포트 8001)는 여전히 Gunicorn을 사용 중입니다.
