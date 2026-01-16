"""
OCS (Order Communication System) - 처방전달시스템 모델
"""
from django.db import models
from django.conf import settings
from django.utils import timezone
from patients.models import Patient
import uuid


class Order(models.Model):
    """주문 (처방/검사/영상촬영)"""
    ORDER_TYPE_CHOICES = [
        ('prescription', '처방전'),
        ('lab_test', '검사'),
        ('imaging', '영상촬영'),
    ]
    
    STATUS_CHOICES = [
        ('pending', '대기중'),
        ('sent', '전달됨'),
        ('processing', '처리중'),
        ('completed', '완료'),
        ('cancelled', '취소'),
    ]
    
    PRIORITY_CHOICES = [
        ('routine', '일반'),
        ('urgent', '긴급'),
        ('stat', '즉시'),
        ('emergency', '응급'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_type = models.CharField(max_length=20, choices=ORDER_TYPE_CHOICES, verbose_name='주문 유형')
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='orders', verbose_name='환자')
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='orders',
        verbose_name='의사'
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='상태')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='routine', verbose_name='우선순위')
    
    # 주문 내용 (JSON)
    order_data = models.JSONField(default=dict, verbose_name='주문 내용')  # 처방약물, 검사항목, 촬영부위 등
    
    # 전달 대상
    target_department = models.CharField(max_length=50, verbose_name='전달 부서')  # 'pharmacy', 'lab', 'radiology'
    
    # 완료 기한
    due_time = models.DateTimeField(null=True, blank=True, verbose_name='완료 기한')
    
    # 메모
    notes = models.TextField(blank=True, verbose_name='메모')
    
    # 검증 결과
    validation_passed = models.BooleanField(default=False, verbose_name='검증 통과')
    validation_notes = models.TextField(blank=True, verbose_name='검증 메모')
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name='완료일')
    
    class Meta:
        verbose_name = '주문'
        verbose_name_plural = '주문들'
        ordering = ['-created_at', '-priority']
        indexes = [
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['doctor', 'status']),
            models.Index(fields=['target_department', 'status']),
            models.Index(fields=['priority', 'status']),
        ]
    
    def __str__(self):
        return f"{self.patient.name} - {self.get_order_type_display()} ({self.get_status_display()})"


class OrderStatusHistory(models.Model):
    """주문 상태 변경 이력"""
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='status_history', verbose_name='주문')
    status = models.CharField(max_length=20, verbose_name='상태')
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='order_status_changes',
        verbose_name='변경자'
    )
    notes = models.TextField(blank=True, verbose_name='메모')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='변경일시')
    
    class Meta:
        verbose_name = '주문 상태 이력'
        verbose_name_plural = '주문 상태 이력들'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.order} - {self.status} ({self.created_at})"


class DrugInteractionCheck(models.Model):
    """약물 상호작용 검사"""
    SEVERITY_CHOICES = [
        ('mild', '경미'),
        ('moderate', '중등도'),
        ('severe', '심각'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='drug_interaction_checks', verbose_name='주문')
    checked_drugs = models.JSONField(default=list, verbose_name='체크한 약물 리스트')
    interactions = models.JSONField(default=list, verbose_name='발견된 상호작용')
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, blank=True, null=True, verbose_name='심각도')
    checked_at = models.DateTimeField(auto_now_add=True, verbose_name='검사일시')
    checked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='drug_interaction_checks',
        verbose_name='검사자'
    )
    
    class Meta:
        verbose_name = '약물 상호작용 검사'
        verbose_name_plural = '약물 상호작용 검사들'
        ordering = ['-checked_at']
    
    def __str__(self):
        return f"{self.order} - {self.get_severity_display() if self.severity else '검사 완료'}"


class AllergyCheck(models.Model):
    """알레르기 검사"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='allergy_checks', verbose_name='주문')
    patient_allergies = models.JSONField(default=list, verbose_name='환자 알레르기 정보')
    order_items = models.JSONField(default=list, verbose_name='주문 항목 (약물/검사)')
    warnings = models.JSONField(default=list, verbose_name='알레르기 경고')
    has_allergy_risk = models.BooleanField(default=False, verbose_name='알레르기 위험')
    checked_at = models.DateTimeField(auto_now_add=True, verbose_name='검사일시')
    checked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='allergy_checks',
        verbose_name='검사자'
    )
    
    class Meta:
        verbose_name = '알레르기 검사'
        verbose_name_plural = '알레르기 검사들'
        ordering = ['-checked_at']
    
    def __str__(self):
        return f"{self.order} - {'위험' if self.has_allergy_risk else '안전'}"


class Notification(models.Model):
    """알림"""
    NOTIFICATION_TYPE_CHOICES = [
        ('order_created', '주문 생성'),
        ('order_sent', '주문 전달'),
        ('order_processing', '주문 처리 중'),
        ('order_completed', '주문 완료'),
        ('imaging_uploaded', '영상 업로드 완료'),
        ('imaging_analysis_complete', '영상 분석 완료'),
        ('order_cancelled', '주문 취소'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
        verbose_name='수신자'
    )
    notification_type = models.CharField(
        max_length=50,
        choices=NOTIFICATION_TYPE_CHOICES,
        verbose_name='알림 유형'
    )
    title = models.CharField(max_length=255, verbose_name='제목')
    message = models.TextField(verbose_name='메시지')
    is_read = models.BooleanField(default=False, verbose_name='읽음 여부')
    read_at = models.DateTimeField(null=True, blank=True, verbose_name='읽은 시간')
    
    # 관련 리소스
    related_order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notifications',
        verbose_name='관련 주문'
    )
    related_resource_type = models.CharField(max_length=50, blank=True, verbose_name='관련 리소스 유형')
    related_resource_id = models.CharField(max_length=255, blank=True, verbose_name='관련 리소스 ID')
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    
    class Meta:
        verbose_name = '알림'
        verbose_name_plural = '알림들'
        ordering = ['-created_at', '-is_read']
        indexes = [
            models.Index(fields=['user', 'is_read']),
            models.Index(fields=['user', 'created_at']),
            models.Index(fields=['notification_type']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.title} ({'읽음' if self.is_read else '안읽음'})"
    
    def mark_as_read(self):
        """알림을 읽음으로 표시"""
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=['is_read', 'read_at'])


class ImagingAnalysisResult(models.Model):
    """영상 분석 결과"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.OneToOneField(
        Order,
        on_delete=models.CASCADE,
        related_name='imaging_analysis',
        verbose_name='주문'
    )
    analyzed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='imaging_analyses',
        verbose_name='분석자'
    )
    analysis_result = models.JSONField(default=dict, verbose_name='분석 결과')
    findings = models.TextField(blank=True, verbose_name='소견')
    recommendations = models.TextField(blank=True, verbose_name='권고사항')
    confidence_score = models.FloatField(null=True, blank=True, verbose_name='신뢰도')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='분석일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')
    
    class Meta:
        verbose_name = '영상 분석 결과'
        verbose_name_plural = '영상 분석 결과들'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.order.patient.name} - {self.order.get_order_type_display()} 분석 결과"
