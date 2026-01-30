import csv
import io
from datetime import datetime
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Q
from .models import LabTest, RNATest
from .serializers import LabTestSerializer, RNATestSerializer
from patients.models import Patient
import logging
import requests
import os

logger = logging.getLogger(__name__)

# Flask ML Service URL (pCR 예측용)
ML_SERVICE_URL = os.environ.get('ML_SERVICE_URL', 'http://localhost:5002')


class LabTestViewSet(viewsets.ModelViewSet):
    queryset = LabTest.objects.all()
    serializer_class = LabTestSerializer
    permission_classes = [permissions.AllowAny]
    
    def get_queryset(self):
        queryset = LabTest.objects.all()
        search = self.request.query_params.get('search', None)
        
        if search:
            queryset = queryset.filter(
                Q(patient__patient_id__icontains=search) |
                Q(patient__name__icontains=search) |
                Q(accession_number__icontains=search)
            )
        
        return queryset
    
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_csv(self, request):
        """혈액검사 CSV 파일 업로드"""
        if 'file' not in request.FILES:
            return Response(
                {'error': 'CSV 파일이 필요합니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        csv_file = request.FILES['file']
        
        if not csv_file.name.endswith('.csv'):
            return Response(
                {'error': 'CSV 파일만 업로드 가능합니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # request data에서 patient_id 가져오기 (선택한 환자 정보)
        # FormData의 경우 request.POST에서 가져와야 함 (MultiPartParser 사용 시)
        patient_id_from_request = request.POST.get('patient_id', '').strip()
        if not patient_id_from_request and hasattr(request, 'data'):
            patient_id_from_request = request.data.get('patient_id', '').strip()
        
        # order_id가 제공된 경우 OCS 주문에서 환자 정보 가져오기
        order_id_from_request = request.POST.get('order_id', '').strip()
        if not order_id_from_request and hasattr(request, 'data'):
            order_id_from_request = request.data.get('order_id', '').strip()
        
        if order_id_from_request and not patient_id_from_request:
            try:
                from ocs.models import Order
                order = Order.objects.select_related('patient').get(id=order_id_from_request)
                patient_id_from_request = order.patient.patient_id
                logger.info(f"Lab test upload - patient_id from order {order_id_from_request}: '{patient_id_from_request}'")
            except Exception as e:
                logger.warning(f"Failed to get patient_id from order {order_id_from_request}: {e}")
        
        logger.info(f"Lab test upload - patient_id_from_request: '{patient_id_from_request}', POST keys: {list(request.POST.keys())}, POST values: {dict(request.POST) if request.POST else 'N/A'}")
        
        try:
            decoded_file = csv_file.read().decode('utf-8')
            io_string = io.StringIO(decoded_file)
            reader = csv.DictReader(io_string)
            
            created_count = 0
            updated_count = 0
            errors = []
            
            for row in reader:
                try:
                    # CSV에서 patient_id를 가져오거나, request에서 가져온 값 사용
                    patient_id = row.get('patient_id', '').strip() or patient_id_from_request
                    
                    if not patient_id:
                        error_detail = f"CSV 파일에 patient_id 열이 없고, request에서도 patient_id를 받지 못했습니다."
                        if patient_id_from_request:
                            error_detail += f" (request patient_id: '{patient_id_from_request}')"
                        csv_keys = list(row.keys())[:10]  # 처음 10개 키만 표시
                        errors.append(f"환자 ID가 없습니다. {error_detail} CSV 열: {csv_keys}")
                        logger.error(f"Patient ID missing - CSV keys: {list(row.keys())}, request patient_id: '{patient_id_from_request}'")
                        continue
                    
                    try:
                        patient = Patient.objects.get(patient_id=patient_id)
                    except Patient.DoesNotExist:
                        errors.append(f"환자를 찾을 수 없습니다: {patient_id}")
                        continue
                    
                    test_date = datetime.strptime(row.get('test_date', ''), '%Y-%m-%d').date()
                    accession_number = f"L{test_date.strftime('%Y%m%d')}-{patient_id}"
                    
                    lab_test, created = LabTest.objects.update_or_create(
                        accession_number=accession_number,
                        defaults={
                            'patient': patient,
                            'test_date': test_date,
                            'result_date': test_date,
                            'wbc': float(row.get('wbc', 0)) if row.get('wbc') else None,
                            'wbc_unit': row.get('wbc_unit', 'x10^9/L'),
                            'hemoglobin': float(row.get('hemoglobin', 0)) if row.get('hemoglobin') else None,
                            'hemoglobin_unit': row.get('hemoglobin_unit', 'g/dL'),
                            'neutrophils': float(row.get('neutrophils', 0)) if row.get('neutrophils') else None,
                            'neutrophils_unit': row.get('neutrophils_unit', 'x10^9/L'),
                            'lymphocytes': float(row.get('lymphocytes', 0)) if row.get('lymphocytes') else None,
                            'lymphocytes_unit': row.get('lymphocytes_unit', 'x10^9/L'),
                            'platelets': float(row.get('platelets', 0)) if row.get('platelets') else None,
                            'platelets_unit': row.get('platelets_unit', 'x10^9/L'),
                            'nlr': float(row.get('nlr', 0)) if row.get('nlr') else None,
                            'crp': float(row.get('crp', 0)) if row.get('crp') else None,
                            'crp_unit': row.get('crp_unit', 'mg/L'),
                            'ldh': float(row.get('ldh', 0)) if row.get('ldh') else None,
                            'ldh_unit': row.get('ldh_unit', 'U/L'),
                            'albumin': float(row.get('albumin', 0)) if row.get('albumin') else None,
                            'albumin_unit': row.get('albumin_unit', 'g/dL'),
                        }
                    )
                    
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1
                        
                except Exception as e:
                    errors.append(f"행 처리 오류: {str(e)} - {row}")
                    logger.error(f"Lab test upload error: {e}", exc_info=True)
            
            return Response({
                'success': True,
                'created': created_count,
                'updated': updated_count,
                'errors': errors
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            logger.error(f"CSV upload error: {e}", exc_info=True)
            return Response(
                {'error': f'CSV 파일 처리 중 오류가 발생했습니다: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class RNATestViewSet(viewsets.ModelViewSet):
    queryset = RNATest.objects.all()
    serializer_class = RNATestSerializer
    permission_classes = [permissions.AllowAny]
    
    def get_queryset(self):
        queryset = RNATest.objects.all()
        search = self.request.query_params.get('search', None)
        
        if search:
            queryset = queryset.filter(
                Q(patient__patient_id__icontains=search) |
                Q(patient__name__icontains=search) |
                Q(accession_number__icontains=search)
            )
        
        return queryset
    
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_csv(self, request):
        """RNA 검사 CSV 파일 업로드"""
        if 'file' not in request.FILES:
            return Response(
                {'error': 'CSV 파일이 필요합니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        csv_file = request.FILES['file']
        
        if not csv_file.name.endswith('.csv'):
            return Response(
                {'error': 'CSV 파일만 업로드 가능합니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # request data에서 patient_id 가져오기 (선택한 환자 정보)
        # FormData의 경우 request.POST에서 가져와야 함 (MultiPartParser 사용 시)
        patient_id_from_request = request.POST.get('patient_id', '').strip()
        if not patient_id_from_request and hasattr(request, 'data'):
            patient_id_from_request = request.data.get('patient_id', '').strip()
        
        # order_id가 제공된 경우 OCS 주문에서 환자 정보 가져오기
        order_id_from_request = request.POST.get('order_id', '').strip()
        if not order_id_from_request and hasattr(request, 'data'):
            order_id_from_request = request.data.get('order_id', '').strip()
        
        if order_id_from_request and not patient_id_from_request:
            try:
                from ocs.models import Order
                order = Order.objects.select_related('patient').get(id=order_id_from_request)
                patient_id_from_request = order.patient.patient_id
                logger.info(f"RNA upload - patient_id from order {order_id_from_request}: '{patient_id_from_request}'")
            except Exception as e:
                logger.warning(f"Failed to get patient_id from order {order_id_from_request}: {e}")
        
        logger.info(f"RNA upload - patient_id_from_request: '{patient_id_from_request}', POST keys: {list(request.POST.keys())}, POST values: {dict(request.POST) if request.POST else 'N/A'}")
        
        try:
            decoded_file = csv_file.read().decode('utf-8')
            io_string = io.StringIO(decoded_file)
            reader = csv.DictReader(io_string)
            
            created_count = 0
            updated_count = 0
            errors = []
            
            for row in reader:
                try:
                    # CSV에서 patient_id를 가져오거나, request에서 가져온 값 사용
                    patient_id = row.get('patient_id', '').strip() or patient_id_from_request
                    
                    if not patient_id:
                        error_detail = f"CSV 파일에 patient_id 열이 없고, request에서도 patient_id를 받지 못했습니다."
                        if patient_id_from_request:
                            error_detail += f" (request patient_id: '{patient_id_from_request}')"
                        csv_keys = list(row.keys())[:10]  # 처음 10개 키만 표시
                        errors.append(f"환자 ID가 없습니다. {error_detail} CSV 열: {csv_keys}")
                        logger.error(f"Patient ID missing - CSV keys: {list(row.keys())}, request patient_id: '{patient_id_from_request}'")
                        continue
                    
                    try:
                        patient = Patient.objects.get(patient_id=patient_id)
                    except Patient.DoesNotExist:
                        errors.append(f"환자를 찾을 수 없습니다: {patient_id}")
                        continue
                    
                    from datetime import date
                    test_date = date.today()
                    accession_number = f"R{test_date.strftime('%Y%m%d')}-{patient_id}"
                    
                    # 27개 유전자 발현값 추출
                    gene_data = {}
                    gene_names = ['CXCL13', 'CD8A', 'CCR7', 'C1QA', 'LY9', 'CXCL10', 'CXCL9', 'STAT1',
                                  'CCND1', 'MKI67', 'TOP2A', 'BRCA1', 'RAD51', 'PRKDC', 'POLD3', 'POLB',
                                  'LIG1', 'ERBB2', 'ESR1', 'PGR', 'ARAF', 'PIK3CA', 'AKT1', 'MTOR',
                                  'TP53', 'PTEN', 'MYC']
                    
                    for gene in gene_names:
                        value = row.get(gene, '').strip() if row.get(gene) else ''
                        try:
                            gene_data[gene] = float(value) if value else None
                        except (ValueError, TypeError) as e:
                            logger.warning(f"Gene {gene} 값 변환 실패: {value}, 오류: {e}")
                            gene_data[gene] = None
                    
                    rna_test, created = RNATest.objects.update_or_create(
                        accession_number=accession_number,
                        defaults={
                            'patient': patient,
                            'test_date': test_date,
                            'result_date': test_date,
                            **gene_data
                        }
                    )
                    
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1
                        
                except Exception as e:
                    error_msg = f"행 처리 오류: {str(e)}"
                    if hasattr(e, '__cause__') and e.__cause__:
                        error_msg += f" (원인: {str(e.__cause__)})"
                    errors.append(f"{error_msg} - 행 데이터: {dict(row)}")
                    logger.error(f"RNA test upload error: {e}", exc_info=True)
            
            return Response({
                'success': True,
                'created': created_count,
                'updated': updated_count,
                'errors': errors
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            logger.error(f"CSV upload error: {e}", exc_info=True)
            return Response(
                {'error': f'CSV 파일 처리 중 오류가 발생했습니다: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['post'])
    def predict_pcr(self, request, pk=None):
        """pCR 예측 수행 - Flask ML Service 호출"""
        try:
            rna_test = self.get_object()
            
            # 유전자 발현값 추출
            gene_values = {
                'CXCL13': rna_test.CXCL13 or 0, 'CD8A': rna_test.CD8A or 0, 'CCR7': rna_test.CCR7 or 0,
                'C1QA': rna_test.C1QA or 0, 'LY9': rna_test.LY9 or 0, 'CXCL10': rna_test.CXCL10 or 0,
                'CXCL9': rna_test.CXCL9 or 0, 'STAT1': rna_test.STAT1 or 0, 'CCND1': rna_test.CCND1 or 0,
                'MKI67': rna_test.MKI67 or 0, 'TOP2A': rna_test.TOP2A or 0, 'BRCA1': rna_test.BRCA1 or 0,
                'RAD51': rna_test.RAD51 or 0, 'PRKDC': rna_test.PRKDC or 0, 'POLD3': rna_test.POLD3 or 0,
                'POLB': rna_test.POLB or 0, 'LIG1': rna_test.LIG1 or 0, 'ERBB2': rna_test.ERBB2 or 0,
                'ESR1': rna_test.ESR1 or 0, 'PGR': rna_test.PGR or 0, 'ARAF': rna_test.ARAF or 0,
                'PIK3CA': rna_test.PIK3CA or 0, 'AKT1': rna_test.AKT1 or 0, 'MTOR': rna_test.MTOR or 0,
                'TP53': rna_test.TP53 or 0, 'PTEN': rna_test.PTEN or 0, 'MYC': rna_test.MYC or 0
            }
            
            # 환자 정보
            from datetime import date
            age = (date.today() - rna_test.patient.birth_date).days // 365 if rna_test.patient.birth_date else 0
            gender_display = '여성 (Female)' if rna_test.patient.gender == 'F' else '남성 (Male)'
            
            patient_info = {
                'patient_id': rna_test.patient.patient_id,
                'name': rna_test.patient.name,
                'age': age,
                'gender': gender_display,
                'test_date': str(rna_test.test_date)
            }
            
            # Flask ML Service를 통해 pCR 예측 수행
            logger.info(f"🚀 Flask ML Service 호출: {ML_SERVICE_URL}/predict_pcr")
            ml_response = requests.post(
                f'{ML_SERVICE_URL}/predict_pcr',
                json={
                    'gene_values': gene_values,
                    'patient_info': patient_info
                },
                timeout=30
            )
            
            if ml_response.status_code != 200:
                error_msg = ml_response.json().get('error', '알 수 없는 오류') if ml_response.status_code != 503 else 'pCR 예측 모델이 로드되지 않았습니다.'
                logger.error(f"❌ Flask ML Service 오류: {ml_response.status_code} - {error_msg}")
                return Response(
                    {'error': f'ML 서비스 오류: {error_msg}'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE if ml_response.status_code == 503 else status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            ml_result = ml_response.json()
            
            return Response({
                'success': True,
                'probability': ml_result['probability'],
                'prediction': ml_result['prediction'],
                'image': ml_result['image'],
                'top_genes': ml_result['top_genes'],
                'pathway_scores': ml_result['pathway_scores']
            })
            
        except requests.exceptions.Timeout:
            logger.error("❌ Flask ML Service 타임아웃")
            return Response(
                {'error': 'ML 서비스 응답 시간이 초과되었습니다.'},
                status=status.HTTP_504_GATEWAY_TIMEOUT
            )
        except requests.exceptions.ConnectionError:
            logger.error(f"❌ Flask ML Service 연결 실패: {ML_SERVICE_URL}")
            return Response(
                {'error': f'ML 서비스에 연결할 수 없습니다. (URL: {ML_SERVICE_URL})'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        except Exception as pcr_error:
            logger.error(f"pCR prediction error: {pcr_error}", exc_info=True)
            return Response(
                {'error': f'pCR 예측 중 오류가 발생했습니다: {str(pcr_error)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
