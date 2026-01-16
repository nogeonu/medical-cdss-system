"""
OCS Serializers
"""
from rest_framework import serializers
from .models import Order, OrderStatusHistory, DrugInteractionCheck, AllergyCheck, Notification, ImagingAnalysisResult
from patients.models import Patient


class OrderStatusHistorySerializer(serializers.ModelSerializer):
    """주문 상태 이력 Serializer"""
    changed_by_name = serializers.CharField(source='changed_by.get_full_name', read_only=True)
    changed_by_username = serializers.CharField(source='changed_by.username', read_only=True)
    
    class Meta:
        model = OrderStatusHistory
        fields = ['id', 'status', 'changed_by', 'changed_by_name', 'changed_by_username', 'notes', 'created_at']
        read_only_fields = ['id', 'created_at']


class DrugInteractionCheckSerializer(serializers.ModelSerializer):
    """약물 상호작용 검사 Serializer"""
    checked_by_name = serializers.CharField(source='checked_by.get_full_name', read_only=True)
    
    class Meta:
        model = DrugInteractionCheck
        fields = ['id', 'checked_drugs', 'interactions', 'severity', 'checked_at', 'checked_by', 'checked_by_name']
        read_only_fields = ['id', 'checked_at']


class AllergyCheckSerializer(serializers.ModelSerializer):
    """알레르기 검사 Serializer"""
    checked_by_name = serializers.CharField(source='checked_by.get_full_name', read_only=True)
    
    class Meta:
        model = AllergyCheck
        fields = ['id', 'patient_allergies', 'order_items', 'warnings', 'has_allergy_risk', 'checked_at', 'checked_by', 'checked_by_name']
        read_only_fields = ['id', 'checked_at']


class OrderSerializer(serializers.ModelSerializer):
    """주문 Serializer"""
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_number = serializers.CharField(source='patient.patient_id', read_only=True)
    doctor_name = serializers.CharField(source='doctor.get_full_name', read_only=True)
    doctor_username = serializers.CharField(source='doctor.username', read_only=True)
    
    # 관련 객체들
    status_history = OrderStatusHistorySerializer(many=True, read_only=True)
    drug_interaction_checks = DrugInteractionCheckSerializer(many=True, read_only=True)
    allergy_checks = AllergyCheckSerializer(many=True, read_only=True)
    
    # 영상 분석 결과 (영상촬영 주문인 경우)
    imaging_analysis = serializers.SerializerMethodField()
    
    class Meta:
        model = Order
        fields = [
            'id', 'order_type', 'patient', 'patient_name', 'patient_number',
            'doctor', 'doctor_name', 'doctor_username',
            'status', 'priority', 'order_data', 'target_department',
            'due_time', 'notes', 'validation_passed', 'validation_notes',
            'created_at', 'updated_at', 'completed_at',
            'status_history', 'drug_interaction_checks', 'allergy_checks',
            'imaging_analysis'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'completed_at']
    
    def get_imaging_analysis(self, obj):
        """영상 분석 결과 가져오기"""
        if obj.order_type == 'imaging' and hasattr(obj, 'imaging_analysis'):
            return ImagingAnalysisResultSerializer(obj.imaging_analysis).data
        return None
    
    def validate(self, data):
        """주문 데이터 검증"""
        order_type = data.get('order_type')
        order_data = data.get('order_data', {})
        target_department = data.get('target_department')
        
        # 주문 유형별 검증
        if order_type == 'prescription':
            if target_department != 'pharmacy':
                raise serializers.ValidationError("처방전은 약국으로 전달되어야 합니다.")
            if 'medications' not in order_data:
                raise serializers.ValidationError("처방전에는 약물 정보가 필요합니다.")
        
        elif order_type == 'lab_test':
            if target_department != 'lab':
                raise serializers.ValidationError("검사 주문은 검사실로 전달되어야 합니다.")
            if 'test_items' not in order_data:
                raise serializers.ValidationError("검사 주문에는 검사 항목이 필요합니다.")
        
        elif order_type == 'imaging':
            if target_department != 'radiology':
                raise serializers.ValidationError("영상 촬영 의뢰는 방사선과로 전달되어야 합니다.")
            if 'imaging_type' not in order_data:
                raise serializers.ValidationError("영상 촬영 의뢰에는 촬영 유형이 필요합니다.")
        
        return data


