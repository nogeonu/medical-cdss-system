# OCS 구현 완료 - 커밋 가이드

## 구현된 내용

### 백엔드
- ✅ OCS 앱 생성 (backend/ocs/)
- ✅ Order, OrderStatusHistory, DrugInteractionCheck, AllergyCheck 모델
- ✅ Serializers 및 ViewSet
- ✅ 약물 상호작용 및 알레르기 체크 로직
- ✅ 마이그레이션 파일 생성
- ✅ settings.py 및 urls.py 설정

### 프론트엔드
- ✅ OCS 페이지 생성 (frontend/src/pages/OCS.tsx)
- ✅ API 함수 추가 (frontend/src/lib/api.ts)
- ✅ Sidebar 메뉴 추가
- ✅ App.tsx 라우팅 추가

## 커밋 명령어

```bash
cd /Users/nogeon-u/Desktop/건양대_바이오메디컬/Django/Django-React--main

# 파일 추가
git add backend/ocs/
git add frontend/src/pages/OCS.tsx
git add backend/eventeye/settings.py
git add backend/eventeye/urls.py
git add frontend/src/App.tsx
git add frontend/src/components/Sidebar.tsx
git add frontend/src/lib/api.ts

# 커밋
git commit -m "feat: OCS(처방전달시스템) 구현

- 주문 관리 (처방전/검사/영상촬영)
- 약물 상호작용 자동 체크
- 알레르기 자동 체크
- 우선순위 관리 (일반/긴급/즉시/응급)
- 주문 상태 관리 및 이력 추적
- 프론트엔드 UI 구현
- API 엔드포인트 구현"

# 푸시
git push origin main
```

## GCP 서버 배포 후 실행 명령어

```bash
# 마이그레이션 실행
cd backend
python manage.py migrate ocs

# 서비스 재시작
sudo systemctl restart gunicorn
```
