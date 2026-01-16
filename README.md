# 🏥 의료 CDSS 시스템 구축 (Clinical Decision Support System)

## 📋 프로젝트 개요

본 프로젝트는 의료진의 임상 의사결정을 지원하는 종합 의료 정보 시스템입니다. Django와 React를 기반으로 구축되었으며, GCP 클라우드 환경에서 운영됩니다. 환자 관리, 의료 영상 분석, 처방전달시스템(OCS), 영상의학정보시스템(RIS), PACS(Orthanc) 통합 등 다양한 의료 정보 시스템 기능을 제공합니다.

### 주요 특징

- 🧠 **AI 기반 임상 의사결정 지원**: 폐암 예측, 유방촬영술 분석, 병리 이미지 분석, MRI 세그멘테이션
- 📊 **종합 환자 관리**: 환자 등록, 진료 기록, 예약 관리, 의료 이미지 관리
- 📋 **OCS (Order Communication System)**: 처방전, 검사, 영상 촬영 의뢰 자동 전달 시스템
- 🖼️ **RIS (Radiology Information System)**: 영상의학과 업무 관리 및 영상 판독 시스템
- 📦 **PACS 통합 (Orthanc)**: DICOM 영상 저장 및 관리
- 🔔 **실시간 알림 시스템**: 주문 상태 변경, 영상 업로드, 분석 완료 등 실시간 알림
- 📈 **대시보드 및 통계**: 실시간 현황 모니터링 및 통계 분석

---

## 🏗️ 시스템 아키텍처

### 인프라 구성

```
┌─────────────────────────────────────────────────────────┐
│                    GCP Cloud Platform                    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Django API  │  │  React App  │  │   Orthanc    │  │
│  │   (Gunicorn) │  │   (Nginx)   │  │   (Docker)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                  │                  │          │
│         └──────────────────┼──────────────────┘          │
│                            │                             │
│                   ┌────────▼────────┐                   │
│                   │   MySQL Database │                   │
│                   │   (hospital_db)  │                   │
│                   └─────────────────┘                   │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │         AI Services (Mosec)                  │       │
│  │  - 폐암 예측 모델                            │       │
│  │  - 유방촬영술 분석 모델                      │       │
│  │  - 병리 이미지 분석 모델                     │       │
│  │  - MRI 세그멘테이션 모델                     │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 기술 스택

#### 백엔드
- **Django 4.2.7**: 웹 프레임워크
- **Django REST Framework**: RESTful API
- **MySQL (PyMySQL)**: 메인 데이터베이스
- **Gunicorn**: WSGI 서버
- **Nginx**: 리버스 프록시 및 정적 파일 서빙
- **Orthanc**: DICOM PACS 서버 (Docker)
- **Mosec**: AI 모델 서빙 프레임워크
- **PyTorch**: 딥러닝 프레임워크
- **MONAI**: 의료 영상 분석 라이브러리

#### 프론트엔드
- **React 18**: UI 프레임워크
- **TypeScript**: 타입 안정성
- **Vite**: 빌드 도구
- **Tailwind CSS**: 스타일링
- **Radix UI**: UI 컴포넌트
- **React Query**: 데이터 페칭 및 캐싱
- **Axios**: HTTP 클라이언트

#### AI/ML
- **폐암 예측**: scikit-learn 기반 머신러닝 모델
- **유방촬영술 분석**: 딥러닝 기반 이미지 분석
- **병리 이미지 분석**: 딥러닝 기반 병리 이미지 분석
- **MRI 세그멘테이션**: MONAI 기반 3D 영상 세그멘테이션

---

## 📦 주요 모듈 및 기능

### 1. 환자 관리 시스템 (Patients)

- **환자 등록 및 관리**: 환자 정보 등록, 수정, 삭제
- **환자 계정 관리**: PatientUser를 통한 환자 로그인 시스템
- **진료 기록 관리**: MedicalRecord를 통한 진료 이력 관리
- **예약 관리**: Appointment를 통한 진료 예약 시스템
- **부서별 필터링**: 외과, 호흡기내과 등 부서별 예약 조회

**API 엔드포인트:**
- `GET /api/patients/` - 환자 목록 조회
- `POST /api/patients/` - 환자 등록
- `GET /api/patients/{id}/` - 환자 상세 조회
- `PUT /api/patients/{id}/` - 환자 정보 수정
- `DELETE /api/patients/{id}/` - 환자 삭제
- `GET /api/patients/appointments/` - 예약 목록 조회

### 2. OCS (Order Communication System) - 처방전달시스템

의료진이 처방전, 검사 주문, 영상 촬영 의뢰를 생성하고 각 부서로 자동 전달하는 시스템입니다.

**주요 기능:**
- ✅ **주문 생성**: 처방전, 검사, 영상 촬영 의뢰 생성
- ✅ **자동 전달**: 각 부서(약국, 검사실, 방사선과)로 자동 전달
- ✅ **약물 상호작용 체크**: 처방전 생성 시 자동 약물 상호작용 검사
- ✅ **알레르기 체크**: 환자 알레르기 정보 기반 자동 체크
- ✅ **우선순위 관리**: 일반, 긴급, 즉시, 응급 우선순위 설정
- ✅ **상태 관리**: 대기중 → 전달됨 → 처리중 → 완료
- ✅ **영상 분석 결과**: 영상의학과의 분석 결과 입력 및 관리
- ✅ **실시간 알림**: 주문 상태 변경 시 실시간 알림

**주문 유형:**
- **처방전**: 약국으로 전달
- **검사**: 검사실로 전달
- **영상 촬영**: 방사선과로 전달 → 영상의학과 분석

**API 엔드포인트:**
- `GET /api/ocs/orders/` - 주문 목록 조회
- `POST /api/ocs/orders/` - 주문 생성
- `POST /api/ocs/orders/{id}/send/` - 주문 전달
- `POST /api/ocs/orders/{id}/complete/` - 완료 처리
- `GET /api/ocs/notifications/` - 알림 목록 조회

자세한 내용은 [OCS README](./backend/ocs/README.md) 참조

### 3. RIS (Radiology Information System) - 영상의학정보시스템

영상의학과의 업무를 관리하는 시스템입니다.

**주요 기능:**
- **영상 촬영 의뢰 관리**: 의사로부터 받은 영상 촬영 의뢰 관리
- **영상 업로드**: 방사선과에서 촬영한 영상 업로드
- **영상 분석**: 영상의학과에서 영상 분석 및 판독
- **분석 결과 입력**: 소견, 권고사항, 신뢰도 입력
- **의사 알림**: 분석 완료 시 주문 의사에게 자동 알림

### 4. PACS 통합 (Orthanc)

DICOM 영상을 저장하고 관리하는 PACS 시스템입니다.

**주요 기능:**
- **DICOM 파일 업로드**: DICOM 및 NIfTI 파일 업로드
- **영상 조회**: 환자별 영상 조회
- **영상 미리보기**: PNG 형식으로 영상 미리보기
- **REST API 통합**: Orthanc REST API를 통한 영상 관리

**Orthanc 서버 정보:**
- URL: `http://34.42.223.43:8042`
- Web UI: `http://34.42.223.43/orthanc/ui/app/#/`
- DICOM 포트: `4242`

