"""
OCS ViewSet 및 API 엔드포인트
"""
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Count, Q, Avg
from django.utils import timezone
from datetime import timedelta
import requests
import logging

from .models import Order, OrderStatusHistory, DrugInteractionCheck, AllergyCheck, Notification, ImagingAnalysisResult, LabTestResult, PathologyAnalysisResult
from .serializers import (
    OrderSerializer, OrderCreateSerializer, OrderListSerializer,
    OrderStatusHistorySerializer, DrugInteractionCheckSerializer, AllergyCheckSerializer,
    NotificationSerializer, ImagingAnalysisResultSerializer, ImagingAnalysisResultCreateSerializer,
    LabTestResultSerializer, LabTestResultCreateSerializer,
    PathologyAnalysisResultSerializer, PathologyAnalysisResultCreateSerializer
)
from .services import validate_order, update_order_status, check_drug_interactions, check_allergies, create_imaging_analysis_result
from eventeye.doctor_utils import get_department

logger = logging.getLogger(__name__)

# 외부 약물 검색 API 설정
from django.conf import settings
# Nginx 프록시를 통해 접근 (포트 8002 직접 접근 대신)
DRUG_API_BASE_URL = getattr(settings, 'FASTAPI_BASE_URL', 'http://127.0.0.1:8002')


