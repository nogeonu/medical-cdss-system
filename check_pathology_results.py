#!/usr/bin/env python
"""
저장된 병리 분석 결과 조회 스크립트
"""
import os
import sys
import django

# Django 설정
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'eventeye.settings')
django.setup()

from ocs.models import PathologyAnalysisResult, Order
from django.utils import timezone

print("=" * 80)
print("저장된 병리 분석 결과 조회")
print("=" * 80)
print()

# 모든 분석 결과 조회
results = PathologyAnalysisResult.objects.select_related(
    'order', 'order__patient', 'order__doctor', 'analyzed_by'
).all().order_by('-created_at')

if not results.exists():
    print("❌ 저장된 분석 결과가 없습니다.")
    sys.exit(0)

print(f"✅ 총 {results.count()}개의 분석 결과가 저장되어 있습니다.\n")
print("-" * 80)

for idx, result in enumerate(results, 1):
    order = result.order
    patient = order.patient
    doctor = order.doctor
    
    print(f"\n[{idx}] 분석 결과 ID: {result.id}")
    print(f"    환자명: {patient.name} (ID: {patient.patient_number})")
    print(f"    주문 ID: {order.id}")
    print(f"    주문 상태: {order.status}")
    print(f"    의사: {doctor.name if hasattr(doctor, 'name') else doctor.username}")
    print(f"    분석자: {result.analyzed_by.name if result.analyzed_by and hasattr(result.analyzed_by, 'name') else (result.analyzed_by.username if result.analyzed_by else 'N/A')}")
    print(f"    결과: {result.class_name} (신뢰도: {result.confidence*100:.2f}%)")
    print(f"    파일명: {result.filename}")
    print(f"    분석일: {result.created_at.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"    수정일: {result.updated_at.strftime('%Y-%m-%d %H:%M:%S')}")
    if result.findings:
        print(f"    소견: {result.findings[:100]}...")
    if result.recommendations:
        print(f"    권고사항: {result.recommendations[:100]}...")
    if result.image_url:
        print(f"    이미지 URL: {result.image_url[:100]}...")
    print("-" * 80)

print("\n" + "=" * 80)
print("조회 완료")
print("=" * 80)