class OrderCreateSerializer(serializers.ModelSerializer):
    """주문 생성 Serializer (간소화)"""
    patient_id = serializers.CharField(write_only=True, required=False, help_text="환자 ID (patient_id 또는 patient 필드 사용)")
    patient = serializers.PrimaryKeyRelatedField(queryset=Patient.objects.all(), required=False, allow_null=True)
    
    class Meta:
        model = Order
        fields = [
            'order_type', 'patient', 'patient_id', 'order_data', 'target_department',
            'priority', 'due_time', 'notes'
        ]
    
    def validate(self, data):
        """주문 데이터 검증"""
        import logging
        logger = logging.getLogger(__name__)
        
        # patient_id가 제공된 경우 patient 객체로 변환
        patient_id = data.pop('patient_id', None)
        patient_value = data.get('patient')
        
        logger.info(f"OrderCreateSerializer validate: patient_id={patient_id}, patient={patient_value}, patient_type={type(patient_value)}")
        
        # patient_id가 문자열로 제공된 경우
        if patient_id:
            try:
                # patient_id로 환자 찾기 (문자열 ID, 예: "P2024001")
                patient = Patient.objects.get(patient_id=patient_id)
                data['patient'] = patient
                logger.info(f"Found patient by patient_id: {patient.id}, patient_id={patient.patient_id}")
            except Patient.DoesNotExist:
                logger.error(f"Patient not found with patient_id: {patient_id}")
                raise serializers.ValidationError({
                    'patient_id': f'환자 ID "{patient_id}"를 찾을 수 없습니다.'
                })
            except Patient.MultipleObjectsReturned:
                logger.error(f"Multiple patients found with patient_id: {patient_id}")
                raise serializers.ValidationError({
                    'patient_id': f'환자 ID "{patient_id}"에 해당하는 환자가 여러 명입니다.'
                })
        # patient 필드가 문자열로 전달된 경우 (patient_id 문자열)
        elif patient_value and isinstance(patient_value, str):
            # 숫자로 변환 가능하면 숫자 ID로 처리
            if patient_value.isdigit():
                try:
                    patient = Patient.objects.get(id=int(patient_value))
                    data['patient'] = patient
                    logger.info(f"Found patient by numeric id: {patient.id}, patient_id={patient.patient_id}")
                except Patient.DoesNotExist:
                    logger.error(f"Patient not found with numeric id: {patient_value}")
                    raise serializers.ValidationError({
                        'patient': f'환자 ID "{patient_value}"를 찾을 수 없습니다.'
                    })
            else:
                # 문자열이면 patient_id로 처리
                try:
                    patient = Patient.objects.get(patient_id=patient_value)
                    data['patient'] = patient
                    logger.info(f"Found patient by patient_id string: {patient.id}, patient_id={patient.patient_id}")
                except Patient.DoesNotExist:
                    logger.error(f"Patient not found with patient_id: {patient_value}")
                    raise serializers.ValidationError({
                        'patient': f'환자 ID "{patient_value}"를 찾을 수 없습니다. patient_id 필드를 사용하거나 숫자 ID를 사용해주세요.'
                    })
        # patient 필드가 숫자로 전달된 경우
        elif patient_value and isinstance(patient_value, int):
            try:
                patient = Patient.objects.get(id=patient_value)
                data['patient'] = patient
                logger.info(f"Found patient by id: {patient.id}, patient_id={patient.patient_id}")
            except Patient.DoesNotExist:
                logger.error(f"Patient not found with id: {patient_value}")
                raise serializers.ValidationError({
                    'patient': f'환자 ID "{patient_value}"를 찾을 수 없습니다.'
                })
        
        # patient 필드가 없으면 에러
        if not data.get('patient'):
            logger.error("No patient provided in order data")
            raise serializers.ValidationError({
                'patient': '환자 정보가 필요합니다. patient (숫자 ID) 또는 patient_id (문자열) 필드를 제공해주세요.'
            })
        
        order_type = data.get('order_type')
        order_data = data.get('order_data', {})
        target_department = data.get('target_department')
        
        # 주문 유형별 검증
        if order_type == 'prescription':
            if target_department != 'pharmacy':
                raise serializers.ValidationError("처방전은 약국으로 전달되어야 합니다.")
            medications = order_data.get('medications', [])
            if not medications or len(medications) == 0:
                raise serializers.ValidationError("처방전에는 약물 정보가 필요합니다.")
            # 빈 약물명 필터링
            valid_medications = [m for m in medications if m.get('name', '').strip()]
            if not valid_medications:
                raise serializers.ValidationError("처방전에는 약물명이 필요합니다.")
        
        elif order_type == 'lab_test':
            if target_department != 'lab':
                raise serializers.ValidationError("검사 주문은 검사실로 전달되어야 합니다.")
            test_items = order_data.get('test_items', [])
            if not test_items or len(test_items) == 0:
                raise serializers.ValidationError("검사 주문에는 검사 항목이 필요합니다.")
            # 빈 검사명 필터링
            valid_test_items = [t for t in test_items if t.get('name', '').strip()]
            if not valid_test_items:
                raise serializers.ValidationError("검사 주문에는 검사명이 필요합니다.")
        
        elif order_type == 'imaging':
            if target_department != 'radiology':
                raise serializers.ValidationError("영상 촬영 의뢰는 방사선과로 전달되어야 합니다.")
            if 'imaging_type' not in order_data or not order_data.get('imaging_type'):
                raise serializers.ValidationError("영상 촬영 의뢰에는 촬영 유형(imaging_type)이 필요합니다. (예: MRI, CT, X-RAY, 초음파)")
            if 'body_part' not in order_data or not order_data.get('body_part'):
                raise serializers.ValidationError("영상 촬영 의뢰에는 촬영 부위(body_part)가 필요합니다.")
        
        return data
    
    def create(self, validated_data):
        """주문 생성 시 의사 정보 자동 설정"""
        request = self.context.get('request')
        if request and request.user:
            validated_data['doctor'] = request.user
        
        return super().create(validated_data)


