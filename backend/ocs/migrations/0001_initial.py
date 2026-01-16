# Generated manually for OCS app

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('patients', '0011_appointment'),
    ]

    operations = [
        migrations.CreateModel(
            name='Order',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False, verbose_name='ID')),
                ('order_type', models.CharField(choices=[('prescription', '처방전'), ('lab_test', '검사'), ('imaging', '영상촬영')], max_length=20, verbose_name='주문 유형')),
                ('status', models.CharField(choices=[('pending', '대기중'), ('sent', '전달됨'), ('processing', '처리중'), ('completed', '완료'), ('cancelled', '취소')], default='pending', max_length=20, verbose_name='상태')),
                ('priority', models.CharField(choices=[('routine', '일반'), ('urgent', '긴급'), ('stat', '즉시'), ('emergency', '응급')], default='routine', max_length=20, verbose_name='우선순위')),
                ('order_data', models.JSONField(default=dict, verbose_name='주문 내용')),
                ('target_department', models.CharField(max_length=50, verbose_name='전달 부서')),
                ('due_time', models.DateTimeField(blank=True, null=True, verbose_name='완료 기한')),
                ('notes', models.TextField(blank=True, verbose_name='메모')),
                ('validation_passed', models.BooleanField(default=False, verbose_name='검증 통과')),
                ('validation_notes', models.TextField(blank=True, verbose_name='검증 메모')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='생성일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
                ('completed_at', models.DateTimeField(blank=True, null=True, verbose_name='완료일')),
                ('doctor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='orders', to=settings.AUTH_USER_MODEL, verbose_name='의사')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='orders', to='patients.patient', verbose_name='환자')),
            ],
            options={
                'verbose_name': '주문',
                'verbose_name_plural': '주문들',
                'ordering': ['-created_at', '-priority'],
            },
        ),
        migrations.CreateModel(
            name='OrderStatusHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(max_length=20, verbose_name='상태')),
                ('notes', models.TextField(blank=True, verbose_name='메모')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='변경일시')),
                ('changed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='order_status_changes', to=settings.AUTH_USER_MODEL, verbose_name='변경자')),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='status_history', to='ocs.order', verbose_name='주문')),
            ],
            options={
                'verbose_name': '주문 상태 이력',
                'verbose_name_plural': '주문 상태 이력들',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='DrugInteractionCheck',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False, verbose_name='ID')),
                ('checked_drugs', models.JSONField(default=list, verbose_name='체크한 약물 리스트')),
                ('interactions', models.JSONField(default=list, verbose_name='발견된 상호작용')),
                ('severity', models.CharField(blank=True, choices=[('mild', '경미'), ('moderate', '중등도'), ('severe', '심각')], max_length=20, null=True, verbose_name='심각도')),
                ('checked_at', models.DateTimeField(auto_now_add=True, verbose_name='검사일시')),
                ('checked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='drug_interaction_checks', to=settings.AUTH_USER_MODEL, verbose_name='검사자')),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='drug_interaction_checks', to='ocs.order', verbose_name='주문')),
            ],
            options={
                'verbose_name': '약물 상호작용 검사',
                'verbose_name_plural': '약물 상호작용 검사들',
                'ordering': ['-checked_at'],
            },
        ),
        migrations.CreateModel(
            name='AllergyCheck',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False, verbose_name='ID')),
                ('patient_allergies', models.JSONField(default=list, verbose_name='환자 알레르기 정보')),
                ('order_items', models.JSONField(default=list, verbose_name='주문 항목 (약물/검사)')),
                ('warnings', models.JSONField(default=list, verbose_name='알레르기 경고')),
                ('has_allergy_risk', models.BooleanField(default=False, verbose_name='알레르기 위험')),
                ('checked_at', models.DateTimeField(auto_now_add=True, verbose_name='검사일시')),
                ('checked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='allergy_checks', to=settings.AUTH_USER_MODEL, verbose_name='검사자')),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='allergy_checks', to='ocs.order', verbose_name='주문')),
            ],
            options={
                'verbose_name': '알레르기 검사',
                'verbose_name_plural': '알레르기 검사들',
                'ordering': ['-checked_at'],
            },
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['patient', 'status'], name='ocs_order_patient_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['doctor', 'status'], name='ocs_order_doctor_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['target_department', 'status'], name='ocs_order_target_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['priority', 'status'], name='ocs_order_priority_idx'),
        ),
    ]
