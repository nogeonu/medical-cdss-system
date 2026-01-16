import logging
from rest_framework import serializers
from .models import Patient, MedicalRecord, PatientUser, Appointment

logger = logging.getLogger(__name__)


class PatientUserSignupSerializer(serializers.Serializer):
    account_id = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=20)
    password = serializers.CharField(write_only=True, min_length=6)

    def validate_account_id(self, value: str):
        if PatientUser.objects.filter(account_id=value).exists():
            raise serializers.ValidationError("이미 사용 중인 계정 ID입니다.")
        return value

    def validate_email(self, value: str):
        if PatientUser.objects.filter(email=value).exists():
            raise serializers.ValidationError("이미 사용 중인 이메일입니다.")
        return value

    def validate(self, attrs):
        password = attrs.get("password", "")
        if len(password) < 6:
            raise serializers.ValidationError({"password": "비밀번호는 6자 이상이어야 합니다."})
        return attrs

    def create(self, validated_data):
        try:
            # 1단계: 환자 계정(PatientUser) 먼저 생성 (부모)
            patient_id = Patient.generate_patient_id()
            logger.info(f"환자 회원가입: 생성된 환자 ID {patient_id}")
            
            user = PatientUser.objects.create_user(
                account_id=validated_data["account_id"],
                email=validated_data["email"],
                password=validated_data["password"],
                name=validated_data["name"],
                patient_id=patient_id,
                phone=validated_data["phone"],
            )
            logger.info(f"환자 회원가입: PatientUser 생성 완료 - {user.account_id}")

            # 2단계: 환자 정보(Patient) 생성하고 계정과 연결 (자식)
            patient = Patient.objects.create(
                patient_id=patient_id,
                name=validated_data["name"],
                phone=validated_data["phone"],
                user_account=user,
            )
            logger.info(f"환자 회원가입: Patient 생성 완료 - {patient.patient_id}")

            return user
        except Exception as e:
            logger.error(f"환자 회원가입 실패: {type(e).__name__}: {str(e)}", exc_info=True)
            raise


class PatientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Patient
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')
        ref_name = 'PatientsAppPatient'  # Swagger 충돌 방지


class MedicalRecordSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    
    class Meta:
        model = MedicalRecord
        fields = '__all__'
        read_only_fields = ('created_at',)
        ref_name = 'PatientsAppMedicalRecord'  # Swagger 충돌 방지


class PatientProfileSerializer(serializers.ModelSerializer):
    account_id = serializers.CharField(source='user_account.account_id', read_only=True)
    age = serializers.IntegerField(read_only=True)

    class Meta:
        model = Patient
        fields = [
            'patient_id',
            'name',
            'birth_date',
            'gender',
            'phone',
            'blood_type',
            'address',
            'emergency_contact',
            'medical_history',
            'allergies',
            'age',
            'account_id',
        ]
        read_only_fields = ['patient_id', 'account_id']


class AppointmentSerializer(serializers.ModelSerializer):
    doctor_display = serializers.SerializerMethodField()
    patient_display = serializers.SerializerMethodField()
    patient_id = serializers.CharField(
        source='patient_identifier',
        allow_blank=True,
        required=False,
    )
    doctor_id = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = [
            'id',
            'title',
            'type',
            'start_time',
            'end_time',
            'status',
            'memo',
            'patient',
            'patient_id',
            'patient_name',
            'patient_gender',
            'patient_age',
            'doctor',
            'doctor_id',
            'doctor_username',
            'doctor_name',
            'doctor_department',
            'doctor_display',
            'patient_display',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'doctor_id',
            'doctor_username',
            'doctor_name',
            'doctor_department',
            'doctor_display',
            'patient_display',
            'created_at',
            'updated_at',
        ]

    def validate(self, attrs):
        start = attrs.get('start_time')
        end = attrs.get('end_time')
        if start and end and end <= start:
            raise serializers.ValidationError({'end_time': '종료 일시는 시작 일시보다 이후여야 합니다.'})
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
            logger.info(f"예약 생성: 사용자 {request.user.username} (ID: {request.user.id})")
        appointment = super().create(validated_data)
        logger.info(f"예약 생성 완료: ID {appointment.id}")
        return appointment

    def update(self, instance, validated_data):
        return super().update(instance, validated_data)

    def get_doctor_display(self, obj):
        parts = [obj.doctor_name or obj.doctor_username]
        if obj.doctor_department:
            parts.append(obj.doctor_department)
        if obj.doctor_code:
            parts.append(obj.doctor_code)
        return " / ".join(filter(None, parts))

    def get_patient_display(self, obj):
        if obj.patient_name and obj.patient_identifier:
            return f"{obj.patient_name} ({obj.patient_identifier})"
        return obj.patient_name or obj.patient_identifier or ""
    
    def get_doctor_id(self, obj):
        return obj.doctor_code or ""
