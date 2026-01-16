from rest_framework import serializers
from .models import Patient, LungRecord, LungResult, MedicalRecord


def normalize_gender(value: str) -> str:
    mapping = {
        '남성': 'M',
        '여성': 'F',
        'm': 'M',
        'f': 'F',
        'Male': 'M',
        'Female': 'F',
        '1': 'M',
        '0': 'F',
        'M': 'M',
        'F': 'F',
    }
    normalized = mapping.get(value, None)
    if not normalized:
        raise serializers.ValidationError("성별은 남성/여성 또는 M/F 형식이어야 합니다.")
    return normalized

class PatientSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source='patient_id', read_only=True)  # 문자열 patient_id를 id로 매핑 (하위 호환성)
    pk = serializers.IntegerField(source='id', read_only=True)  # 실제 숫자 primary key
    gender_label = serializers.SerializerMethodField(read_only=True)

    def get_gender_label(self, obj):
        return dict(Patient.GENDER_CHOICES).get(obj.gender, obj.gender)

    class Meta:
        model = Patient
        fields = [
            'id',
            'pk',  # 실제 숫자 ID 추가
            'patient_id',
            'name',
            'birth_date',
            'gender',
            'gender_label',
            'phone',
            'address',
            'emergency_contact',
            'blood_type',
            'medical_history',
            'allergies',
            'age',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'pk', 'patient_id', 'age', 'created_at', 'updated_at']

class LungRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = LungRecord
        fields = '__all__'
        ref_name = 'LungRecordSerializer'

class LungResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = LungResult
        fields = '__all__'
        ref_name = 'LungResultSerializer'

class PatientRegistrationSerializer(serializers.Serializer):
    """환자 등록을 위한 시리얼라이저"""
    name = serializers.CharField(max_length=100)
    birth_date = serializers.DateField()
    gender = serializers.CharField(max_length=10)
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    emergency_contact = serializers.CharField(max_length=20, required=False, allow_blank=True)
    blood_type = serializers.CharField(max_length=5, required=False, allow_blank=True)
    medical_history = serializers.CharField(required=False, allow_blank=True)
    allergies = serializers.CharField(required=False, allow_blank=True)

    def validate_gender(self, value):
        return normalize_gender(value)

    def create(self, validated_data):
        gender = validated_data.pop('gender')
        patient_id = Patient.generate_patient_id()
        patient = Patient.objects.create(
            patient_id=patient_id,
            gender=gender,
            **validated_data,
        )
        return patient

class PatientUpdateSerializer(serializers.ModelSerializer):
    """환자 수정을 위한 시리얼라이저"""
    class Meta:
        model = Patient
        fields = [
            'name',
            'birth_date',
            'gender',
            'phone',
            'address',
            'emergency_contact',
            'blood_type',
            'medical_history',
            'allergies',
        ]
        read_only_fields = ['patient_id', 'age', 'created_at', 'updated_at']
    
    def validate_gender(self, value):
        return normalize_gender(value)
    
    def update(self, instance, validated_data):
        return super().update(instance, validated_data)

class LungCancerPredictionSerializer(serializers.Serializer):
    """폐암 예측을 위한 입력 데이터 시리얼라이저"""
    patient_id = serializers.CharField(max_length=10, required=False, allow_blank=True)  # 기존 환자 ID (옵션)
    name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    birth_date = serializers.DateField(required=False)
    gender = serializers.CharField(max_length=10)
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    emergency_contact = serializers.CharField(max_length=20, required=False, allow_blank=True)
    blood_type = serializers.CharField(max_length=5, required=False, allow_blank=True)
    age = serializers.IntegerField(required=False)
    smoking = serializers.BooleanField()
    yellow_fingers = serializers.BooleanField()
    anxiety = serializers.BooleanField()
    peer_pressure = serializers.BooleanField()
    chronic_disease = serializers.BooleanField()
    fatigue = serializers.BooleanField()
    allergy = serializers.BooleanField()
    wheezing = serializers.BooleanField()
    alcohol_consuming = serializers.BooleanField()
    coughing = serializers.BooleanField()
    shortness_of_breath = serializers.BooleanField()
    swallowing_difficulty = serializers.BooleanField()
    chest_pain = serializers.BooleanField()
    
    def validate_gender(self, value):
        return normalize_gender(value)
    
    def validate_age(self, value):
        if value < 0 or value > 120:
            raise serializers.ValidationError("나이는 0-120 사이의 값이어야 합니다.")
        return value


class MedicalRecordSerializer(serializers.ModelSerializer):
    """진료기록 시리얼라이저"""
    doctor_name = serializers.SerializerMethodField()
    doctor_department = serializers.SerializerMethodField()
    
    class Meta:
        model = MedicalRecord
        fields = [
            'id', 'patient_id', 'name', 'department', 'status', 'notes',
            'doctor_ref', 'doctor_name', 'doctor_department',
            'reception_start_time', 'treatment_end_time', 'is_treatment_completed'
        ]
        read_only_fields = ['id', 'reception_start_time', 'doctor_name', 'doctor_department']
        ref_name = 'LungCancerMedicalRecord'
    
    def get_doctor_name(self, obj):
        """담당 의사 이름 반환"""
        if obj.doctor_ref:
            return obj.doctor_ref.username
        return None
    
    def get_doctor_department(self, obj):
        """담당 의사 부서 반환"""
        if obj.doctor_ref and hasattr(obj.doctor_ref, 'department'):
            return obj.doctor_ref.department
        return None


class MedicalRecordCreateSerializer(serializers.Serializer):
    """진료기록 생성을 위한 시리얼라이저"""
    patient_id = serializers.CharField(max_length=10)
    name = serializers.CharField(max_length=100)
    department = serializers.ChoiceField(choices=[('호흡기내과', '호흡기내과'), ('외과', '외과')])
    doctor_id = serializers.IntegerField(required=False, allow_null=True)  # 담당 의사 ID (auth_user.id)
    notes = serializers.CharField(required=False, allow_blank=True)
    
    class Meta:
        ref_name = 'LungCancerMedicalRecordCreate'
    
    def validate_patient_id(self, value):
        try:
            Patient.objects.get(patient_id=value)
        except Patient.DoesNotExist:
            raise serializers.ValidationError("존재하지 않는 환자입니다.")
        return value
    
    def validate_doctor_id(self, value):
        """담당 의사 검증"""
        if value is not None:
            from django.contrib.auth.models import User
            try:
                User.objects.get(id=value)
            except User.DoesNotExist:
                raise serializers.ValidationError("존재하지 않는 의사입니다.")
        return value


class MedicalRecordUpdateSerializer(serializers.ModelSerializer):
    """진료기록 수정을 위한 시리얼라이저"""
    
    class Meta:
        model = MedicalRecord
        fields = ['status', 'notes', 'treatment_end_time', 'is_treatment_completed']
        ref_name = 'LungCancerMedicalRecordUpdate'
        
    def update(self, instance, validated_data):
        # 진료 완료 처리
        if validated_data.get('status') == '진료완료':
            instance.complete_treatment()
        else:
            # 일반적인 업데이트
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()
        return instance