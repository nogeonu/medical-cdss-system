from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.authentication import SessionAuthentication
from django.shortcuts import render
from django.http import JsonResponse
from django.db import models, connections
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import requests
from .models import Patient, LungRecord, LungResult, MedicalRecord
from patients.models import Appointment
from .serializers import (
    PatientSerializer, 
    LungRecordSerializer, 
    LungResultSerializer,
    LungCancerPredictionSerializer,
    PatientRegistrationSerializer,
    PatientUpdateSerializer,
    MedicalRecordSerializer,
    MedicalRecordCreateSerializer,
    MedicalRecordUpdateSerializer
)
import joblib
import os
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from io import BytesIO
import base64

# Flask ML Service URL (로컬 개발)
ML_SERVICE_URL = os.environ.get('ML_SERVICE_URL', 'http://localhost:5002')

@method_decorator(csrf_exempt, name='dispatch')
class PatientViewSet(viewsets.ModelViewSet):
    queryset = Patient.objects.all()
    serializer_class = PatientSerializer
    authentication_classes = []
    permission_classes = [AllowAny]
    lookup_field = 'patient_id'
    lookup_value_regex = '[^/]+'
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'patient_id', 'phone']
    ordering_fields = ['created_at', 'name']
    ordering = ['-created_at']
    
    def get_serializer_class(self):
        """요청에 따라 적절한 시리얼라이저 반환"""
        if self.action == 'update' or self.action == 'partial_update':
            return PatientUpdateSerializer
        elif self.action == 'register':
            return PatientRegistrationSerializer
        return PatientSerializer
    
    def perform_destroy(self, instance):
        """
        환자 삭제 시 관련 데이터도 함께 삭제
        
        주의: patient_user(계정)은 삭제하지 않음
        - 의료 기록은 법적으로 보존 의무가 있음
        - 환자가 재방문 시 과거 기록 참조 가능
        - 계정은 is_active=False로 비활성화만 함
        """
        from django.db import transaction, connections
        
        patient_identifier = instance.patient_id
        patient_pk = instance.id
        print(f"=== 환자 정보 삭제 시작: {patient_identifier} (PK: {patient_pk}) ===")
        
        try:
            with transaction.atomic():
                # Raw SQL을 사용하여 직접 삭제 (테이블 이름 혼동 방지)
                with connections['default'].cursor() as cursor:
                    # 1. LungResult 삭제
                    cursor.execute("""
                        DELETE FROM lung_result 
                        WHERE lung_record_id IN (
                            SELECT id FROM lung_record WHERE patient_id = %s
                        )
                    """, [patient_identifier])
                    lung_result_count = cursor.rowcount
                    print(f"1. LungResult 삭제: {lung_result_count}개")
                    
                    # 2. LungRecord 삭제
                    cursor.execute("""
                        DELETE FROM lung_record WHERE patient_id = %s
                    """, [patient_identifier])
                    lung_record_count = cursor.rowcount
                    print(f"2. LungRecord 삭제: {lung_record_count}개")
                    
                    # 3. MedicalRecord 삭제 (medical_record 테이블)
                    cursor.execute("""
                        DELETE FROM medical_record WHERE patient_id = %s
                    """, [patient_identifier])
                    medical_record_count = cursor.rowcount
                    print(f"3. MedicalRecord 삭제: {medical_record_count}개")
                    
                    # 4. OCS 관련 데이터 삭제 (주문 삭제 전에 하위 데이터 먼저 삭제)
                    # 4-1. 영상 분석 결과 삭제
                    cursor.execute("""
                        DELETE FROM ocs_imaginganalysisresult 
                        WHERE order_id IN (
                            SELECT id FROM ocs_order WHERE patient_id = %s
                        )
                    """, [patient_pk])
                    imaging_analysis_count = cursor.rowcount
                    print(f"4-1. 영상 분석 결과 삭제: {imaging_analysis_count}개")
                    
                    # 4-2. 알림 삭제
                    cursor.execute("""
                        DELETE FROM ocs_notification 
                        WHERE related_order_id IN (
                            SELECT id FROM ocs_order WHERE patient_id = %s
                        )
                    """, [patient_pk])
                    notification_count = cursor.rowcount
                    print(f"4-2. 알림 삭제: {notification_count}개")
                    
                    # 4-3. 주문 상태 이력 삭제
                    cursor.execute("""
                        DELETE FROM ocs_orderstatushistory 
                        WHERE order_id IN (
                            SELECT id FROM ocs_order WHERE patient_id = %s
                        )
                    """, [patient_pk])
                    status_history_count = cursor.rowcount
                    print(f"4-3. 주문 상태 이력 삭제: {status_history_count}개")
                    
                    # 4-4. 약물 상호작용 검사 삭제
                    cursor.execute("""
                        DELETE FROM ocs_druginteractioncheck 
                        WHERE order_id IN (
                            SELECT id FROM ocs_order WHERE patient_id = %s
                        )
                    """, [patient_pk])
                    drug_check_count = cursor.rowcount
                    print(f"4-4. 약물 상호작용 검사 삭제: {drug_check_count}개")
                    
                    # 4-5. 알레르기 검사 삭제
                    cursor.execute("""
                        DELETE FROM ocs_allergycheck 
                        WHERE order_id IN (
                            SELECT id FROM ocs_order WHERE patient_id = %s
                        )
                    """, [patient_pk])
                    allergy_check_count = cursor.rowcount
                    print(f"4-5. 알레르기 검사 삭제: {allergy_check_count}개")
                    
                    # 4-6. OCS 주문 삭제 (ocs_order 테이블)
                    cursor.execute("""
                        DELETE FROM ocs_order WHERE patient_id = %s
                    """, [patient_pk])
                    ocs_order_count = cursor.rowcount
                    print(f"4-6. OCS 주문 삭제: {ocs_order_count}개")
                    
                    # 5. patients_appointment 삭제 (있을 경우)
                    cursor.execute("""
                        DELETE FROM patients_appointment WHERE patient_id = %s
                    """, [patient_pk])
                    appointment_count = cursor.rowcount
                    print(f"5. Appointment 삭제: {appointment_count}개")
                    
                    # 6. patient_user 계정 비활성화 (삭제하지 않음)
                    # 의료 기록 보존을 위해 계정은 유지하되 비활성화만 함
                    cursor.execute("""
                        UPDATE patient_user 
                        SET is_active = 0 
                        WHERE patient_id = %s
                    """, [patient_identifier])
                    user_deactivated = cursor.rowcount
                    print(f"6. PatientUser 비활성화: {user_deactivated}개")
                    
                    # 7. patients_patient 삭제 (Raw SQL로 직접 삭제)
                    cursor.execute("""
                        DELETE FROM patients_patient WHERE patient_id = %s
                    """, [patient_identifier])
                    patient_count = cursor.rowcount
                    print(f"7. Patient 정보 삭제: {patient_count}개")
                
                print(f"=== 환자 정보 삭제 완료: {patient_identifier} ===")
                print(f"※ 참고: 계정(patient_user)은 비활성화만 되었습니다 (의료 기록 보존)")

        except Exception as e:
            error_msg = f"환자 삭제 중 오류 발생: {str(e)}"
            print(error_msg)
            import traceback
            traceback.print_exc()
            # 에러를 다시 발생시켜 클라이언트에 전달
            from rest_framework.exceptions import APIException
            raise APIException(detail=error_msg)
    
    @action(detail=False, methods=['post'])
    def register(self, request):
        """환자 등록 API"""
        serializer = PatientRegistrationSerializer(data=request.data)
        if serializer.is_valid():
            try:
                patient = serializer.save()
                return Response({
                    'patient_id': patient.patient_id,
                    'name': patient.name,
                    'age': patient.age,
                    'gender': patient.gender,
                    'message': '환자가 성공적으로 등록되었습니다.'
                }, status=status.HTTP_201_CREATED)
                
            except Exception as e:
                return Response({
                    'error': f'환자 등록 중 오류가 발생했습니다: {str(e)}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def predict(self, request):
        """폐암 예측 API - Flask ML Service 호출"""
        serializer = LungCancerPredictionSerializer(data=request.data)
        if serializer.is_valid():
            try:
                # patient_id가 제공되면 기존 환자 사용, 아니면 새 환자 생성
                from datetime import datetime
                patient_id = serializer.validated_data.get('patient_id')
                
                if patient_id:
                    # 기존 환자 조회
                    try:
                        patient = Patient.objects.get(patient_id=patient_id)
                        age = patient.age
                    except Patient.DoesNotExist:
                        return Response({
                            'error': f'환자 ID {patient_id}를 찾을 수 없습니다.'
                        }, status=status.HTTP_404_NOT_FOUND)
                else:
                    # 새 환자 생성
                    generated_id = Patient.generate_patient_id()
                    birth_date = serializer.validated_data.get('birth_date')
                    patient = Patient.objects.create(
                        patient_id=generated_id,
                        name=serializer.validated_data.get('name', ''),
                        birth_date=birth_date,
                        gender=serializer.validated_data['gender'],
                        phone=serializer.validated_data.get('phone', ''),
                        address=serializer.validated_data.get('address', ''),
                        emergency_contact=serializer.validated_data.get('emergency_contact', ''),
                        blood_type=serializer.validated_data.get('blood_type', ''),
                        medical_history=serializer.validated_data.get('medical_history', ''),
                        allergies=serializer.validated_data.get('allergies', ''),
                    )
                    patient_id = patient.patient_id
                    age = patient.age or 0
                
                # 2. Flask ML Service를 통해 예측 수행
                ml_response = requests.post(
                    f'{ML_SERVICE_URL}/predict',
                    json={
                        'gender': serializer.validated_data['gender'],
                        'age': age,
                        'smoking': serializer.validated_data['smoking'],
                        'yellow_fingers': serializer.validated_data['yellow_fingers'],
                        'anxiety': serializer.validated_data['anxiety'],
                        'peer_pressure': serializer.validated_data['peer_pressure'],
                        'chronic_disease': serializer.validated_data['chronic_disease'],
                        'fatigue': serializer.validated_data['fatigue'],
                        'allergy': serializer.validated_data['allergy'],
                        'wheezing': serializer.validated_data['wheezing'],
                        'alcohol_consuming': serializer.validated_data['alcohol_consuming'],
                        'coughing': serializer.validated_data['coughing'],
                        'shortness_of_breath': serializer.validated_data['shortness_of_breath'],
                        'swallowing_difficulty': serializer.validated_data['swallowing_difficulty'],
                        'chest_pain': serializer.validated_data['chest_pain'],
                    },
                    timeout=10
                )
                
                if ml_response.status_code != 200:
                    return Response({
                        'error': f'ML 서비스 오류: {ml_response.json().get("error", "알 수 없는 오류")}'
                    }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                
                ml_result = ml_response.json()
                
                # 3. LungRecord에 검사 기록 저장 (raw SQL 사용)
                db_saved = False
                try:
                    now = datetime.now()
                    with connections['default'].cursor() as cursor:
                        sql = """
                            INSERT INTO lung_record (
                                patient_id, gender, age, smoking, yellow_fingers, anxiety, peer_pressure,
                                chronic_disease, fatigue, allergy, wheezing, alcohol_consuming,
                                coughing, shortness_of_breath, swallowing_difficulty, chest_pain,
                                patient_fk_id,
                                created_at, updated_at
                            ) VALUES (
                                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                %s, %s
                            )
                        """
                        cursor.execute(sql, [
                            patient_id,
                            serializer.validated_data['gender'],
                            age,
                            serializer.validated_data['smoking'],
                            serializer.validated_data['yellow_fingers'],
                            serializer.validated_data['anxiety'],
                            serializer.validated_data['peer_pressure'],
                            serializer.validated_data['chronic_disease'],
                            serializer.validated_data['fatigue'],
                            serializer.validated_data['allergy'],
                            serializer.validated_data['wheezing'],
                            serializer.validated_data['alcohol_consuming'],
                            serializer.validated_data['coughing'],
                            serializer.validated_data['shortness_of_breath'],
                            serializer.validated_data['swallowing_difficulty'],
                            serializer.validated_data['chest_pain'],
                            patient.id,
                            now,
                            now,
                        ])
                        lung_record_id = cursor.lastrowid
                        print(f"[폐암 예측] LungRecord 저장 성공: ID={lung_record_id}, patient_id={patient_id}")
                    
                    # 4. LungResult에 검사 결과 저장 (raw SQL 사용)
                    prediction_label = '양성' if ml_result['prediction'] == 'YES' else '음성'
                    with connections['default'].cursor() as cursor:
                        cursor.execute("""
                            INSERT INTO lung_result (lung_record_id, prediction, risk_score, created_at) 
                            VALUES (%s, %s, %s, %s)
                        """, [lung_record_id, prediction_label, ml_result['probability'], now])
                        print(f"[폐암 예측] LungResult 저장 성공: lung_record_id={lung_record_id}")
                    
                    db_saved = True
                except Exception as db_error:
                    print(f"[폐암 예측] DB 저장 실패: {str(db_error)}")
                    # DB 저장 실패해도 예측 결과는 반환
                
                # 7. 결과 반환
                return Response({
                    'patient_id': patient_id,
                    'prediction': ml_result['prediction'],
                    'probability': ml_result['probability'],
                    'risk_level': ml_result['risk_level'],
                    'risk_message': ml_result['risk_message'],
                    'symptoms': ml_result['symptoms'],
                    'external_db_saved': db_saved
                }, status=status.HTTP_201_CREATED)
                
            except requests.exceptions.RequestException as e:
                return Response({
                    'error': f'ML 서비스 연결 실패: {str(e)}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            except Exception as e:
                return Response({
                    'error': f'예측 중 오류가 발생했습니다: {str(e)}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def medical_records(self, request, *args, **kwargs):
        """특정 환자의 진료 기록 조회 API"""
        try:
            lookup_kwarg = self.lookup_url_kwarg or self.lookup_field
            patient_identifier = kwargs.get(lookup_kwarg) or self.kwargs.get(lookup_kwarg)
            if not patient_identifier:
                return Response({'error': '환자 식별자가 필요합니다.'}, status=status.HTTP_400_BAD_REQUEST)
    
            patient = Patient.objects.get(patient_id=patient_identifier)
            medical_records = MedicalRecord.objects.filter(
                patient_id=patient.patient_id
            ).order_by('-reception_start_time')
            serializer = MedicalRecordSerializer(medical_records, many=True)
            return Response({
                'patient': PatientSerializer(patient).data,
                'medical_records': serializer.data
            })
        except Patient.DoesNotExist:
            return Response({'error': '환자를 찾을 수 없습니다.'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({
                'error': f'진료 기록 조회 중 오류가 발생했습니다: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def prediction_candidates(self, request):
        """호흡기내과 진료 이력이 있는 환자 목록"""
        department = request.query_params.get('department', '호흡기내과')
        try:
            with connections['default'].cursor() as cursor:
                cursor.execute(
                    """
                    SELECT DISTINCT p.patient_id
                    FROM patients_patient AS p
                    JOIN medical_record AS m
                        ON m.patient_id COLLATE utf8mb4_unicode_ci = p.patient_id COLLATE utf8mb4_unicode_ci
                    WHERE m.department = %s
                    ORDER BY p.name ASC
                    """,
                    [department],
                )
                patient_ids = [row[0] for row in cursor.fetchall()]

            if not patient_ids:
                return Response({'patients': []})

            patients = Patient.objects.filter(patient_id__in=patient_ids).order_by('name')
            serializer = self.get_serializer(patients, many=True)
            return Response({'patients': serializer.data})
        except Exception as e:
            return Response(
                {'error': f'환자 목록을 불러오는 중 오류가 발생했습니다: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

class LungRecordViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LungRecord.objects.all()
    serializer_class = LungRecordSerializer

class LungResultViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LungResult.objects.all()
    serializer_class = LungResultSerializer
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """폐암 예측 결과 통계"""
        try:
            with connections['default'].cursor() as cursor:
                # 전체 통계
                cursor.execute("SELECT COUNT(*) FROM lung_result")
                total_count = cursor.fetchone()[0]
                
                cursor.execute("SELECT COUNT(*) FROM lung_result WHERE prediction = '양성'")
                positive_count = cursor.fetchone()[0]
                
                cursor.execute("SELECT COUNT(*) FROM lung_result WHERE prediction = '음성'")
                negative_count = cursor.fetchone()[0]
                
                # 성별 통계 (lung_record의 gender 사용)
                cursor.execute("""
                    SELECT COUNT(*) FROM lung_result lr
                    JOIN lung_record lrec ON lr.lung_record_id = lrec.id
                    WHERE lrec.gender IN ('M', '남성', '1')
                """)
                male_total = cursor.fetchone()[0]
                
                cursor.execute("""
                    SELECT COUNT(*) FROM lung_result lr
                    JOIN lung_record lrec ON lr.lung_record_id = lrec.id
                    WHERE lrec.gender IN ('M', '남성', '1') AND lr.prediction = '양성'
                """)
                male_positive = cursor.fetchone()[0]
                
                cursor.execute("""
                    SELECT COUNT(*) FROM lung_result lr
                    JOIN lung_record lrec ON lr.lung_record_id = lrec.id
                    WHERE lrec.gender IN ('M', '남성', '1') AND lr.prediction = '음성'
                """)
                male_negative = cursor.fetchone()[0]
                
                cursor.execute("""
                    SELECT COUNT(*) FROM lung_result lr
                    JOIN lung_record lrec ON lr.lung_record_id = lrec.id
                    WHERE lrec.gender IN ('F', '여성', '0')
                """)
                female_total = cursor.fetchone()[0]
                
                cursor.execute("""
                    SELECT COUNT(*) FROM lung_result lr
                    JOIN lung_record lrec ON lr.lung_record_id = lrec.id
                    WHERE lrec.gender IN ('F', '여성', '0') AND lr.prediction = '양성'
                """)
                female_positive = cursor.fetchone()[0]
                
                cursor.execute("""
                    SELECT COUNT(*) FROM lung_result lr
                    JOIN lung_record lrec ON lr.lung_record_id = lrec.id
                    WHERE lrec.gender IN ('F', '여성', '0') AND lr.prediction = '음성'
                """)
                female_negative = cursor.fetchone()[0]
                
                # 평균 위험도
                cursor.execute("SELECT AVG(risk_score) FROM lung_result")
                avg_risk_score = cursor.fetchone()[0] or 0
            
            return Response({
                'total_patients': total_count,
                'positive_patients': positive_count,
                'negative_patients': negative_count,
                'positive_rate': round((positive_count / total_count * 100), 2) if total_count > 0 else 0,
                'gender_statistics': {
                    'male': {
                        'total': male_total,
                        'positive': male_positive,
                        'negative': male_negative,
                        'positive_rate': round((male_positive / male_total * 100), 2) if male_total > 0 else 0
                    },
                    'female': {
                        'total': female_total,
                        'positive': female_positive,
                        'negative': female_negative,
                        'positive_rate': round((female_positive / female_total * 100), 2) if female_total > 0 else 0
                    }
                },
                'average_risk_score': round(float(avg_risk_score), 2)
            })
        except Exception as e:
            return Response({
                'error': f'통계 조회 중 오류가 발생했습니다: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

def visualization_data(request):
    """시각화 데이터 API"""
    try:
        # raw SQL로 데이터 조회 (lung_record의 gender, age 사용)
        with connections['default'].cursor() as cursor:
            cursor.execute("""
                SELECT lr.prediction, lr.risk_score, lrec.gender, lrec.age, lr.created_at
                FROM lung_result lr
                JOIN lung_record lrec ON lr.lung_record_id = lrec.id
            """)
            rows = cursor.fetchall()
        
        if not rows:
            return JsonResponse({'error': '데이터가 없습니다.'}, status=404)
        
        # 데이터 준비
        data = []
        for row in rows:
            prediction, risk_score, gender, age, created_at = row
            data.append({
                'gender': gender,
                'age': age,
                'prediction': 'YES' if prediction == '양성' else 'NO',
                'probability': float(risk_score) / 100 if risk_score else 0,
                'created_at': created_at.isoformat() if created_at else None
            })
        
        # 통계 계산
        df = pd.DataFrame(data)
        
        # 예측 결과 분포
        prediction_counts = df['prediction'].value_counts()
        
        # 성별 분포
        df['gender_label'] = df['gender'].apply(lambda x: '남성' if x in ['M', '남성', '1'] else '여성')
        gender_prediction = pd.crosstab(df['gender_label'], df['prediction'])
        
        # 연령대별 분포
        df['age_decade'] = (df['age'] // 10) * 10
        age_prediction = pd.crosstab(df['age_decade'], df['prediction'])
        
        # DataFrame을 dict로 변환 (JSON 직렬화 가능한 형식)
        gender_dict = gender_prediction.to_dict('index')
        age_dict = age_prediction.to_dict('index')
        
        return JsonResponse({
            'prediction_distribution': prediction_counts.to_dict(),
            'gender_distribution': gender_dict,
            'age_distribution': age_dict,
            'total_patients': len(df),
            'average_age': round(df['age'].mean(), 1),
            'average_risk': round(df['probability'].mean() * 100, 2)
        })
        
    except Exception as e:
        return JsonResponse({
            'error': f'시각화 데이터 생성 중 오류가 발생했습니다: {str(e)}'
        }, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class MedicalRecordViewSet(viewsets.ModelViewSet):
    queryset = MedicalRecord.objects.all()
    serializer_class = MedicalRecordSerializer
    authentication_classes = []
    permission_classes = [AllowAny]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return MedicalRecordCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return MedicalRecordUpdateSerializer
        return MedicalRecordSerializer
    
    def create(self, request):
        """진료기록 생성 API"""
        serializer = MedicalRecordCreateSerializer(data=request.data)
        if serializer.is_valid():
            try:
                from django.contrib.auth.models import User
                
                patient = Patient.objects.get(patient_id=serializer.validated_data['patient_id'])
                
                # 담당 의사 조회
                doctor = None
                doctor_id = serializer.validated_data.get('doctor_id')
                if doctor_id:
                    try:
                        doctor = User.objects.get(id=doctor_id)
                    except User.DoesNotExist:
                        return Response({
                            'error': '존재하지 않는 의사입니다.'
                        }, status=status.HTTP_400_BAD_REQUEST)
                
                # managed=False이므로 raw SQL 사용
                from django.utils import timezone
                now = timezone.now()
                with connections['default'].cursor() as cursor:
                    sql = """
                        INSERT INTO medical_record (
                            patient_id, patient_fk_id, name, department, doctor_fk_id,
                            status, notes, reception_start_time, is_treatment_completed
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                    """
                    cursor.execute(sql, [
                        serializer.validated_data['patient_id'],
                        patient.id,
                        serializer.validated_data['name'],
                        serializer.validated_data['department'],
                        doctor.id if doctor else None,
                        '접수완료',
                        serializer.validated_data.get('notes', ''),
                        now,
                        False,
                    ])
                    record_id = cursor.lastrowid
                
                return Response({
                    'message': '진료기록이 성공적으로 생성되었습니다.',
                    'record_id': record_id
                }, status=status.HTTP_201_CREATED)
            except Patient.DoesNotExist:
                return Response({
                    'error': '존재하지 않는 환자입니다.'
                }, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                return Response({
                    'error': f'진료기록 생성 중 오류가 발생했습니다: {str(e)}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def complete_treatment(self, request, pk=None):
        """진료 완료 처리 API"""
        try:
            medical_record = self.get_object()
            
            # 프론트엔드에서 전송된 추가 정보
            examination_result = request.data.get('examination_result', '')
            treatment_note = request.data.get('treatment_note', '')
            
            # notes 업데이트 (기존 notes + 검사 결과 + 진료 메모)
            updated_notes = medical_record.notes or ''
            if examination_result or treatment_note:
                if updated_notes:
                    updated_notes += '\n'
                if examination_result:
                    updated_notes += f'검사 결과: {examination_result}'
                if examination_result and treatment_note:
                    updated_notes += '\n'
                if treatment_note:
                    updated_notes += f'진료 메모: {treatment_note}'
            
            # managed=False이므로 raw SQL 사용
            from django.utils import timezone
            now = timezone.now()
            with connections['default'].cursor() as cursor:
                cursor.execute("""
                    UPDATE medical_record 
                    SET status = %s, 
                        is_treatment_completed = %s, 
                        treatment_end_time = %s,
                        notes = %s
                    WHERE id = %s
                """, ['진료완료', True, now, updated_notes, pk])
            
            return Response({
                'message': '진료가 완료되었습니다.',
                'treatment_end_time': now
            }, status=status.HTTP_200_OK)
        except MedicalRecord.DoesNotExist:
            return Response({
                'error': '진료기록을 찾을 수 없습니다.'
            }, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({
                'error': f'진료 완료 처리 중 오류가 발생했습니다: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['get'])
    def by_status(self, request):
        """상태별 진료기록 조회 API"""
        status_filter = request.query_params.get('status')
        if status_filter:
            queryset = self.queryset.filter(status=status_filter)
        else:
            queryset = self.queryset
        
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def completed_today(self, request):
        """오늘 완료된 진료기록 조회 API"""
        from django.utils import timezone
        today = timezone.now().date()
        queryset = self.queryset.filter(
            is_treatment_completed=True,
            treatment_end_time__date=today
        )
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def waiting_patients(self, request):
        """대기 중인 환자 목록 조회 API (순번 기준)"""
        # 접수완료 상태의 환자들을 접수시간 순으로 정렬
        queryset = self.queryset.filter(
            status='접수완료'
        ).order_by('reception_start_time')
        
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def search_patients(self, request):
        """환자 검색 API - 전체 환자 검색 (진료접수용)"""
        query = request.query_params.get('query', request.query_params.get('q', '')).strip()
        if not query:
            return Response({'patients': []})
        
        try:
            patients = Patient.objects.filter(
                name__icontains=query
            ).order_by('name')[:10]
            
            print(f"검색어: '{query}', 환자 결과: {patients.count()}명")
            
            serializer = PatientSerializer(patients, many=True)
            return Response({'patients': serializer.data})
        except Exception as e:
            print(f"환자 검색 오류: {e}")
            return Response({'patients': [], 'error': str(e)})
    
    @action(detail=False, methods=['get'])
    def dashboard_statistics(self, request):
        """대시보드 통계 API - medical_record + Appointment 테이블 기반"""
        from eventeye.doctor_utils import get_department
        from django.utils import timezone
        
        try:
            # managed=False이므로 raw SQL 사용
            with connections['default'].cursor() as cursor:
                # 총 진료 기록 수
                cursor.execute("SELECT COUNT(*) FROM medical_record")
                total_records = cursor.fetchone()[0]
                
                # 대기 중인 환자 수 (접수완료 상태)
                cursor.execute("SELECT COUNT(*) FROM medical_record WHERE status = '접수완료'")
                waiting_count = cursor.fetchone()[0]
                
                # 진료 완료 환자 수
                cursor.execute("SELECT COUNT(*) FROM medical_record WHERE is_treatment_completed = 1")
                completed_count = cursor.fetchone()[0]
                
            # 오늘 예약 수 (Appointment 모델 사용, 부서별 필터링)
                today = timezone.now().date()
            today_appointments = Appointment.objects.filter(
                start_time__date=today
            ).exclude(status='cancelled')
            
            # 부서별 필터링
            # 원무과 또는 superuser: 모든 부서 예약 합계 표시
            # 외과: 외과 예약만 표시
            # 호흡기내과: 호흡기내과 예약만 표시
            if request.user.is_authenticated:
                user_department = get_department(request.user.id)
                # 원무과나 superuser가 아니면 자신의 부서 예약만 필터링
                if user_department and user_department != "원무과" and not request.user.is_superuser:
                    today_appointments = today_appointments.filter(doctor_department=user_department)
                    logger.info(f"대시보드 통계: {user_department} 부서 필터링 적용, 오늘 예약 수: {today_appointments.count()}")
            
            today_exams = today_appointments.count()
            
            return Response({
                'total_records': total_records,
                'waiting_count': waiting_count,
                'completed_count': completed_count,
                'today_exams': today_exams,
            })
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"대시보드 통계 오류: {e}", exc_info=True)
            return Response({
                'error': f'통계 조회 중 오류가 발생했습니다: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)