# Generated manually for OCS app - Notification and ImagingAnalysisResult models

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('ocs', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False, verbose_name='ID')),
                ('notification_type', models.CharField(choices=[('order_created', '주문 생성'), ('order_sent', '주문 전달'), ('order_processing', '주문 처리 중'), ('order_completed', '주문 완료'), ('imaging_uploaded', '영상 업로드 완료'), ('imaging_analysis_complete', '영상 분석 완료'), ('order_cancelled', '주문 취소')], max_length=50, verbose_name='알림 유형')),
                ('title', models.CharField(max_length=255, verbose_name='제목')),
                ('message', models.TextField(verbose_name='메시지')),
                ('is_read', models.BooleanField(default=False, verbose_name='읽음 여부')),
                ('read_at', models.DateTimeField(blank=True, null=True, verbose_name='읽은 시간')),
                ('related_resource_type', models.CharField(blank=True, max_length=50, verbose_name='관련 리소스 유형')),
                ('related_resource_id', models.CharField(blank=True, max_length=255, verbose_name='관련 리소스 ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='생성일')),
                ('related_order', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='ocs.order', verbose_name='관련 주문')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to=settings.AUTH_USER_MODEL, verbose_name='수신자')),
            ],
            options={
                'verbose_name': '알림',
                'verbose_name_plural': '알림들',
                'ordering': ['-created_at', '-is_read'],
            },
        ),
        migrations.CreateModel(
            name='ImagingAnalysisResult',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False, verbose_name='ID')),
                ('analysis_result', models.JSONField(default=dict, verbose_name='분석 결과')),
                ('findings', models.TextField(blank=True, verbose_name='소견')),
                ('recommendations', models.TextField(blank=True, verbose_name='권고사항')),
                ('confidence_score', models.FloatField(blank=True, null=True, verbose_name='신뢰도')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='분석일')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='수정일')),
                ('analyzed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='imaging_analyses', to=settings.AUTH_USER_MODEL, verbose_name='분석자')),
                ('order', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='imaging_analysis', to='ocs.order', verbose_name='주문')),
            ],
            options={
                'verbose_name': '영상 분석 결과',
                'verbose_name_plural': '영상 분석 결과들',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['user', 'is_read'], name='ocs_notific_user_id_idx'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['user', 'created_at'], name='ocs_notific_user_cr_idx'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['notification_type'], name='ocs_notific_type_idx'),
        ),
    ]