### 5. AI 분석 시스템

#### 5.1 폐암 예측 (Lung Cancer Prediction)

- **머신러닝 기반 예측**: 환자 정보 기반 폐암 위험도 예측
- **통계 대시보드**: 폐암 예측 통계 및 시각화
- **의료 기록 관리**: 진료 기록 및 대기 환자 관리

**API 엔드포인트:**
- `POST /api/lung_cancer/predict/` - 폐암 예측
- `GET /api/lung_cancer/statistics/` - 통계 정보
- `GET /api/lung_cancer/medical-records/waiting_patients/` - 대기 환자 목록

#### 5.2 유방촬영술 분석 (Mammography Analysis)

- **딥러닝 기반 이미지 분석**: 유방촬영술 이미지 자동 분석
- **Mosec 서빙**: 고성능 AI 모델 서빙
- **분석 결과 저장**: 분석 결과 및 신뢰도 저장

#### 5.3 병리 이미지 분석 (Pathology Image Analysis)

- **병리 이미지 분석**: 병리 이미지 자동 분석
- **결과 관리**: 분석 결과 및 메타데이터 관리

#### 5.4 MRI 세그멘테이션 (MRI Segmentation)

- **3D 영상 세그멘테이션**: MONAI 기반 3D MRI 영상 세그멘테이션
- **NIfTI 파일 지원**: `.nii.gz` 형식 지원
- **3D 뷰어**: Axial, Sagittal, Coronal 단면 뷰
- **세그멘테이션 오버레이**: 실시간 세그멘테이션 결과 오버레이

### 6. 지식 허브 (Knowledge Hub)

