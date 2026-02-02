from rest_framework import serializers
from .models import Patient, Examination, MedicalImage, AIAnalysisResult, VoiceOfCustomer


class PatientSerializer(serializers.ModelSerializer):
    """환자 시리얼라이저"""
    examinations_count = serializers.SerializerMethodField()
    medical_images_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Patient
        fields = [
            'id', 'patient_number', 'name', 'birth_date', 'gender', 
            'phone', 'email', 'address', 'emergency_contact', 'blood_type',
            'allergies', 'medical_history', 'created_at', 'updated_at',
            'examinations_count', 'medical_images_count'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_examinations_count(self, obj):
        return obj.examinations.count()
    
    def get_medical_images_count(self, obj):
        return obj.medical_images.count()


class ExaminationSerializer(serializers.ModelSerializer):
    """검사 시리얼라이저"""
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_number = serializers.CharField(source='patient.patient_number', read_only=True)
    images_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Examination
        fields = [
            'id', 'patient', 'patient_name', 'patient_number', 'exam_type',
            'exam_date', 'body_part', 'status', 'doctor_name', 'notes',
            'created_at', 'images_count'
        ]
        read_only_fields = ['id', 'created_at']
    
    def get_images_count(self, obj):
        return obj.images.count()


class MedicalImageSerializer(serializers.ModelSerializer):
    """의료 이미지 시리얼라이저"""
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_number = serializers.CharField(source='patient.patient_number', read_only=True)
    image_url = serializers.SerializerMethodField()
    analysis_count = serializers.SerializerMethodField()
    
    class Meta:
        model = MedicalImage
        fields = [
            'id', 'patient', 'examination', 'patient_name', 'patient_number',
            'image_type', 'body_part', 'image', 'image_url', 'original_filename',
            'file_size', 'description', 'uploaded_at', 'analysis_count'
        ]
        read_only_fields = ['id', 'uploaded_at']
    
    def get_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return None
    
    def get_analysis_count(self, obj):
        return obj.analysis_results.count()


class AIAnalysisResultSerializer(serializers.ModelSerializer):
    """AI 분석 결과 시리얼라이저"""
    patient_name = serializers.CharField(source='image.patient.name', read_only=True)
    patient_number = serializers.CharField(source='image.patient.patient_number', read_only=True)
    image_type = serializers.CharField(source='image.image_type', read_only=True)
    body_part = serializers.CharField(source='image.body_part', read_only=True)
    
    class Meta:
        model = AIAnalysisResult
        fields = [
            'id', 'image', 'patient_name', 'patient_number', 'image_type',
            'body_part', 'analysis_type', 'results', 'confidence',
            'findings', 'recommendations', 'model_version', 'analysis_date'
        ]
        read_only_fields = ['id', 'analysis_date']


class PatientDetailSerializer(serializers.ModelSerializer):
    """환자 상세 시리얼라이저 (관련 데이터 포함)"""
    examinations = ExaminationSerializer(many=True, read_only=True)
    medical_images = MedicalImageSerializer(many=True, read_only=True)
    
    class Meta:
        model = Patient
        fields = [
            'id', 'patient_number', 'name', 'birth_date', 'gender',
            'phone', 'email', 'address', 'emergency_contact', 'blood_type',
            'allergies', 'medical_history', 'created_at', 'updated_at',
            'examinations', 'medical_images'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ExaminationDetailSerializer(serializers.ModelSerializer):
    """검사 상세 시리얼라이저 (관련 데이터 포함)"""
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_number = serializers.CharField(source='patient.patient_number', read_only=True)
    images = MedicalImageSerializer(many=True, read_only=True)
    
    class Meta:
        model = Examination
        fields = [
            'id', 'patient', 'patient_name', 'patient_number', 'exam_type',
            'exam_date', 'body_part', 'status', 'doctor_name', 'notes',
            'created_at', 'images'
        ]
        read_only_fields = ['id', 'created_at']

class VoiceOfCustomerSerializer(serializers.ModelSerializer):
    """고객의 소리 시리얼라이저"""
    class Meta:
        model = VoiceOfCustomer
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'is_resolved']
