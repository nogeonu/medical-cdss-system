from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Count, Q, Sum, Avg
from .models import Patient, Examination, MedicalImage, AIAnalysisResult, VoiceOfCustomer
from .serializers import (
    PatientSerializer, PatientDetailSerializer,
    ExaminationSerializer, ExaminationDetailSerializer,
    MedicalImageSerializer, AIAnalysisResultSerializer,
    VoiceOfCustomerSerializer
)


class PatientViewSet(viewsets.ModelViewSet):
    """환자 ViewSet"""
    queryset = Patient.objects.all()
    serializer_class = PatientSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['gender', 'blood_type']
    search_fields = ['name', 'patient_number', 'phone', 'email']
    ordering_fields = ['created_at', 'name', 'patient_number']
    ordering = ['-created_at']
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return PatientDetailSerializer
        return PatientSerializer
    
    @action(detail=True, methods=['get'])
    def statistics(self, request, pk=None):
        """환자 통계 정보"""
        patient = self.get_object()
        
        stats = {
            'total_examinations': patient.examinations.count(),
            'total_images': patient.medical_images.count(),
            'examinations_by_type': patient.examinations.values('exam_type').annotate(count=Count('id')),
            'images_by_type': patient.medical_images.values('image_type').annotate(count=Count('id')),
            'recent_examinations': patient.examinations.order_by('-exam_date')[:5],
            'recent_images': patient.medical_images.order_by('-uploaded_at')[:5],
        }
        
        return Response(stats)


class ExaminationViewSet(viewsets.ModelViewSet):
    """검사 ViewSet"""
    queryset = Examination.objects.select_related('patient').all()
    serializer_class = ExaminationSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['exam_type', 'status', 'body_part', 'doctor_name']
    search_fields = ['patient__name', 'patient__patient_number', 'body_part', 'doctor_name']
    ordering_fields = ['exam_date', 'created_at']
    ordering = ['-exam_date']
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ExaminationDetailSerializer
        return ExaminationSerializer
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """검사 통계 정보"""
        stats = {
            'total_examinations': self.queryset.count(),
            'examinations_by_type': self.queryset.values('exam_type').annotate(count=Count('id')),
            'examinations_by_status': self.queryset.values('status').annotate(count=Count('id')),
            'examinations_by_month': self.queryset.extra(
                select={'month': 'EXTRACT(month FROM exam_date)'}
            ).values('month').annotate(count=Count('id')).order_by('month'),
        }
        
        return Response(stats)


class MedicalImageViewSet(viewsets.ModelViewSet):
    """의료 이미지 ViewSet"""
    queryset = MedicalImage.objects.select_related('patient', 'examination').all()
    serializer_class = MedicalImageSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['image_type', 'body_part', 'patient']
    search_fields = ['patient__name', 'patient__patient_number', 'body_part', 'description']
    ordering_fields = ['uploaded_at', 'file_size']
    ordering = ['-uploaded_at']
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        """이미지 AI 분석 요청"""
        image = self.get_object()
        
        # 여기에 실제 AI 분석 로직을 구현
        # 예시로 더미 데이터 생성
        analysis_result = AIAnalysisResult.objects.create(
            image=image,
            analysis_type='CLASSIFICATION',
            results={
                'detected_objects': ['lung', 'heart'],
                'confidence_scores': [0.95, 0.87],
                'bounding_boxes': [
                    {'x': 100, 'y': 150, 'width': 200, 'height': 300},
                    {'x': 300, 'y': 200, 'width': 150, 'height': 200}
                ]
            },
            confidence=91,
            findings='폐와 심장이 정상적으로 관찰됩니다.',
            recommendations='정기적인 검진을 권장합니다.',
            model_version='v1.0'
        )
        
        serializer = AIAnalysisResultSerializer(analysis_result)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """이미지 통계 정보"""
        stats = {
            'total_images': self.queryset.count(),
            'images_by_type': self.queryset.values('image_type').annotate(count=Count('id')),
            'images_by_body_part': self.queryset.values('body_part').annotate(count=Count('id')),
            'total_file_size': self.queryset.aggregate(total_size=Sum('file_size'))['total_size'] or 0,
            'images_with_analysis': self.queryset.filter(analysis_results__isnull=False).distinct().count(),
        }
        
        return Response(stats)


class AIAnalysisResultViewSet(viewsets.ReadOnlyModelViewSet):
    """AI 분석 결과 ViewSet (읽기 전용)"""
    queryset = AIAnalysisResult.objects.select_related('image__patient').all()
    serializer_class = AIAnalysisResultSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['analysis_type', 'image__patient', 'model_version']
    search_fields = ['image__patient__name', 'image__patient__patient_number', 'findings']
    ordering_fields = ['analysis_date', 'confidence']
    ordering = ['-analysis_date']
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """AI 분석 통계 정보"""
        stats = {
            'total_analyses': self.queryset.count(),
            'analyses_by_type': self.queryset.values('analysis_type').annotate(count=Count('id')),
            'average_confidence': self.queryset.aggregate(avg_confidence=Avg('confidence'))['avg_confidence'] or 0,
            'analyses_by_month': self.queryset.extra(
                select={'month': 'EXTRACT(month FROM analysis_date)'}
            ).values('month').annotate(count=Count('id')).order_by('month'),
        }
        
        return Response(stats)

class VoiceOfCustomerViewSet(viewsets.ModelViewSet):
    """고객의 소리 ViewSet"""
    queryset = VoiceOfCustomer.objects.all()
    serializer_class = VoiceOfCustomerSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['relation', 'type', 'is_resolved']
    search_fields = ['name', 'phone', 'title', 'content']
    ordering_fields = ['created_at']
    ordering = ['-created_at']