class OrderViewSet(viewsets.ModelViewSet):
    """OCS 주문 관리 ViewSet"""
    queryset = Order.objects.select_related(
        'patient', 'doctor', 'imaging_analysis', 'pathology_analysis', 'lab_test_result'
    ).prefetch_related(
        'status_history', 'drug_interaction_checks', 'allergy_checks'
    ).all()
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['order_type', 'status', 'priority', 'target_department', 'patient', 'doctor']
    search_fields = ['patient__name', 'patient__patient_number', 'notes']
    ordering_fields = ['created_at', 'due_time', 'priority', 'status']
    ordering = ['-created_at', '-priority']
    
    def get_queryset(self):
        """역할 및 부서별로 주문 필터링"""
        queryset = super().get_queryset()
        user = self.request.user
        
        # 사용자 부서 확인
        user_department = get_department(user.id) if user else None
        
        # 원무과는 모든 주문 조회 가능
        if user_department == "원무과" or user.is_superuser:
            return queryset
        
        # 의료진인 경우
        if user.is_staff:
            # 부서별로 해당하는 주문만 조회
            if user_department == "방사선과":
                # 방사선과: 영상촬영 주문만
                queryset = queryset.filter(
                    target_department='radiology',
                    order_type='imaging'
                )
            elif user_department == "영상의학과":
                # 영상의학과: 영상촬영 주문만 (판독용)
                queryset = queryset.filter(
                    target_department='radiology',
                    order_type='imaging'
                )
            elif user_department == "검사실":
                # 검사실: 검사 주문과 조직검사 주문 (lab_test, tissue_exam 타입이고 target_department가 'lab')
                queryset = queryset.filter(
                    target_department='lab',
                    order_type__in=['lab_test', 'tissue_exam']
                )
            elif user_department in ["호흡기내과", "외과", "영상의학과"]:
                # 의사: 자신이 생성한 주문 또는 자신의 환자 주문
                # 또는 자신의 부서로 온 주문
                queryset = queryset.filter(
                    Q(doctor=user) |  # 자신이 생성한 주문
                    Q(patient__patient_id__in=[])  # 추후 환자 연결 시 확장
                )
            else:
                # 기타 의료진: 자신이 생성한 주문만
                queryset = queryset.filter(doctor=user)
        
        return queryset
    
    def get_serializer_class(self):
        if self.action == 'create':
            return OrderCreateSerializer
        elif self.action == 'list':
            return OrderListSerializer
        return OrderSerializer
    
    def get_serializer_context(self):
        """Serializer에 request 전달"""
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    def create(self, request, *args, **kwargs):
        """주문 생성 (에러 로깅 추가)"""
        try:
            logger.info(f"Order creation request: user={request.user.id}, username={request.user.username}, is_authenticated={request.user.is_authenticated}")
            logger.info(f"Order creation data: {request.data}")
            logger.info(f"Order creation data type: {type(request.data)}")
            
            serializer = self.get_serializer(data=request.data)
            if not serializer.is_valid():
                logger.error(f"Order creation validation failed:")
                logger.error(f"  - Errors: {serializer.errors}")
                logger.error(f"  - Data received: {request.data}")
                logger.error(f"  - Patient field: {request.data.get('patient')}")
                logger.error(f"  - Patient_id field: {request.data.get('patient_id')}")
                return Response(
                    {
                        'error': '주문 생성 검증 실패',
                        'details': serializer.errors
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            logger.info("Serializer validation passed, creating order...")
            return super().create(request, *args, **kwargs)
        except PermissionDenied as e:
            logger.error(f"Order creation permission denied: {str(e)}")
            return Response(
                {'error': str(e)},
                status=status.HTTP_403_FORBIDDEN
            )
        except Exception as e:
            logger.error(f"Order creation error: {str(e)}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return Response(
                {
                    'error': '주문 생성 중 오류가 발생했습니다.',
                    'details': str(e)
                },
                status=status.HTTP_400_BAD_REQUEST
            )
    
    def perform_create(self, serializer):
        """주문 생성 시 권한 체크 및 검증 수행"""
        user = self.request.user
        user_department = get_department(user.id) if user else None
        
        logger.info(f"Order creation attempt by user {user.id} (username: {user.username}, dept: {user_department}, is_staff: {user.is_staff})")
        
        # 부서가 없는 경우 체크
        if not user_department:
            logger.warning(f"Order creation denied: No department found for user {user.id}")
            raise PermissionDenied("부서 정보가 없습니다. 관리자에게 문의하세요.")
        
        # 원무과는 주문 생성 불가
        if user_department == "원무과":
            logger.warning(f"Order creation denied: 원무과 cannot create orders (user: {user.id})")
            raise PermissionDenied("원무과는 주문을 생성할 수 없습니다.")
        
        # 영상의학과는 주문 생성 불가 (영상 분석만 가능)
        if user_department == "영상의학과":
            logger.warning(f"Order creation denied: 영상의학과 cannot create orders (user: {user.id})")
            raise PermissionDenied("영상의학과는 주문을 생성할 수 없습니다. 영상 분석만 가능합니다.")
        
        # 방사선과는 주문 생성 불가 (주문을 받아서 처리하는 역할)
        if user_department == "방사선과":
            logger.warning(f"Order creation denied: 방사선과 cannot create orders (user: {user.id})")
            raise PermissionDenied("방사선과는 주문을 생성할 수 없습니다. 의사가 생성한 주문을 받아서 처리합니다.")
        
        # 검사실은 주문 생성 불가 (주문을 받아서 처리하는 역할)
        if user_department == "검사실":
            logger.warning(f"Order creation denied: 검사실 cannot create orders (user: {user.id})")
            raise PermissionDenied("검사실은 주문을 생성할 수 없습니다. 의사가 생성한 주문을 받아서 처리합니다.")
        
        # 의료진(외과, 호흡기내과 등)은 주문 생성 가능
        # 부서가 위의 제한된 부서가 아니면 주문 생성 허용
        # is_staff가 False인 경우도 체크 (원무과는 is_staff=False)
        if not user.is_staff:
            logger.warning(f"Order creation denied: User {user.id} is not staff (is_staff=False)")
            raise PermissionDenied("의료진만 주문을 생성할 수 있습니다.")
        
        logger.info(f"Order creation allowed for department: {user_department}")
        
        # 주문 유형 확인
        order_type = serializer.validated_data.get('order_type')
        target_department = serializer.validated_data.get('target_department')
        
        logger.info(f"Order type: {order_type}, target_department: {target_department}")
        
        try:
            # OrderCreateSerializer에서 이미 doctor 설정됨
            order = serializer.save()
            
            # 주문 검증 (약물 상호작용, 알레르기) - 비동기로 처리하여 주문 생성 속도 개선
            # validate_order는 백그라운드에서 실행되도록 스킵 (주문 생성 후 별도로 처리)
            # validate_order(order)  # 주문 생성 속도 개선을 위해 주석 처리
            
            # 주문 생성 시 기본적으로 검증 통과로 설정 (약물 검사는 나중에 별도 처리)
            order.validation_passed = True
            order.save()
            
            # 상태 이력 기록
            update_order_status(order, 'pending', self.request.user, '주문 생성')
            
            logger.info(f"Order created successfully: {order.id} by {self.request.user} (dept: {user_department}, type: {order_type})")
        except Exception as e:
            logger.error(f"Order creation failed: {str(e)}", exc_info=True)
            raise
    
    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        """주문을 대상 부서로 전달"""
        order = self.get_object()
        
        if order.status != 'pending':
            return Response(
                {'error': '이미 처리된 주문입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # 검증 통과 확인
        if not order.validation_passed:
            return Response(
                {
                    'error': '주문 검증에 실패했습니다.',
                    'validation_notes': order.validation_notes
                },
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # 부서별 전달 로직
        if order.target_department == 'lab':
            # LIS로 전달 (추후 구현)
            update_order_status(order, 'sent', request.user, '검사실로 전달')
            logger.info(f"Order {order.id} sent to lab")
            
        elif order.target_department == 'radiology':
            # RIS로 전달 (추후 구현)
            update_order_status(order, 'sent', request.user, '방사선과로 전달')
            logger.info(f"Order {order.id} sent to radiology")
            
        elif order.target_department == 'admin':
            # 원무과로 전달
            update_order_status(order, 'sent', request.user, '원무과로 전달')
            logger.info(f"Order {order.id} sent to admin (원무과)")
            
        elif order.target_department == 'pharmacy':
            # 약국으로 전달 (하위 호환성 유지)
            update_order_status(order, 'sent', request.user, '약국으로 전달')
            logger.info(f"Order {order.id} sent to pharmacy")
        
        serializer = self.get_serializer(order)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def start_processing(self, request, pk=None):
        """주문 처리 시작"""
        order = self.get_object()
        
        if order.status not in ['sent', 'pending']:
            return Response(
                {'error': '처리할 수 없는 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        update_order_status(order, 'processing', request.user, '처리 시작')
        serializer = self.get_serializer(order)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'], parser_classes=[MultiPartParser, FormParser, JSONParser])
    def input_lab_result(self, request, pk=None):
        """검사 결과 입력 (검사실용)"""
        order = self.get_object()
        
        # 검사 주문인지 확인
        if order.order_type != 'lab_test':
            return Response(
                {'error': '검사 주문만 결과를 입력할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # 검사실만 결과 입력 가능
        user = request.user
        user_department = get_department(user.id) if user else None
        
        if user_department != "검사실":
            raise PermissionDenied("검사실만 검사 결과를 입력할 수 있습니다.")
        
        # 처리 중 상태인지 확인
        if order.status != 'processing':
            return Response(
                {'error': '처리 중인 주문만 결과를 입력할 수 있습니다. 먼저 처리 시작을 해주세요.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # 기존 결과가 있으면 업데이트, 없으면 생성
            lab_result, created = LabTestResult.objects.update_or_create(
                order=order,
                defaults={
                    'input_by': user,
                    'test_results': request.data.get('test_results', {}),
                    'ai_findings': request.data.get('ai_findings', ''),
                    'ai_confidence_score': request.data.get('ai_confidence_score'),
                    'ai_report_image': request.data.get('ai_report_image', ''),
                    'ai_prediction': request.data.get('ai_prediction', ''),
                    'notes': request.data.get('notes', ''),
                }
            )
            
            # 주문 상태를 완료로 변경
            update_order_status(order, 'completed', user, '검사 결과 입력 완료')
            order.completed_at = timezone.now()
            order.save()
            
            # 의사에게 알림 전송
            from .services import create_notification
            create_notification(
                user=order.doctor,
                notification_type='order_completed',
                title='검사 결과 입력 완료',
                message=f'{order.patient.name}님의 검사 결과가 입력되었습니다. OCS에서 확인하세요.',
                related_order=order
            )
            
            logger.info(f"Lab test result input for order {order.id} by {user}")
            
            serializer = LabTestResultSerializer(lab_result)
            return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Lab test result input failed: {str(e)}", exc_info=True)
            return Response(
                {'error': f'검사 결과 입력 중 오류가 발생했습니다: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['post'])
    def input_pathology_result(self, request, pk=None):
        """병리 분석 결과 입력 및 전달 (검사실용)"""
        order = self.get_object()
        
        # 조직검사 주문인지 확인
        if order.order_type != 'tissue_exam':
            return Response(
                {'error': '조직검사 주문만 결과를 입력할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # 검사실만 결과 입력 가능
        user = request.user
        user_department = get_department(user.id) if user else None
        
        if user_department != "검사실":
            raise PermissionDenied("검사실만 병리 분석 결과를 입력할 수 있습니다.")
        
        # 처리 중 상태인지 확인
        if order.status != 'processing':
            return Response(
                {'error': '처리 중인 주문만 결과를 입력할 수 있습니다. 먼저 처리 시작을 해주세요.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # 병리 분석 결과가 있는지 확인 (select_related로 이미 로드되어 있어야 함)
        try:
            # refresh_from_db로 최신 데이터 가져오기
            order.refresh_from_db()
            pathology_result = getattr(order, 'pathology_analysis', None)
            
            if not pathology_result:
                # 직접 조회 시도
                from ocs.models import PathologyAnalysisResult
                try:
                    pathology_result = PathologyAnalysisResult.objects.get(order=order)
                except PathologyAnalysisResult.DoesNotExist:
                    logger.warning(f"⚠️ 병리 분석 결과 없음: order_id={order.id}, patient={order.patient.name if order.patient else 'N/A'}")
                    return Response(
                        {'error': '병리 분석 결과가 없습니다. 먼저 병리이미지분석 페이지에서 분석을 완료해주세요.'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
        except Exception as e:
            logger.error(f"❌ 병리 분석 결과 조회 실패: {str(e)}", exc_info=True)
            return Response(
                {'error': f'병리 분석 결과를 불러오는 중 오류가 발생했습니다: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        try:
            # 병리 분석 결과 업데이트 (메모 추가)
            pathology_result.findings = request.data.get('findings', pathology_result.findings)
            pathology_result.recommendations = request.data.get('recommendations', pathology_result.recommendations)
            pathology_result.analyzed_by = user  # 검사한 사람으로 업데이트
            pathology_result.save()
            
            # 주문 상태를 완료로 변경
            update_order_status(order, 'completed', user, '병리 분석 결과 입력 완료')
            order.completed_at = timezone.now()
            order.save()
            
            # 의사에게 알림 전송
            from .services import create_notification
            create_notification(
                user=order.doctor,
                notification_type='pathology_completed',
                title='병리 분석 결과 입력 완료',
                message=f'{order.patient.name}님의 병리 분석 결과가 입력되었습니다. 결과: {pathology_result.class_name} (신뢰도: {pathology_result.confidence*100:.1f}%)',
                related_order=order
            )
            
            logger.info(f"Pathology result input for order {order.id} by {user}")
            
            serializer = PathologyAnalysisResultSerializer(pathology_result)
            return Response(serializer.data, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Pathology result input failed: {str(e)}", exc_info=True)
            return Response(
                {'error': f'병리 분석 결과 입력 중 오류가 발생했습니다: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['get'])
    def download_prescription_pdf(self, request, pk=None):
        """처방전 PDF 다운로드 (원무과용)"""
        from io import BytesIO
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
        from reportlab.lib import colors
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from django.http import HttpResponse
        from datetime import datetime
        
        order = self.get_object()
        
        # 처방전 주문만 PDF 생성 가능
        if order.order_type != 'prescription':
            return Response(
                {'error': '처방전 주문만 PDF로 다운로드할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # PDF 버퍼 생성
        buffer = BytesIO()
        p = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        
        # 한글 폰트 설정
        # reportlab의 기본 폰트는 한글을 지원하지 않으므로 UnicodeCIDFont 사용
        try:
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            # 한글 폰트 등록 (시스템에 따라 다를 수 있음)
            try:
                pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
                font_name = 'HYSMyeongJo-Medium'
            except:
                # 다른 한글 폰트 시도
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('HYGothic-Medium'))
                    font_name = 'HYGothic-Medium'
                except:
                    # 마지막으로 기본 CID 폰트 사용
                    pdfmetrics.registerFont(UnicodeCIDFont('HeiseiMin-W3'))
                    font_name = 'HeiseiMin-W3'
        except Exception as e:
            logger.warning(f"한글 폰트 등록 실패, 기본 폰트 사용: {e}")
            font_name = 'Helvetica'
        
        # 제목
        p.setFont(font_name, 20)
        p.drawString(50, height - 50, "처방전")
        
        # 병원 정보
        p.setFont(font_name, 12)
        p.drawString(50, height - 80, "건양대학교병원")
        p.drawString(50, height - 100, "대전 서구 관저동")
        
        # 환자 정보
        patient = order.patient
        y_pos = height - 150
        p.setFont(font_name, 12)
        p.drawString(50, y_pos, "환자 정보")
        y_pos -= 25
        
        p.setFont(font_name, 10)
        p.drawString(70, y_pos, f"환자명: {patient.name}")
        y_pos -= 20
        p.drawString(70, y_pos, f"환자번호: {patient.patient_id}")
        y_pos -= 20
        if patient.birth_date:
            birth_date_str = patient.birth_date.strftime('%Y년 %m월 %d일') if hasattr(patient.birth_date, 'strftime') else str(patient.birth_date)
            p.drawString(70, y_pos, f"생년월일: {birth_date_str}")
            y_pos -= 20
        if patient.gender:
            gender_str = "남성" if patient.gender == "M" else "여성" if patient.gender == "F" else patient.gender
            p.drawString(70, y_pos, f"성별: {gender_str}")
            y_pos -= 20
        if patient.phone:
            p.drawString(70, y_pos, f"연락처: {patient.phone}")
            y_pos -= 20
        
        # 의사 정보 박스
        doctor = order.doctor
        y_pos -= 30
        p.setFont(font_name, 14)
        p.drawString(50, y_pos, "처방 의사")
        y_pos -= 30
        
        # 의사 정보 박스 그리기
        box_y_start = y_pos + 10
        box_y_end = y_pos - 60
        p.setStrokeColor(colors.grey)
        p.setLineWidth(1)
        p.rect(50, box_y_end, width - 100, box_y_start - box_y_end)
        
        p.setFont(font_name, 11)
        doctor_name = doctor.get_full_name() if hasattr(doctor, 'get_full_name') else f"{doctor.first_name} {doctor.last_name}".strip() or doctor.username
        p.drawString(60, y_pos, f"의사명: {doctor_name}")
        y_pos -= 22
        user_department = get_department(doctor.id)
        if user_department:
            p.drawString(60, y_pos, f"진료과: {user_department}")
            y_pos -= 22
        
        # 처방일시
        p.drawString(60, y_pos, f"처방일시: {order.created_at.strftime('%Y년 %m월 %d일 %H:%M')}")
        y_pos -= 40
        
        # 약물 정보 박스
        p.setFont(font_name, 14)
        p.drawString(50, y_pos, "처방 약물")
        y_pos -= 30
        
        medications = order.order_data.get('medications', [])
        if medications:
            # 약물 정보 박스 그리기
            med_box_y_start = y_pos + 10
            med_box_y_end = y_pos - (len(medications) * 25) - 30
            if med_box_y_end < 150:  # 페이지 하단 도달 시 새 페이지
                p.showPage()
                y_pos = height - 50
                med_box_y_start = y_pos + 10
                med_box_y_end = y_pos - (len(medications) * 25) - 30
            
            p.setStrokeColor(colors.grey)
            p.setLineWidth(1)
            p.rect(50, med_box_y_end, width - 100, med_box_y_start - med_box_y_end)
            
            p.setFont(font_name, 10)
            # 테이블 헤더 (굵게)
            p.setFont(font_name, 11)
            # 약물명과 용량 사이 간격을 더 넓힘 (60 -> 60, 200 -> 280으로 변경)
            p.drawString(60, y_pos, "약물명")
            p.drawString(280, y_pos, "용량")
            p.drawString(340, y_pos, "용법")
            p.drawString(400, y_pos, "기간")
            y_pos -= 25
            
            # 구분선
            p.setLineWidth(0.5)
            p.line(50, y_pos, width - 50, y_pos)
            y_pos -= 15
            
            p.setFont(font_name, 10)
            for idx, med in enumerate(medications, 1):
                if y_pos < 120:  # 페이지 하단 도달 시 새 페이지
                    p.showPage()
                    y_pos = height - 50
                
                med_name = med.get('name', '')
                dosage = med.get('dosage', '')
                frequency = med.get('frequency', '')
                duration = med.get('duration', '')
                
                # 약물명이 길면 줄바꿈 (약물명 영역은 60~270까지 사용)
                med_name_max_width = 210  # 약물명 최대 너비 (약 270-60)
                med_name_lines = []
                current_line = ""
                for char in med_name:
                    test_line = current_line + char
                    test_width = p.stringWidth(test_line, font_name, 10)
                    if test_width > med_name_max_width and current_line:
                        med_name_lines.append(current_line)
                        current_line = char
                    else:
                        current_line = test_line
                if current_line:
                    med_name_lines.append(current_line)
                
                # 약물명이 없으면 기본값
                if not med_name_lines:
                    med_name_lines = [med_name]
                
                # 약물명 출력 (여러 줄 가능)
                med_name_y = y_pos
                for i, line in enumerate(med_name_lines):
                    if i == 0:
                        p.drawString(60, med_name_y, f"{idx}. {line}")
                    else:
                        p.drawString(80, med_name_y, line)
                    if i < len(med_name_lines) - 1:
                        med_name_y -= 18
                
                # 용량, 용법, 기간은 약물명의 첫 번째 줄과 같은 높이에 출력
                p.drawString(280, y_pos, str(dosage) if dosage else "-")
                p.drawString(340, y_pos, str(frequency) if frequency else "-")
                p.drawString(400, y_pos, str(duration) if duration else "-")
                
                # 약물 간 구분선 (약물명의 마지막 줄 아래에)
                if idx < len(medications):
                    p.setLineWidth(0.3)
                    y_pos = med_name_y - 10  # 약물명 마지막 줄에서 10만큼 아래로
                    p.line(50, y_pos, width - 50, y_pos)
                    y_pos -= 15  # 구분선 아래 여백
                else:
                    # 마지막 약물인 경우 y_pos만 조정
                    y_pos = med_name_y - 10
        else:
            p.setFont(font_name, 11)
            p.drawString(70, y_pos, "처방 약물이 없습니다.")
            y_pos -= 20
        
        # 메모
        if order.notes:
            y_pos -= 20
            p.setFont(font_name, 12)
            p.drawString(50, y_pos, "특이사항")
            y_pos -= 25
            p.setFont(font_name, 10)
            # 메모가 길면 여러 줄로 나누기
            notes_lines = order.notes.split('\n')
            for line in notes_lines[:5]:  # 최대 5줄
                if y_pos < 100:
                    p.showPage()
                    y_pos = height - 50
                p.drawString(70, y_pos, line[:50])  # 최대 50자
                y_pos -= 20
        
        # 하단 서명란
        y_pos = 120
        p.setFont(font_name, 11)
        p.drawString(50, y_pos, "의사 서명: _________________")
        y_pos -= 30
        
        # 발행일 및 병원 인증 정보
        issue_date = datetime.now().strftime('%Y년 %m월 %d일')
        p.drawString(50, y_pos, f"발행일: {issue_date}")
        
        # 우측 하단에 병원 인증 정보
        cert_text = "건양대학교병원 인증"
        cert_width = p.stringWidth(cert_text, font_name, 9)
        p.setFont(font_name, 9)
        p.drawString(width - 50 - cert_width, y_pos, cert_text)
        
        # PDF 완성
        p.showPage()
        p.save()
        
        buffer.seek(0)
        response = HttpResponse(buffer, content_type='application/pdf')
        filename = f"prescription_{order.patient.patient_id}_{order.id}.pdf"
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
    
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """주문 완료 처리"""
        order = self.get_object()
        
        if order.status not in ['processing', 'sent']:
            return Response(
                {'error': '완료할 수 없는 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # 영상 촬영 주문의 경우: 방사선과가 완료해도 '처리중' 상태 유지 (영상의학과 분석 대기)
        # 영상의학과가 분석 결과를 입력해야 진짜 완료
        if order.order_type == 'imaging' and order.target_department == 'radiology':
            # 방사선과가 촬영 및 업로드 완료 → '처리중' 상태 유지 (판독 대기)
            # 단, 이미 'processing' 상태인 경우에만 (처리 시작 후 완료 처리)
            if order.status == 'processing':
                update_order_status(order, 'processing', request.user, '영상 촬영 및 업로드 완료 (판독 대기중)')
            else:
                # 'sent' 상태에서 바로 완료 처리하는 경우는 처리 시작으로 변경
                update_order_status(order, 'processing', request.user, '처리 시작')
            logger.info(f"Imaging order {order.id} completed by radiology, status remains 'processing' (awaiting analysis)")
        elif order.order_type == 'lab_test' and order.target_department == 'lab':
            # 검사 주문의 경우: 검사실이 완료해도 '처리중' 상태 유지 (결과 입력 대기)
            # 검사실이 결과를 입력해야 진짜 완료
            if order.status == 'processing':
                update_order_status(order, 'processing', request.user, '검사 완료 (결과 입력 대기중)')
            else:
                # 'sent' 상태에서 바로 완료 처리하는 경우는 처리 시작으로 변경
                update_order_status(order, 'processing', request.user, '처리 시작')
            logger.info(f"Lab test order {order.id} completed by lab, status remains 'processing' (awaiting result input)")
        elif order.order_type == 'tissue_exam' and order.target_department == 'lab':
            # 조직검사 주문의 경우: 검사실이 완료해도 '처리중' 상태 유지 (병리 이미지 분석 대기)
            # 검사실이 AI 분석을 완료해야 진짜 완료
            if order.status == 'processing':
                update_order_status(order, 'processing', request.user, '조직검사 완료 (병리 이미지 분석 대기중)')
            else:
                # 'sent' 상태에서 바로 완료 처리하는 경우는 처리 시작으로 변경
                update_order_status(order, 'processing', request.user, '처리 시작')
            logger.info(f"Tissue exam order {order.id} completed by lab, status remains 'processing' (awaiting pathology analysis)")
        else:
            # 다른 주문 유형은 일반적으로 완료 처리
            update_order_status(order, 'completed', request.user, '처리 완료')
            logger.info(f"Order {order.id} completed by {request.user}")
        
        serializer = self.get_serializer(order)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """주문 취소"""
        order = self.get_object()
        
        if order.status in ['completed', 'cancelled']:
            return Response(
                {'error': '취소할 수 없는 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        cancel_reason = request.data.get('reason', '')
        update_order_status(order, 'cancelled', request.user, f'취소: {cancel_reason}')
        serializer = self.get_serializer(order)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def revalidate(self, request, pk=None):
        """주문 재검증"""
        order = self.get_object()
        validation_passed, validation_notes = validate_order(order)
        
        return Response({
            'validation_passed': validation_passed,
            'validation_notes': validation_notes,
            'order': self.get_serializer(order).data
        })
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """OCS 통계"""
        today = timezone.now().date()
        
        stats = {
            'total_orders_today': self.queryset.filter(created_at__date=today).count(),
            'orders_by_type': self.queryset.values('order_type').annotate(
                count=Count('id')
            ),
            'orders_by_status': self.queryset.values('status').annotate(
                count=Count('id')
            ),
            'orders_by_priority': self.queryset.values('priority').annotate(
                count=Count('id')
            ),
            'urgent_orders_pending': self.queryset.filter(
                priority__in=['urgent', 'stat', 'emergency'],
                status__in=['pending', 'sent']
            ).count(),
            'validation_failed_orders': self.queryset.filter(
                validation_passed=False
            ).count(),
            # 평균 완료 시간 계산 (추후 구현)
            # 'average_completion_time': self.queryset.filter(
            #     status='completed',
            #     completed_at__isnull=False
            # ).aggregate(
            #     avg_hours=Avg(...)
            # ),
        }
        
        return Response(stats)
    
    @action(detail=False, methods=['get'])
    def my_orders(self, request):
        """내가 생성한 주문 목록"""
        orders = self.queryset.filter(doctor=request.user)
        page = self.paginate_queryset(orders)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(orders, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def pending_orders(self, request):
        """대기 중인 주문 목록 (부서별 자동 필터링)"""
        user = request.user
        user_department = get_department(user.id) if user else None
        
        # 부서별로 자동 필터링
        if user_department == "방사선과" or user_department == "영상의학과":
            # 방사선과/영상의학과: 영상촬영 주문만
            orders = self.get_queryset().filter(
                target_department='radiology',
                order_type='imaging',
                status__in=['pending', 'sent']
            )
        elif user_department == "원무과" or user.is_superuser:
            # 원무과: 모든 대기 주문
            department = request.query_params.get('department')
            if department:
                orders = self.get_queryset().filter(
                    target_department=department,
                    status__in=['pending', 'sent']
                )
            else:
                orders = self.get_queryset().filter(status__in=['pending', 'sent'])
        else:
            # 의사: 자신이 생성한 대기 주문
            orders = self.get_queryset().filter(
                doctor=user,
                status__in=['pending', 'sent']
            )
        
        page = self.paginate_queryset(orders)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(orders, many=True)
        return Response(serializer.data)


class OrderStatusHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    """주문 상태 이력 ViewSet (읽기 전용)"""
    queryset = OrderStatusHistory.objects.select_related('order', 'changed_by').all()
    serializer_class = OrderStatusHistorySerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['order', 'status', 'changed_by']
    ordering_fields = ['created_at']
    ordering = ['-created_at']


class DrugInteractionCheckViewSet(viewsets.ReadOnlyModelViewSet):
    """약물 상호작용 검사 ViewSet (읽기 전용)"""
    queryset = DrugInteractionCheck.objects.select_related('order', 'checked_by').all()
    serializer_class = DrugInteractionCheckSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['order', 'severity']
    ordering_fields = ['checked_at']
    ordering = ['-checked_at']


class AllergyCheckViewSet(viewsets.ReadOnlyModelViewSet):
    """알레르기 검사 ViewSet (읽기 전용)"""
    queryset = AllergyCheck.objects.select_related('order', 'checked_by').all()
    serializer_class = AllergyCheckSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['order', 'has_allergy_risk']
    ordering_fields = ['checked_at']
    ordering = ['-checked_at']


class NotificationViewSet(viewsets.ModelViewSet):
    """알림 ViewSet"""
    serializer_class = NotificationSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['notification_type', 'is_read']
    ordering_fields = ['created_at']
    ordering = ['-created_at', '-is_read']
    
    def get_queryset(self):
        """현재 사용자의 알림만 조회"""
        return Notification.objects.filter(user=self.request.user).select_related(
            'related_order', 'related_order__patient', 'related_order__doctor'
        )
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """알림을 읽음으로 표시"""
        notification = self.get_object()
        notification.mark_as_read()
        serializer = self.get_serializer(notification)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """모든 알림을 읽음으로 표시"""
        count = Notification.objects.filter(
            user=request.user,
            is_read=False
        ).update(is_read=True, read_at=timezone.now())
        return Response({'marked_count': count})
    
    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """읽지 않은 알림 개수"""
        count = Notification.objects.filter(user=request.user, is_read=False).count()
        return Response({'unread_count': count})


class ImagingAnalysisResultViewSet(viewsets.ModelViewSet):
    """영상 분석 결과 ViewSet"""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # 이미지 업로드를 위해 추가
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['order', 'analyzed_by']
    ordering_fields = ['created_at']
    ordering = ['-created_at']
    
    def get_queryset(self):
        """권한별로 필터링"""
        queryset = ImagingAnalysisResult.objects.select_related(
            'order', 'order__patient', 'order__doctor', 'analyzed_by'
        ).all()
        
        user = self.request.user
        user_department = get_department(user.id) if user else None
        
        # 영상의학과는 자신이 분석한 결과만
        if user_department == "영상의학과":
            queryset = queryset.filter(analyzed_by=user)
        # 의사는 자신이 생성한 주문의 분석 결과만
        elif user_department in ["외과", "호흡기내과"]:
            queryset = queryset.filter(order__doctor=user)
        # 원무과는 모든 결과 조회 가능
        elif user_department == "원무과" or user.is_superuser:
            pass  # 모든 결과
        else:
            queryset = queryset.filter(order__doctor=user)
        
        return queryset
    
    def get_serializer_class(self):
        if self.action == 'create':
            return ImagingAnalysisResultCreateSerializer
        return ImagingAnalysisResultSerializer
    
    def perform_create(self, serializer):
        """영상 분석 결과 생성 및 의사에게 알림"""
        order = serializer.validated_data['order']
        
        # 영상의학과만 분석 결과 생성 가능
        user = self.request.user
        user_department = get_department(user.id) if user else None
        
        if user_department != "영상의학과":
            raise PermissionDenied("영상의학과만 영상 분석 결과를 생성할 수 있습니다.")
        
        # heatmap 이미지 파일 가져오기 (여러 장 지원)
        # FormData에서 'heatmap_image' 키로 여러 파일이 전달될 수 있음
        heatmap_image_files = []
        if 'heatmap_image' in self.request.FILES:
            # getlist를 사용하여 같은 키의 모든 파일 가져오기
            files = self.request.FILES.getlist('heatmap_image')
            # 여러 파일 필터링 (heatmap_image_0, heatmap_image_1 등도 허용)
            for key in self.request.FILES.keys():
                if key.startswith('heatmap_image'):
                    files_from_key = self.request.FILES.getlist(key)
                    heatmap_image_files.extend(files_from_key)
            # 중복 제거 (같은 파일이 여러 번 포함될 수 있음)
            seen = set()
            unique_files = []
            for file in heatmap_image_files:
                file_id = (file.name, file.size)
                if file_id not in seen:
                    seen.add(file_id)
                    unique_files.append(file)
            heatmap_image_files = unique_files
        
        # 첫 번째 파일을 메인 히트맵으로 사용 (하위 호환성)
        heatmap_image_file = heatmap_image_files[0] if heatmap_image_files else None
        
        logger.info(f"히트맵 이미지 파일 개수: {len(heatmap_image_files)}")
        
        # 분석 결과 생성 및 알림 (여러 파일 지원)
        analysis = create_imaging_analysis_result(
            order=order,
            analyzed_by=user,
            analysis_result=serializer.validated_data.get('analysis_result', {}),
            findings=serializer.validated_data.get('findings', ''),
            recommendations=serializer.validated_data.get('recommendations', ''),
            confidence_score=serializer.validated_data.get('confidence_score'),
            heatmap_image_file=heatmap_image_file,
            heatmap_image_files=heatmap_image_files  # 여러 파일 전달
        )
        
        return analysis
    
    @action(detail=False, methods=['get'])
    def get_patient_analysis_data(self, request):
        """환자 ID로 히트맵 이미지와 최근 분석 결과 가져오기"""
        from mri_viewer.orthanc_client import OrthancClient
        from mri_viewer.orthanc_views import orthanc_patient_detail
        from rest_framework.request import Request
        
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response({
                'success': False,
                'error': 'patient_id 파라미터가 필요합니다.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Orthanc에서 환자 이미지 가져오기
            # orthanc_patient_detail 함수를 재사용하기 위해 Request 객체 생성
            orthanc_request = Request(request._request)
            orthanc_response = orthanc_patient_detail(orthanc_request, patient_id)
            
            if orthanc_response.status_code != 200:
                return Response({
                    'success': False,
                    'error': 'Orthanc에서 환자 정보를 가져올 수 없습니다.',
                    'details': orthanc_response.data if hasattr(orthanc_response, 'data') else None
                }, status=orthanc_response.status_code)
            
            orthanc_data = orthanc_response.data
            if not orthanc_data.get('success'):
                return Response({
                    'success': False,
                    'error': 'Orthanc에서 환자 정보를 가져올 수 없습니다.'
                }, status=status.HTTP_404_NOT_FOUND)
            
            images = orthanc_data.get('images', [])
            
            # 히트맵 이미지만 필터링
            heatmap_images = [
                img for img in images 
                if 'Heatmap' in img.get('series_description', '') or 
                   'heatmap' in img.get('series_description', '').lower()
            ]
            
            # 최근 히트맵 이미지 (여러 개면 가장 최근 것)
            latest_heatmap = heatmap_images[0] if heatmap_images else None
            
            # 기본 분석 결과 생성 (실제 분석 결과가 있으면 더 정확한 정보 사용)
            analysis_data = {
                'has_heatmap': len(heatmap_images) > 0,
                'heatmap_count': len(heatmap_images),
                'heatmap_images': heatmap_images,
                'latest_heatmap': latest_heatmap,
                'suggested_findings': '',
                'suggested_recommendations': '',
                'suggested_confidence': 0.95
            }
            
            # 히트맵 이미지가 있으면 기본 소견 생성
            if latest_heatmap:
                analysis_data['suggested_findings'] = (
                    f"AI 맘모그래피 분석을 통해 {len(heatmap_images)}개의 히트맵 이미지가 생성되었습니다. "
                    "히트맵을 통해 종양 가능성이 높은 영역을 확인할 수 있습니다."
                )
                analysis_data['suggested_recommendations'] = (
                    "히트맵에서 확인된 이상 소견에 대해 전문의 상담을 권장합니다. "
                    "추가 검사가 필요할 수 있습니다."
                )
            
            return Response({
                'success': True,
                'patient_id': patient_id,
                **analysis_data
            })
            
        except Exception as e:
            logger.error(f"환자 분석 데이터 가져오기 실패: {str(e)}", exc_info=True)
            return Response({
                'success': False,
                'error': f'분석 데이터를 가져오는데 실패했습니다: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PathologyAnalysisResultViewSet(viewsets.ModelViewSet):
    """병리 분석 결과 ViewSet"""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['order', 'analyzed_by']
    ordering_fields = ['created_at']
    ordering = ['-created_at']
    
    def get_queryset(self):
        """권한별로 필터링"""
        queryset = PathologyAnalysisResult.objects.select_related(
            'order', 'order__patient', 'order__doctor', 'analyzed_by'
        ).all()
        
        user = self.request.user
        user_department = get_department(user.id) if user else None
        
        # 검사실은 자신이 분석한 결과만
        if user_department == "검사실":
            queryset = queryset.filter(analyzed_by=user)
        # 의사는 자신이 생성한 주문의 분석 결과만
        elif user_department in ["외과", "호흡기내과"]:
            queryset = queryset.filter(order__doctor=user)
        # 원무과는 모든 결과 조회 가능
        elif user_department == "원무과" or user.is_superuser:
            pass  # 모든 결과
        else:
            queryset = queryset.filter(order__doctor=user)
        
        return queryset
    
    def get_serializer_class(self):
        """액션별로 다른 Serializer 사용"""
        if self.action == 'create':
            return PathologyAnalysisResultCreateSerializer
        return PathologyAnalysisResultSerializer
    
    def perform_create(self, serializer):
        """병리 분석 결과 생성 시 분석자 자동 설정 및 의사에게 알림"""
        order = serializer.validated_data['order']
        
        # 검사실만 분석 결과 생성 가능
        user = self.request.user
        user_department = get_department(user.id) if user else None
        
        if user_department != "검사실" and not user.is_superuser:
            raise PermissionDenied("검사실만 병리 분석 결과를 입력할 수 있습니다.")
        
        # 분석 결과 저장
        pathology_result = serializer.save(analyzed_by=user)
        
        # 주문을 생성한 의사에게 알림 전송
        if order.doctor:
            Notification.objects.create(
                user=order.doctor,
                notification_type='pathology_completed',
                title='병리 분석 완료',
                message=f'{order.patient.name}님의 병리 분석이 완료되었습니다. 결과: {pathology_result.class_name}',
                related_order=order
            )
            logger.info(f"병리 분석 완료 알림 전송: order={order.id}, doctor={order.doctor.username}")
        
        # 주문 상태를 completed로 변경
        if order.status != 'completed':
            order.status = 'completed'
            order.completed_at = timezone.now()
            order.save()
            logger.info(f"주문 상태 변경: order={order.id}, status=completed")


# 약물 검색 및 상호작용 검사 API
class DrugSearchView(APIView):
    """약물 검색 API (외부 FastAPI 서버 프록시)"""
    permission_classes = [AllowAny]  # 약물 검색은 공개 API로 변경
    authentication_classes = [SessionAuthentication]
    
    def get(self, request):
        """약물 검색"""
        query = request.query_params.get('q', '')
        limit = int(request.query_params.get('limit', 20))
        
        logger.info(f"약물 검색 요청: query={query}, limit={limit}")
        
        if not query:
            logger.warning("약물 검색: 검색어가 없습니다")
            return Response(
                {'error': '검색어(q)가 필요합니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            url = f"{DRUG_API_BASE_URL}/drugs/search"
            params = {'q': query, 'limit': limit}
            logger.info(f"FastAPI 서버로 요청 전송: {url}, params={params}")
            
            response = requests.get(
                url,
                params=params,
                timeout=10
            )
            
            logger.info(f"FastAPI 응답 상태: {response.status_code}")
            response.raise_for_status()
            
            data = response.json()
            logger.info(f"약물 검색 성공: {len(data) if isinstance(data, list) else 'non-list'}개 결과")
            return Response(data)
            
        except requests.exceptions.Timeout:
            logger.error(f"약물 검색 타임아웃: {DRUG_API_BASE_URL}")
            return Response(
                {'error': '약물 검색 서버 응답 시간이 초과되었습니다.', 'details': 'FastAPI 서버가 응답하지 않습니다.'},
                status=status.HTTP_504_GATEWAY_TIMEOUT
            )
        except requests.exceptions.ConnectionError as e:
            logger.error(f"약물 검색 연결 오류: {DRUG_API_BASE_URL}, error={e}")
            return Response(
                {'error': '약물 검색 서버에 연결할 수 없습니다.', 'details': f'FastAPI 서버({DRUG_API_BASE_URL})에 연결할 수 없습니다.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        except requests.exceptions.HTTPError as e:
            logger.error(f"약물 검색 HTTP 오류: {e}, status={response.status_code if 'response' in locals() else 'N/A'}")
            return Response(
                {'error': '약물 검색 서버 오류', 'details': str(e)},
                status=status.HTTP_502_BAD_GATEWAY
            )
        except requests.exceptions.RequestException as e:
            logger.error(f"약물 검색 API 오류: {e}", exc_info=True)
            return Response(
                {'error': '약물 검색에 실패했습니다.', 'details': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
            logger.error(f"약물 검색 예상치 못한 오류: {e}", exc_info=True)
            return Response(
                {'error': '약물 검색 중 오류가 발생했습니다.', 'details': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DrugInteractionCheckView(APIView):
    """약물 상호작용 검사 API (외부 FastAPI 서버 프록시)"""
    permission_classes = [AllowAny]  # 약물 상호작용 검사도 공개 API로 변경
    authentication_classes = [SessionAuthentication]
    
    def post(self, request):
        """약물 상호작용 검사"""
        item_seqs = request.data.get('item_seqs', [])
        
        if not item_seqs or len(item_seqs) < 2:
            return Response(
                {'error': '최소 2개 이상의 약품이 필요합니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            response = requests.post(
                f"{DRUG_API_BASE_URL}/drugs/check-interactions",
                json={'item_seqs': item_seqs},
                timeout=15
            )
            response.raise_for_status()
            return Response(response.json())
        except requests.exceptions.RequestException as e:
            logger.error(f"Drug interaction check API error: {e}")
            return Response(
                {'error': '약물 상호작용 검사에 실패했습니다.', 'details': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
