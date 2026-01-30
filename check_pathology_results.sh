#!/bin/bash
cd /srv/django-react/app/backend
source .venv/bin/activate
python3 manage.py shell << 'EOF'
from ocs.models import PathologyAnalysisResult

results = PathologyAnalysisResult.objects.select_related(
    'order', 'order__patient', 'order__doctor', 'analyzed_by'
).all().order_by('-created_at')

print("=" * 80)
print("저장된 병리 분석 결과 조회")
print("=" * 80)
print()
print(f"✅ 총 {results.count()}개의 분석 결과가 저장되어 있습니다.\n")
print("-" * 80)

for idx, r in enumerate(results, 1):
    print(f"[{idx}] 환자: {r.order.patient.name} (ID: {r.order.patient.patient_number})")
    print(f"    주문ID: {str(r.order.id)}")
    print(f"    주문상태: {r.order.status}")
    print(f"    결과: {r.class_name} (신뢰도: {r.confidence*100:.2f}%)")
    print(f"    파일명: {r.filename}")
    print(f"    분석일: {r.created_at.strftime('%Y-%m-%d %H:%M:%S')}")
    analyzed_by_name = r.analyzed_by.name if r.analyzed_by and hasattr(r.analyzed_by, 'name') else (r.analyzed_by.username if r.analyzed_by else 'N/A')
    print(f"    분석자: {analyzed_by_name}")
    if r.findings:
        print(f"    소견: {r.findings[:100]}...")
    if r.recommendations:
        print(f"    권고사항: {r.recommendations[:100]}...")
    print("-" * 80)

print("\n" + "=" * 80)
print("조회 완료")
print("=" * 80)
EOF
