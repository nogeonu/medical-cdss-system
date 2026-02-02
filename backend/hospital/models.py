from django.db import models
from django.utils import timezone
import uuid


class Patient(models.Model):
    """환자 정보 모델"""
    GENDER_CHOICES = [
        ('M', '남성'),
        ('F', '여성'),
        ('O', '기타'),
    ]
    
    BLOOD_TYPE_CHOICES = [
        ('A+', 'A+'),
        ('A-', 'A-'),
        ('B+', 'B+'),
        ('B-', 'B-'),
        ('AB+', 'AB+'),
        ('AB-', 'AB-'),
        ('O+', 'O+'),
        ('O-', 'O-'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_number = models.CharField(max_length=50, unique=True, verbose_name='환자번호')
    name = models.CharField(max_length=100, verbose_name='환자명')
    birth_date = models.DateField(verbose_name='생년월일')
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, verbose_name='성별')
    phone = models.CharField(max_length=20, blank=True, null=True, verbose_name='전화번호')
    email = models.EmailField(blank=True, null=True, verbose_name='이메일')
    address = models.TextField(blank=True, null=True, verbose_name='주소')
    emergency_contact = models.TextField(blank=True, null=True, verbose_name='응급연락처')
    blood_type = models.CharField(max_length=5, choices=BLOOD_TYPE_CHOICES, blank=True, null=True, verbose_name='혈액형')
    allergies = models.TextField(blank=True, null=True, verbose_name='알레르기')
    medical_history = models.TextField(blank=True, null=True, verbose_name='병력')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')
    
    class Meta:
        verbose_name = '환자'
        verbose_name_plural = '환자들'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.name} ({self.patient_number})"


class Examination(models.Model):
    """검사 정보 모델"""
    EXAM_TYPE_CHOICES = [
        ('MRI', 'MRI'),
        ('CT', 'CT'),
        ('X-RAY', 'X-RAY'),
        ('ULTRASOUND', '초음파'),
        ('BLOOD_TEST', '혈액검사'),
        ('URINE_TEST', '소변검사'),
        ('OTHER', '기타'),
    ]
    
    STATUS_CHOICES = [
        ('pending', '대기중'),
        ('in_progress', '진행중'),
        ('completed', '완료'),
        ('cancelled', '취소'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='examinations', verbose_name='환자')
    exam_type = models.CharField(max_length=20, choices=EXAM_TYPE_CHOICES, verbose_name='검사 유형')
    exam_date = models.DateTimeField(default=timezone.now, verbose_name='검사일시')
    body_part = models.CharField(max_length=100, verbose_name='검사 부위')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='상태')
    doctor_name = models.CharField(max_length=100, blank=True, null=True, verbose_name='담당 의사')
    notes = models.TextField(blank=True, null=True, verbose_name='검사 메모')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    
    class Meta:
        verbose_name = '검사'
        verbose_name_plural = '검사들'
        ordering = ['-exam_date']
    
    def __str__(self):
        return f"{self.patient.name} - {self.exam_type} ({self.body_part})"


class MedicalImage(models.Model):
    """의료 이미지 모델"""
    IMAGE_TYPE_CHOICES = [
        ('MRI', 'MRI'),
        ('CT', 'CT'),
        ('X-RAY', 'X-RAY'),
        ('ULTRASOUND', '초음파'),
        ('PHOTO', '사진'),
        ('OTHER', '기타'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='medical_images', verbose_name='환자')
    examination = models.ForeignKey(Examination, on_delete=models.SET_NULL, null=True, blank=True, related_name='images', verbose_name='검사')
    image_type = models.CharField(max_length=20, choices=IMAGE_TYPE_CHOICES, verbose_name='이미지 유형')
    body_part = models.CharField(max_length=100, verbose_name='촬영 부위')
    image = models.ImageField(upload_to='medical_images/', verbose_name='이미지 파일')
    original_filename = models.CharField(max_length=255, blank=True, null=True, verbose_name='원본 파일명')
    file_size = models.PositiveIntegerField(blank=True, null=True, verbose_name='파일 크기')
    description = models.TextField(blank=True, null=True, verbose_name='설명')
    uploaded_at = models.DateTimeField(auto_now_add=True, verbose_name='업로드일')
    
    class Meta:
        verbose_name = '의료 이미지'
        verbose_name_plural = '의료 이미지들'
        ordering = ['-uploaded_at']
    
    def __str__(self):
        return f"{self.patient.name} - {self.image_type} ({self.body_part})"


class AIAnalysisResult(models.Model):
    """AI 분석 결과 모델"""
    ANALYSIS_TYPE_CHOICES = [
        ('YOLO', 'YOLO 객체 탐지'),
        ('CLASSIFICATION', '분류'),
        ('SEGMENTATION', '분할'),
        ('DETECTION', '탐지'),
        ('OTHER', '기타'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ForeignKey(MedicalImage, on_delete=models.CASCADE, related_name='analysis_results', verbose_name='이미지')
    analysis_type = models.CharField(max_length=20, choices=ANALYSIS_TYPE_CHOICES, verbose_name='분석 유형')
    results = models.JSONField(verbose_name='분석 결과')
    confidence = models.PositiveIntegerField(blank=True, null=True, verbose_name='신뢰도')
    findings = models.TextField(blank=True, null=True, verbose_name='발견사항')
    recommendations = models.TextField(blank=True, null=True, verbose_name='권장사항')
    model_version = models.CharField(max_length=50, blank=True, null=True, verbose_name='모델 버전')
    analysis_date = models.DateTimeField(auto_now_add=True, verbose_name='분석일')
    
    class Meta:
        verbose_name = 'AI 분석 결과'
        verbose_name_plural = 'AI 분석 결과들'
        ordering = ['-analysis_date']
    
    def __str__(self):
        return f"{self.image.patient.name} - {self.analysis_type} 분석"

class VoiceOfCustomer(models.Model):
    """고객의 소리(VOC) 모델"""
    RELATION_CHOICES = [
        ('self', '본인'),
        ('family', '가족'),
        ('other', '기타'),
    ]
    
    TYPE_CHOICES = [
        ('compliment', '칭찬'),
        ('complaint', '불만'),
        ('suggestion', '제안 및 건의'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, verbose_name='이름')
    phone = models.CharField(max_length=50, verbose_name='연락처')
    email = models.EmailField(verbose_name='이메일')
    relation = models.CharField(max_length=20, choices=RELATION_CHOICES, verbose_name='환자와의 관계')
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, verbose_name='상담 유형')
    title = models.CharField(max_length=200, verbose_name='제목')
    content = models.TextField(verbose_name='내용')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='접수일')
    is_resolved = models.BooleanField(default=False, verbose_name='처리 완료 여부')
    
    class Meta:
        verbose_name = '고객의 소리'
        verbose_name_plural = '고객의 소리(VOC) 목록'
        ordering = ['-created_at']
        
    def __str__(self):
        return f"[{self.get_type_display()}] {self.title} - {self.name}"