- **의학 논문 검색**: PubMed API를 통한 의학 논문 검색
- **RSS 피드**: 최신 의학 뉴스 및 논문 피드
- **문서 관리**: 의학 문서 저장 및 관리

### 7. 대시보드

- **실시간 통계**: 오늘 예약, 대기 환자, 완료 환자 등 실시간 통계
- **부서별 필터링**: 부서별 통계 조회
- **환자 검색**: 통합 환자 검색 기능

---

## 🚀 설치 및 배포

### 로컬 개발 환경 설정

#### 백엔드 설정

1. **Python 가상환경 생성 및 활성화**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
```

2. **의존성 설치**
```bash
pip install -r requirements.txt
```

3. **환경변수 설정**
```bash
cp env.example .env
# .env 파일을 편집하여 데이터베이스 설정
```

4. **데이터베이스 마이그레이션**
```bash
python manage.py makemigrations
python manage.py migrate
```

5. **슈퍼유저 생성**
```bash
python manage.py createsuperuser
```

6. **서버 실행**
```bash
python manage.py runserver
```

#### 프론트엔드 설정

1. **의존성 설치**
```bash
cd frontend
npm install
```

2. **개발 서버 실행**
```bash
npm run dev
```

3. **프로덕션 빌드**
```bash
npm run build
```

### GCP 서버 배포

#### 서버 구성
- **OS**: Ubuntu 20.04 LTS
- **웹 서버**: Nginx
- **WSGI 서버**: Gunicorn
- **데이터베이스**: MySQL (GCP Cloud SQL 또는 VM 내부)
- **PACS**: Orthanc (Docker)

#### 배포 스크립트

```bash
# GitHub Actions를 통한 자동 배포
# 또는 수동 배포:

# 1. 코드 업데이트
cd /srv/django-react/app
git pull origin main

