#!/bin/bash

# OCS 구현 커밋 및 푸시 스크립트

cd /Users/nogeon-u/Desktop/건양대_바이오메디컬/Django/Django-React--main

# 변경사항 확인
echo "=== 변경사항 확인 ==="
git status

# 백엔드 OCS 파일 추가
echo ""
echo "=== 백엔드 OCS 파일 추가 ==="
git add backend/ocs/
git add backend/eventeye/settings.py
git add backend/eventeye/urls.py

# 프론트엔드 OCS 파일 추가
echo ""
echo "=== 프론트엔드 OCS 파일 추가 ==="
git add frontend/src/pages/OCS.tsx
git add frontend/src/App.tsx
git add frontend/src/components/Sidebar.tsx
git add frontend/src/lib/api.ts

# 문서 파일 추가
echo ""
echo "=== 문서 파일 추가 ==="
git add OCS_*.md
git add COMMIT_OCS.md
git add OCS_구성_확인.md
git add backend/ocs/README.md
git add backend/ocs/drug_api_integration.md

# 커밋
echo ""
echo "=== 커밋 ==="
git commit -m "feat: OCS(처방전달시스템) 구현 완료

- 주문 관리 (처방전/검사/영상촬영)
- 약물 상호작용 자동 체크 (하드코딩 데이터, 추후 DB/API 연동 필요)
- 알레르기 자동 체크
- 우선순위 관리 (일반/긴급/즉시/응급)
- 주문 상태 관리 및 이력 추적
- 역할별 자동 필터링 (의사/부서별)
- 프론트엔드 UI 구현
- API 엔드포인트 구현
- 통계 및 대시보드
- 검색 및 필터링 기능"

# 푸시
echo ""
echo "=== 푸시 ==="
git push origin main

echo ""
echo "=== 완료 ==="
