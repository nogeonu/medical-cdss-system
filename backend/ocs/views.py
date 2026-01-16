"""
OCS ViewSet 및 API 엔드포인트
"""
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Count, Q, Avg
from django.utils import timezone
from datetime import timedelta

from .models import Order, OrderStatusHistory, DrugInteractionCheck, AllergyCheck, Notification, ImagingAnalysisResult
from .serializers import (
    OrderSerializer, OrderCreateSerializer, OrderListSerializer,
    OrderStatusHistorySerializer, DrugInteractionCheckSerializer, AllergyCheckSerializer,
    NotificationSerializer, ImagingAnalysisResultSerializer, ImagingAnalysisResultCreateSerializer
)
from .services import validate_order, update_order_status, check_drug_interactions, check_allergies, create_imaging_analysis_result
from eventeye.doctor_utils import get_department
import logging

logger = logging.getLogger(__name__)


class OrderViewSet(viewsets.ModelViewSet):
    """OCS 주문 관리 ViewSet"""
    queryset = Order.objects.select_related('patient', 'doctor').prefetch_related(
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
            
            # 주문 검증 (약물 상호작용, 알레르기)
            validate_order(order)
            
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
            
        elif order.target_department == 'pharmacy':
            # 약국으로 전달
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
        
        # heatmap 이미지 파일 가져오기 (request.FILES에서)
        heatmap_image_file = self.request.FILES.get('heatmap_image', None)
        
        # 분석 결과 생성 및 알림
        analysis = create_imaging_analysis_result(
            order=order,
            analyzed_by=user,
            analysis_result=serializer.validated_data.get('analysis_result', {}),
            findings=serializer.validated_data.get('findings', ''),
            recommendations=serializer.validated_data.get('recommendations', ''),
            confidence_score=serializer.validated_data.get('confidence_score'),
            heatmap_image_file=heatmap_image_file
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