# 2. 백엔드 업데이트
sudo cp backend/* /srv/django-react/app/backend/
sudo systemctl restart gunicorn

# 3. 프론트엔드 빌드 및 배포
cd frontend
npm run build
sudo cp -r dist/* /var/www/html/

# 4. Nginx 재시작
sudo systemctl restart nginx
```

#### Nginx 설정

```nginx
server {
    listen 80;
    server_name 34.42.223.43;

    # 정적 파일 서빙
    location /static/ {
        alias /srv/django-react/app/backend/static/;
    }

    location /media/ {
        alias /srv/django-react/app/backend/media/;
    }

    # API 프록시
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 프론트엔드
    location / {
        root /var/www/html;
        try_files $uri $uri/ /index.html;
    }
}
```

#### Gunicorn 설정

```bash
# /etc/systemd/system/gunicorn.service
[Unit]
Description=Gunicorn daemon for Django
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/srv/django-react/app/backend
ExecStart=/srv/django-react/app/backend/.venv/bin/gunicorn \
    --workers 3 \
    --bind 127.0.0.1:8000 \
    eventeye.wsgi:application

[Install]
WantedBy=multi-user.target
```

---

## 📁 프로젝트 구조

```
Django-React--main/
├── backend/                      # Django 백엔드
│   ├── eventeye/                # Django 프로젝트 설정
│   │   ├── settings.py          # 설정 파일
│   │   ├── urls.py              # 메인 URL 설정
│   │   └── wsgi.py              # WSGI 설정
│   ├── patients/                # 환자 관리 앱
│   │   ├── models.py            # Patient, PatientUser, Appointment 모델
│   │   ├── views.py             # API 뷰
│   │   └── serializers.py       # 시리얼라이저
│   ├── ocs/                      # OCS (처방전달시스템)
│   │   ├── models.py            # Order, Notification, ImagingAnalysisResult
│   │   ├── views.py             # OCS API 뷰
│   │   ├── services.py          # 비즈니스 로직
│   │   └── serializers.py       # OCS 시리얼라이저
│   ├── mri_viewer/              # MRI 뷰어 및 Orthanc 통합
│   │   ├── orthanc_client.py   # Orthanc 클라이언트
│   │   ├── orthanc_views.py     # Orthanc API 뷰
│   │   └── views.py             # MRI 뷰어 뷰
│   ├── lung_cancer/             # 폐암 예측 앱
│   │   ├── models.py            # Patient, LungRecord, MedicalRecord
│   │   ├── views.py             # 폐암 예측 API
│   │   └── ml_model/            # ML 모델 파일
│   ├── medical_images/          # 의료 이미지 관리
│   ├── literature/               # 지식 허브
│   ├── dashboard/                # 대시보드
│   ├── requirements.txt         # Python 의존성
│   └── manage.py                 # Django 관리 스크립트
├── frontend/                     # React 프론트엔드
│   ├── src/
│   │   ├── pages/               # 페이지 컴포넌트
│   │   │   ├── Dashboard.tsx    # 대시보드
│   │   │   ├── Patients.tsx     # 환자 관리
│   │   │   ├── OCS.tsx          # OCS 시스템
│   │   │   ├── MRIViewer.tsx    # MRI 뷰어
│   │   │   └── ...
│   │   ├── components/          # UI 컴포넌트
│   │   ├── lib/                 # 유틸리티
│   │   └── hooks/               # 커스텀 훅
│   ├── package.json             # Node.js 의존성
│   └── vite.config.ts           # Vite 설정
└── README.md                    # 프로젝트 문서
```

---

## 🔐 인증 및 권한

### 사용자 역할

- **의료진 (medical_staff)**: 외과, 호흡기내과, 방사선과, 영상의학과, 약국, 검사실
- **원무과 (admin_staff)**: 원무과 직원
- **슈퍼유저 (superuser)**: 시스템 관리자
- **환자 (patient)**: 환자 계정

### 권한 관리

- **부서별 접근 제어**: 각 부서는 자신의 부서 데이터만 조회
- **역할 기반 접근 제어**: 역할에 따른 기능 접근 제한
- **세션 인증**: Django SessionAuthentication 사용

---

## 📊 데이터베이스 스키마

### 주요 테이블

- **patients_patient**: 환자 정보
- **patient_user**: 환자 계정
- **patients_appointment**: 예약 정보
- **ocs_order**: OCS 주문
- **ocs_notification**: 알림
- **ocs_imaginganalysisresult**: 영상 분석 결과
- **medical_record**: 진료 기록
- **lung_record**: 폐암 기록

---

## 🔧 개발 가이드

### API 개발

1. **모델 생성**: `models.py`에 모델 정의
2. **마이그레이션**: `python manage.py makemigrations && python manage.py migrate`
3. **시리얼라이저 생성**: `serializers.py`에 시리얼라이저 정의
4. **뷰 생성**: `views.py`에 ViewSet 또는 APIView 정의
5. **URL 등록**: `urls.py`에 URL 패턴 등록

### 프론트엔드 개발

1. **페이지 생성**: `src/pages/`에 새 페이지 컴포넌트 생성
2. **API 통합**: `src/lib/api.ts`에 API 함수 추가
3. **라우팅**: `src/App.tsx`에 라우트 추가

---

## 📝 주요 기능 상세

### OCS 워크플로우

1. **의사가 주문 생성**: 처방전, 검사, 영상 촬영 의뢰 생성
2. **자동 검증**: 약물 상호작용, 알레르기 체크
3. **부서로 전달**: 해당 부서로 자동 전달 및 알림
4. **처리 시작**: 부서에서 처리 시작
5. **완료 처리**: 작업 완료 후 상태 변경
6. **의사 알림**: 완료 시 주문 의사에게 알림

### 영상 촬영 워크플로우

1. **의사가 영상 촬영 의뢰**: 방사선과로 의뢰 전달
2. **방사선과 촬영**: 영상 촬영 및 Orthanc 업로드
3. **처리중 상태**: 방사선과 완료 후 처리중 상태 유지
4. **영상의학과 분석**: 영상 분석 및 판독
5. **분석 결과 입력**: 소견, 권고사항, 신뢰도 입력
6. **완료 및 알림**: 주문 완료 및 의사에게 알림

---

## 🐛 문제 해결

### 일반적인 문제

1. **데이터베이스 연결 오류**: MySQL 서버 상태 확인 및 연결 정보 확인
2. **정적 파일 404**: `python manage.py collectstatic` 실행
3. **마이그레이션 오류**: 기존 마이그레이션 파일 확인 및 재생성
4. **CORS 오류**: `django-cors-headers` 설정 확인

### 로그 확인

```bash
# Gunicorn 로그
sudo journalctl -u gunicorn -f

# Nginx 로그
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Django 로그
tail -f backend/django.log
```

---

## 📄 라이선스

MIT License

---

## 👥 기여자

- 건양대학교 바이오메디컬 공학과

---

## 📞 문의

프로젝트 관련 문의사항이 있으시면 이슈를 등록해주세요.

---

**마지막 업데이트**: 2025년 1월
