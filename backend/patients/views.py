import logging
from rest_framework import viewsets, filters, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.authentication import SessionAuthentication, TokenAuthentication
from django_filters.rest_framework import DjangoFilterBackend
from django.http import Http404

logger = logging.getLogger(__name__)
from .models import Patient, MedicalRecord, PatientUser, Appointment
from .serializers import (
    PatientSerializer,
    MedicalRecordSerializer,
    PatientUserSignupSerializer,
    PatientProfileSerializer,
    AppointmentSerializer,
)

class PatientViewSet(viewsets.ModelViewSet):
    queryset = Patient.objects.all()
    serializer_class = PatientSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['gender']
    search_fields = ['name', 'patient_id', 'phone']
    ordering_fields = ['created_at', 'name']
    ordering = ['-created_at']
    
    def perform_destroy(self, instance):
        """환자 삭제 시 관련 데이터도 함께 삭제"""
        try:
            # OCS 주문 삭제 (CASCADE로 자동 삭제되어야 하지만 명시적으로 처리)
            from ocs.models import Order
            orders = Order.objects.filter(patient=instance)
            order_count = orders.count()
            if order_count > 0:
                logger.info(f"환자 {instance.patient_id} 삭제 전 {order_count}개의 OCS 주문 삭제")
                orders.delete()
            
            # 예약 삭제
            appointments = Appointment.objects.filter(patient=instance)
            appointment_count = appointments.count()
            if appointment_count > 0:
                logger.info(f"환자 {instance.patient_id} 삭제 전 {appointment_count}개의 예약 삭제")
                appointments.delete()
            
            logger.info(f"환자 {instance.patient_id} 삭제 완료")
        except Exception as e:
            logger.error(f"환자 삭제 중 오류 발생: {type(e).__name__}: {str(e)}", exc_info=True)
            raise
        
        # 실제 환자 데이터 삭제
        instance.delete()
    
    @action(detail=True, methods=['get'])
    def medical_records(self, request, pk=None):
        patient = self.get_object()
        records = patient.medical_records.all()
        serializer = MedicalRecordSerializer(records, many=True)
        return Response(serializer.data)


class PatientSignupView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def post(self, request):
        serializer = PatientUserSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = serializer.save()
        except Exception as e:
            logger.error(f"환자 회원가입 실패: {type(e).__name__}: {str(e)}", exc_info=True)
            return Response(
                {
                    "detail": "환자 계정 생성 중 오류가 발생했습니다.",
                    "error": str(e),
                    "error_type": type(e).__name__
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "message": "환자 계정이 생성되었습니다.",
                "account_id": user.account_id,
                "email": user.email,
                "patient_id": user.patient_id,
            },
            status=status.HTTP_201_CREATED,
        )


class PatientLoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def post(self, request):
        try:
            account_id = request.data.get("account_id", "").strip()
            password = request.data.get("password", "")

            if not account_id or not password:
                return Response(
                    {"detail": "계정 ID와 비밀번호를 모두 입력해주세요."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                user = PatientUser.objects.get(account_id=account_id)
            except PatientUser.DoesNotExist:
                return Response(
                    {"detail": "계정 ID 또는 비밀번호가 올바르지 않습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception as e:
                logger.error(f"환자 로그인 - 사용자 조회 오류: {type(e).__name__}: {str(e)}", exc_info=True)
                return Response(
                    {"detail": "로그인 처리 중 오류가 발생했습니다."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            try:
                if not user.check_password(password):
                    return Response(
                        {"detail": "계정 ID 또는 비밀번호가 올바르지 않습니다."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            except Exception as e:
                logger.error(f"환자 로그인 - 비밀번호 확인 오류: {type(e).__name__}: {str(e)}", exc_info=True)
                return Response(
                    {"detail": "로그인 처리 중 오류가 발생했습니다."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            # 안전하게 필드 접근
            return Response(
                {
                    "message": "로그인에 성공했습니다.",
                    "account_id": getattr(user, 'account_id', ''),
                    "patient_id": getattr(user, 'patient_id', None),
                    "name": getattr(user, 'name', ''),
                    "email": getattr(user, 'email', ''),
                    "phone": getattr(user, 'phone', ''),
                },
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            logger.error(f"환자 로그인 - 예상치 못한 오류: {type(e).__name__}: {str(e)}", exc_info=True)
            return Response(
                {"detail": "로그인 처리 중 오류가 발생했습니다."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class PatientProfileView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def get_patient(self, account_id: str):
        try:
            patient_user = PatientUser.objects.get(account_id=account_id)
        except PatientUser.DoesNotExist:
            raise Http404

        patient = getattr(patient_user, "patient_profile", None)
        if not patient:
            raise Http404
        return patient, patient_user

    def get(self, request, account_id: str):
        patient, _ = self.get_patient(account_id)
        serializer = PatientProfileSerializer(patient)
        return Response(serializer.data)

    def put(self, request, account_id: str):
        patient, patient_user = self.get_patient(account_id)
        data = request.data.copy()

        for field in ["birth_date", "gender", "blood_type"]:
            if data.get(field) == "":
                data[field] = None

        serializer = PatientProfileSerializer(patient, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_patient = serializer.save()

        has_changes = False
        if "name" in serializer.validated_data:
            patient_user.name = updated_patient.name
            has_changes = True
        if "phone" in serializer.validated_data:
            patient_user.phone = updated_patient.phone
            has_changes = True
        if has_changes:
            patient_user.save(update_fields=["name", "phone"])

        return Response(PatientProfileSerializer(updated_patient).data)


class MedicalRecordViewSet(viewsets.ModelViewSet):
    queryset = MedicalRecord.objects.all()
    serializer_class = MedicalRecordSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['patient']
    search_fields = ['diagnosis', 'symptoms']
    ordering_fields = ['visit_date']
    ordering = ['-visit_date']


class AppointmentViewSet(viewsets.ModelViewSet):
    """예약 ViewSet - 부서별 필터링 적용 (웹·모바일 앱 공통 사용)"""
    serializer_class = AppointmentSerializer
    permission_classes = [permissions.AllowAny]
    authentication_classes = [SessionAuthentication, TokenAuthentication]  # 웹(세션) + 모바일(토큰) 모두 지원
    ordering = ['start_time']
    pagination_class = None

    def get_queryset(self):
        """예약 쿼리셋 - 부서별 필터링"""
        from eventeye.doctor_utils import get_department
        
        queryset = Appointment.objects.select_related('patient', 'doctor', 'created_by').exclude(status='cancelled')
        
        # 부서별 필터링: 의료진(Staff)만 적용, 원무과가 아니면 자신의 부서 예약만
        # 환자 계정(PatientUser)이거나 인증 없으면 부서 필터링 제외 (웹·모바일 공통)
        if self.request.user.is_authenticated:
            # 환자 계정 판별: PatientUser 모델은 patient_id 속성이 있고 is_staff=False
            # 의료진(Staff User)는 is_staff=True
            from patients.models import PatientUser
            is_patient_account = isinstance(self.request.user, PatientUser) or (
                hasattr(self.request.user, 'patient_id') and not self.request.user.is_staff
            )
            
            if not is_patient_account:
                # 의료진: 부서별 필터링 적용
                try:
                    user_department = get_department(self.request.user.id)
                    if user_department and user_department != "원무과":
                        queryset = queryset.filter(doctor_department=user_department)
                        logger.info(f"예약 조회 - 부서별 필터링 적용: user_id={self.request.user.id}, department={user_department}")
                except Exception as e:
                    logger.warning(f"예약 조회 - 부서 정보 가져오기 실패 (user_id: {self.request.user.id}): {e}")
                    # 오류 발생 시 필터링 없이 전체 조회
            else:
                logger.info(f"예약 조회 - 환자 계정: patient_id={getattr(self.request.user, 'patient_id', None)}, 부서 필터링 제외")
        
        # 추가 필터링
        patient_id = self.request.query_params.get('patient_id')
        if patient_id:
            queryset = queryset.filter(patient_identifier=patient_id)
            logger.info(f"예약 조회 - patient_id 필터: {patient_id}, 결과: {queryset.count()}건")
        
        doctor_code = self.request.query_params.get('doctor_code')
        if doctor_code:
            queryset = queryset.filter(doctor_code=doctor_code)
            logger.info(f"예약 조회 - doctor_code 필터: {doctor_code}, 결과: {queryset.count()}건")
        
        # 최종 쿼리셋 로깅
        logger.info(f"예약 조회 최종 - 총 {queryset.count()}건 반환 (user: {self.request.user}, params: {dict(self.request.query_params)})")
        
        return queryset

    def perform_create(self, serializer):
        """예약 생성 시 created_by 설정"""
        if self.request.user.is_authenticated:
            serializer.save(created_by=self.request.user)
        else:
            serializer.save()

    
    @action(detail=False, methods=['get'])
    def my_appointments(self, request):
        """환자 ID로 예약 목록 조회 (모바일 앱 전용 엔드포인트)"""
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {"detail": "patient_id 파라미터가 필요합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        logger.info(f"my_appointments 호출 - patient_id: {patient_id}, user: {request.user}")
        queryset = self.get_queryset().filter(patient_identifier=patient_id).order_by('start_time')
        logger.info(f"my_appointments 결과 - {queryset.count()}건 (쿼리: {queryset.query})")
        
        # 각 예약의 created_by 정보 로깅
        for apt in queryset[:5]:  # 최대 5개만
            logger.info(f"  - 예약 {apt.id}: {apt.start_time}, created_by={apt.created_by}")
        
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def today_appointments_count(self, request):
        """오늘 예약 수를 진료과별로 반환"""
        from django.utils import timezone
        from eventeye.doctor_utils import get_department
        
        try:
            today = timezone.now().date()
            
            # 기본 쿼리셋 (부서별 필터링 적용)
            queryset = self.get_queryset().filter(
                start_time__date=today,
                status='scheduled'  # 예약됨 상태만
            )
            
            # 현재 사용자의 진료과 정보
            user_department = None
            if request.user.is_authenticated:
                try:
                    user_department = get_department(request.user.id)
                except Exception as e:
                    logger.warning(f"오늘 예약 수 조회 - 부서 정보 가져오기 실패 (user_id: {request.user.id}): {e}")
            
            count = queryset.count()
            
            return Response({
                'today_count': count,
                'department': user_department,
                'date': today.isoformat(),
            })
        except Exception as e:
            logger.error(f"오늘 예약 수 조회 오류: {type(e).__name__}: {str(e)}", exc_info=True)
            return Response(
                {"detail": "예약 수 조회 중 오류가 발생했습니다."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )