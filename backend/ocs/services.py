"""
OCS 서비스 로직
"""
from django.utils import timezone
from django.db.models import Q
from django.conf import settings
from .models import Order, DrugInteractionCheck, AllergyCheck, OrderStatusHistory, Notification, ImagingAnalysisResult
from patients.models import Patient
from eventeye.doctor_utils import get_department
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


# 약물 상호작용 데이터 (임시: 하드코딩)
# TODO: 실제 운영 환경에서는 DB 모델(Drug, DrugInteraction) 또는 외부 API 사용 필요
# 참고: ocs/drug_api_integration.md 파일 참조
DRUG_INTERACTIONS = {
    'warfarin': {
        'aspirin': {'severity': 'severe', 'description': '출혈 위험 증가'},
        'ibuprofen': {'severity': 'moderate', 'description': '출혈 위험 증가'},
    },
    'digoxin': {
        'furosemide': {'severity': 'moderate', 'description': '디곡신 독성 위험'},
    },
    # 더 많은 상호작용 데이터 추가 가능
    # 실제 운영 시에는 Drug, DrugInteraction 모델 사용 권장
}


def check_drug_interactions(order):
    """약물 상호작용 체크"""
    if order.order_type != 'prescription':
        return None
    
    medications = order.order_data.get('medications', [])
    if not medications:
        return None
    
    # 약물명 추출
    drug_names = [med.get('name', '').lower() for med in medications if med.get('name')]
    
    interactions = []
    checked_drugs = []
    
    for i, drug1 in enumerate(drug_names):
        checked_drugs.append(drug1)
        for drug2 in drug_names[i+1:]:
            # 양방향 체크
            if drug1 in DRUG_INTERACTIONS and drug2 in DRUG_INTERACTIONS[drug1]:
                interaction = DRUG_INTERACTIONS[drug1][drug2]
                interactions.append({
                    'drug1': drug1,
                    'drug2': drug2,
                    'severity': interaction['severity'],
                    'description': interaction['description']
                })
            elif drug2 in DRUG_INTERACTIONS and drug1 in DRUG_INTERACTIONS[drug2]:
                interaction = DRUG_INTERACTIONS[drug2][drug1]
                interactions.append({
                    'drug1': drug2,
                    'drug2': drug1,
                    'severity': interaction['severity'],
                    'description': interaction['description']
                })
    
    if interactions:
        # 가장 심각한 상호작용의 심각도 결정
        severities = [inter['severity'] for inter in interactions]
        if 'severe' in severities:
            severity = 'severe'
        elif 'moderate' in severities:
            severity = 'moderate'
        else:
            severity = 'mild'
        
        return DrugInteractionCheck.objects.create(
            order=order,
            checked_drugs=checked_drugs,
            interactions=interactions,
            severity=severity
        )
    
    return None


def check_allergies(order):
    """알레르기 체크"""
    patient = order.patient
    
    # 환자 알레르기 정보 가져오기
    patient_allergies = []
    if patient.allergies:
        # 알레르기 정보를 파싱 (예: "페니실린, 아스피린" 형식)
        allergies_text = patient.allergies.strip()
        if allergies_text:
            patient_allergies = [a.strip().lower() for a in allergies_text.split(',')]
    
    if not patient_allergies:
        # 알레르기 없으면 체크 불필요
        return None
    
    # 주문 항목 추출
    order_items = []
    warnings = []
    has_risk = False
    
    if order.order_type == 'prescription':
        medications = order.order_data.get('medications', [])
        for med in medications:
            med_name = med.get('name', '').lower()
            order_items.append(med_name)
            
            # 알레르기 체크
            for allergy in patient_allergies:
                if allergy in med_name or med_name in allergy:
                    warnings.append({
                        'item': med_name,
                        'allergy': allergy,
                        'description': f'{med_name}은(는) 환자의 알레르기 항목({allergy})과 관련이 있습니다.'
                    })
                    has_risk = True
    
    elif order.order_type == 'lab_test':
        test_items = order.order_data.get('test_items', [])
        for test in test_items:
            test_name = test.get('name', '').lower()
            order_items.append(test_name)
            
            # 검사 항목 중 알레르기 관련 체크 (예: 조영제 검사)
            for allergy in patient_allergies:
                if 'contrast' in test_name and allergy in ['iodine', 'iodinated']:
                    warnings.append({
                        'item': test_name,
                        'allergy': allergy,
                        'description': f'{test_name} 검사는 조영제를 사용하며, 환자가 요오드 알레르기가 있습니다.'
                    })
                    has_risk = True
    
    if warnings or has_risk:
        return AllergyCheck.objects.create(
            order=order,
            patient_allergies=patient_allergies,
            order_items=order_items,
            warnings=warnings,
            has_allergy_risk=has_risk
        )
    
    return None


def validate_order(order):
    """주문 검증 (약물 상호작용 + 알레르기)"""
    validation_passed = True
    validation_notes = []
    
    # 약물 상호작용 체크
    if order.order_type == 'prescription':
        interaction_check = check_drug_interactions(order)
        if interaction_check and interaction_check.severity == 'severe':
            validation_passed = False
            validation_notes.append(f"심각한 약물 상호작용이 발견되었습니다: {interaction_check.interactions}")
        elif interaction_check:
            validation_notes.append(f"약물 상호작용 경고: {interaction_check.interactions}")
    
    # 알레르기 체크
    allergy_check = check_allergies(order)
    if allergy_check and allergy_check.has_allergy_risk:
        validation_passed = False
        validation_notes.append(f"알레르기 위험이 발견되었습니다: {allergy_check.warnings}")
    
    order.validation_passed = validation_passed
    order.validation_notes = '\n'.join(validation_notes)
    order.save()
    
    return validation_passed, validation_notes


def create_notification(user, notification_type, title, message, related_order=None, related_resource_type=None, related_resource_id=None):
    """알림 생성"""
    # DB 제약 조건: related_resource_type과 related_resource_id는 NOT NULL이므로 None이면 빈 문자열로 변환
    return Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        related_order=related_order,
        related_resource_type=related_resource_type or '',
        related_resource_id=related_resource_id or ''
    )


def notify_department_users(department_name, notification_type, title, message, related_order=None, exclude_user=None):
    """특정 부서의 모든 사용자에게 알림 전송"""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    
    # 부서에 속한 사용자 조회
    users = User.objects.filter(is_active=True)
    notifications = []
    
    for user in users:
        user_dept = get_department(user.id)
        if user_dept == department_name and (exclude_user is None or user.id != exclude_user.id):
            notification = create_notification(
                user=user,
                notification_type=notification_type,
                title=title,
                message=message,
                related_order=related_order
            )
            notifications.append(notification)
    
    logger.info(f"Created {len(notifications)} notifications for department {department_name}")
    return notifications


def update_order_status(order, new_status, changed_by=None, notes=''):
    """주문 상태 업데이트 및 이력 기록, 알림 생성"""
    old_status = order.status
    order.status = new_status
    
    # 완료일 설정
    if new_status == 'completed' and not order.completed_at:
        order.completed_at = timezone.now()
    
    order.save()
    
    # 상태 이력 기록
    OrderStatusHistory.objects.create(
        order=order,
        status=new_status,
        changed_by=changed_by,
        notes=notes or f"상태 변경: {old_status} → {new_status}"
    )
    
    logger.info(f"Order {order.id} status changed: {old_status} → {new_status} by {changed_by}")
    
    # 알림 생성
    if new_status == 'completed' and order.order_type == 'imaging':
        # 영상 촬영 완료 → 영상의학과에 알림
        patient_name = order.patient.name
        imaging_type = order.order_data.get('imaging_type', '영상')
        body_part = order.order_data.get('body_part', '')
        
        notify_department_users(
            department_name="영상의학과",
            notification_type='imaging_uploaded',
            title=f'영상 업로드 완료: {patient_name}',
            message=f'{patient_name}님의 {imaging_type} 촬영이 완료되어 업로드되었습니다. {body_part} 부위 영상을 분석해주세요.',
            related_order=order,
            exclude_user=changed_by
        )
        logger.info(f"Notification sent to 영상의학과 for order {order.id}")
    
    elif (new_status == 'processing' and 
          order.order_type == 'imaging' and 
          order.target_department == 'radiology' and
          old_status == 'processing'):
        # 방사선과가 'processing' 상태에서 완료 처리 → 영상의학과에 알림 (판독 대기)
        # (처리 시작 시에는 알림 없음, 완료 처리 시에만 알림)
        patient_name = order.patient.name
        imaging_type = order.order_data.get('imaging_type', '영상')
        body_part = order.order_data.get('body_part', '')
        
        notify_department_users(
            department_name="영상의학과",
            notification_type='imaging_uploaded',
            title=f'영상 업로드 완료: {patient_name}',
            message=f'{patient_name}님의 {imaging_type} 촬영이 완료되어 업로드되었습니다. {body_part} 부위 영상을 분석해주세요.',
            related_order=order,
            exclude_user=changed_by
        )
        logger.info(f"Notification sent to 영상의학과 for order {order.id} (radiology completed, awaiting analysis)")
    
    elif new_status == 'sent':
        # 주문 전달 시 대상 부서에 알림
        target_dept_map = {
            'pharmacy': '약국',
            'lab': '검사실',
            'radiology': '방사선과'
        }
        target_dept_kr = target_dept_map.get(order.target_department, order.target_department)
        
        if target_dept_kr in ['방사선과', '검사실', '약국']:
            notify_department_users(
                department_name=target_dept_kr,
                notification_type='order_sent',
                title=f'새 주문 도착: {order.patient.name}',
                message=f'{order.patient.name}님의 {order.get_order_type_display()} 주문이 전달되었습니다.',
                related_order=order,
                exclude_user=changed_by
            )
            logger.info(f"Notification sent to {target_dept_kr} for order {order.id}")


def create_imaging_analysis_result(order, analyzed_by, analysis_result, findings='', recommendations='', confidence_score=None, heatmap_image_file=None):
    """영상 분석 결과 생성 및 의사에게 알림
    
    Args:
        order: 주문 객체
        analyzed_by: 분석자 (User)
        analysis_result: 분석 결과 (dict/JSON)
        findings: 소견
        recommendations: 권고사항
        confidence_score: 신뢰도
        heatmap_image_file: heatmap 이미지 파일 (UploadedFile, optional)
    """
    # heatmap 이미지 저장
    heatmap_image_url = None
    if heatmap_image_file:
        try:
            # 저장 디렉토리 생성: media/imaging_analysis/{order_id}/
            save_dir = os.path.join(settings.MEDIA_ROOT, 'imaging_analysis', str(order.id))
            os.makedirs(save_dir, exist_ok=True)
            
            # 파일명 생성: heatmap_{timestamp}_{original_filename}
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            original_filename = heatmap_image_file.name
            file_ext = os.path.splitext(original_filename)[1] or '.png'
            filename = f'heatmap_{timestamp}{file_ext}'
            
            # 파일 저장
            file_path = os.path.join(save_dir, filename)
            with open(file_path, 'wb') as f:
                for chunk in heatmap_image_file.chunks():
                    f.write(chunk)
            
            # URL 생성
            relative_path = os.path.join('imaging_analysis', str(order.id), filename)
            heatmap_image_url = f"{settings.MEDIA_URL}{relative_path}".replace('\\', '/')
            
            # analysis_result에 이미지 URL 추가
            if not isinstance(analysis_result, dict):
                analysis_result = {}
            analysis_result['heatmap_image_url'] = heatmap_image_url
            analysis_result['heatmap_image_path'] = relative_path
            
            logger.info(f"Heatmap image saved: {file_path}, URL: {heatmap_image_url}")
        except Exception as e:
            logger.error(f"Failed to save heatmap image: {str(e)}", exc_info=True)
            # 이미지 저장 실패해도 분석 결과는 저장
    
    # 분석 결과 저장
    analysis, created = ImagingAnalysisResult.objects.update_or_create(
        order=order,
        defaults={
            'analyzed_by': analyzed_by,
            'analysis_result': analysis_result,
            'findings': findings,
            'recommendations': recommendations,
            'confidence_score': confidence_score
        }
    )
    
    # 영상 분석 결과 입력 시 주문 상태를 'completed'로 변경
    # (방사선과가 완료해도 'processing' 상태였던 것을 이제 완료 처리)
    if order.status != 'completed':
        update_order_status(order, 'completed', analyzed_by, '영상 분석 완료')
        logger.info(f"Order {order.id} status updated to 'completed' after imaging analysis")
    
    # 의사(주문 생성자)에게 알림
    doctor = order.doctor
    patient_name = order.patient.name
    imaging_type = order.order_data.get('imaging_type', '영상')
    
    create_notification(
        user=doctor,
        notification_type='imaging_analysis_complete',
        title=f'영상 분석 완료: {patient_name}',
        message=f'{patient_name}님의 {imaging_type} 영상 분석이 완료되었습니다. 결과를 확인해주세요.',
        related_order=order,
        related_resource_type='imaging_analysis',
        related_resource_id=str(analysis.id)
    )
    
    logger.info(f"Imaging analysis result created for order {order.id}, notification sent to doctor {doctor.id}")
    
    return analysis