class OrderListSerializer(serializers.ModelSerializer):
    """주문 목록 Serializer (간소화)"""
    patient_name = serializers.CharField(source='patient.name', read_only=True)
    patient_number = serializers.CharField(source='patient.patient_id', read_only=True)
    doctor_name = serializers.CharField(source='doctor.get_full_name', read_only=True)
    
    # 영상 분석 결과 (영상촬영 주문인 경우)
    imaging_analysis = serializers.SerializerMethodField()
    
    class Meta:
        model = Order
        fields = [
            'id', 'order_type', 'patient_name', 'patient_number',
            'doctor_name', 'status', 'priority', 'target_department',
            'order_data', 'validation_passed', 'validation_notes',  # order_data 추가
            'created_at', 'due_time', 'completed_at',
            'imaging_analysis'  # 영상 분석 결과 추가
        ]
    
    def get_imaging_analysis(self, obj):
        """영상 분석 결과 가져오기"""
        if obj.order_type == 'imaging' and hasattr(obj, 'imaging_analysis'):
            try:
                return ImagingAnalysisResultSerializer(obj.imaging_analysis).data
            except:
                return None
        return None


class NotificationSerializer(serializers.ModelSerializer):
    """알림 Serializer"""
    related_order_id = serializers.UUIDField(source='related_order.id', read_only=True)
    related_order_type = serializers.CharField(source='related_order.order_type', read_only=True)
    related_patient_name = serializers.CharField(source='related_order.patient.name', read_only=True)
    
    class Meta:
        model = Notification
        fields = [
            'id', 'notification_type', 'title', 'message',
            'is_read', 'read_at', 'created_at',
            'related_order_id', 'related_order_type', 'related_patient_name',
            'related_resource_type', 'related_resource_id'
        ]
        read_only_fields = ['id', 'created_at', 'read_at']


class ImagingAnalysisResultSerializer(serializers.ModelSerializer):
    """영상 분석 결과 Serializer"""
    analyzed_by_name = serializers.CharField(source='analyzed_by.get_full_name', read_only=True)
    order_patient_name = serializers.CharField(source='order.patient.name', read_only=True)
    order_imaging_type = serializers.CharField(source='order.order_data.imaging_type', read_only=True)
    
    class Meta:
        model = ImagingAnalysisResult
        fields = [
            'id', 'order', 'analyzed_by', 'analyzed_by_name',
            'analysis_result', 'findings', 'recommendations', 'confidence_score',
            'order_patient_name', 'order_imaging_type',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ImagingAnalysisResultCreateSerializer(serializers.ModelSerializer):
    """영상 분석 결과 생성 Serializer"""
    
    class Meta:
        model = ImagingAnalysisResult
        fields = [
            'order', 'analysis_result', 'findings', 'recommendations', 'confidence_score'
        ]
