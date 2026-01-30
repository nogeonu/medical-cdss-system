from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from . import views, orthanc_views, segmentation_views, mammography_views, pathology_views, pathology_upload_views

urlpatterns = [
    # 기존 MRI Viewer API
    path('patients/', views.get_patient_list, name='mri-patient-list'),
    path('patients/<str:patient_id>/', views.get_patient_basic_info, name='mri-patient-basic-info'),
    path('patients/<str:patient_id>/detail/', views.get_patient_info, name='mri-patient-info'),
    path('patients/<str:patient_id>/slice/', views.get_mri_slice, name='mri-slice'),
    path('patients/<str:patient_id>/volume/', views.get_volume_info, name='mri-volume-info'),
    
    # Orthanc PACS API
    path('orthanc/system/', orthanc_views.orthanc_system_info, name='orthanc-system'),
    path('orthanc/debug/patients/', orthanc_views.orthanc_debug_patients, name='orthanc-debug-patients'),
    path('orthanc/patients/', orthanc_views.orthanc_patients, name='orthanc-patients'),
    path('orthanc/patients/<str:patient_id>/', orthanc_views.orthanc_patient_detail, name='orthanc-patient-detail'),
    path('orthanc/instances/<str:instance_id>/preview/', orthanc_views.orthanc_instance_preview, name='orthanc-instance-preview'),
    path('orthanc/instances/<str:instance_id>/file', orthanc_views.orthanc_instance_file, name='orthanc-instance-file'),
    path('orthanc/upload/', csrf_exempt(orthanc_views.orthanc_upload_dicom), name='orthanc-upload'),
    path('orthanc/upload-folder/', csrf_exempt(orthanc_views.orthanc_upload_dicom_folder), name='orthanc-upload-folder'),
    path('orthanc/upload-series-folder/', csrf_exempt(orthanc_views.orthanc_upload_dicom_series_folder), name='orthanc-upload-series-folder'),
    path('orthanc/patients/<str:patient_id>/delete/', orthanc_views.orthanc_delete_patient, name='orthanc-delete-patient'),
    
    # AI Segmentation API (MRI - 향후 모델 통합)
    path('orthanc/patients/<str:patient_id>/segmentation/', orthanc_views.orthanc_segmentation, name='orthanc-segmentation'),
    path('orthanc/patients/<str:patient_id>/segmentation/run/', orthanc_views.orthanc_run_segmentation, name='orthanc-run-segmentation'),
    
    # MRI 세그멘테이션 API
    path('segmentation/instances/<str:instance_id>/segment/', segmentation_views.mri_segmentation, name='mri-segmentation'),
    path('segmentation/series/<str:series_id>/segment/', segmentation_views.segment_series, name='segment-series'),
    path('segmentation/instances/<str:seg_instance_id>/frames/', segmentation_views.get_segmentation_frames, name='get-segmentation-frames'),
    path('segmentation/instances/<str:seg_instance_id>/volume-instances/', segmentation_views.get_segmentation_volume_instances, name='get-segmentation-volume-instances'),
    path('segmentation/health/', segmentation_views.segmentation_health, name='segmentation-health'),
    
    # 연구실 컴퓨터 추론 요청 API
    path('segmentation/series/<str:series_id>/request-local/', segmentation_views.request_local_inference, name='request-local-inference'),
    path('segmentation/status/<str:request_id>/', segmentation_views.check_inference_status, name='check-inference-status'),
    path('segmentation/requests/', segmentation_views.list_inference_requests, name='list-inference-requests'),
    
    # HTTP API 방식 (공유 디렉토리 불필요)
    path('segmentation/pending-requests/', csrf_exempt(segmentation_views.get_pending_requests), name='get-pending-requests'),
    path('segmentation/complete-request/<str:request_id>/', segmentation_views.complete_inference_request, name='complete-inference-request'),
    path('segmentation/update-status/<str:request_id>/', csrf_exempt(segmentation_views.update_request_status), name='update-request-status'),
    
    # 조원님 워커 호환용 API (HTTP_API_구현_계획.md 참고)
    # /api/inference/ 경로에서 직접 사용하므로 'inference/' 제거
    path('pending', csrf_exempt(segmentation_views.get_pending_inference), name='get-pending-inference'),
    path('<str:request_id>/complete', csrf_exempt(segmentation_views.complete_inference), name='complete-inference'),
    
    # 맘모그래피 AI 분석 API
    path('mammography/analyze/', csrf_exempt(mammography_views.mammography_ai_analysis), name='analyze-mammography'),
    path('mammography/health/', mammography_views.mammography_health, name='mammography-health'),

    # 병리 이미지 AI 분석 API
    path('pathology/analyze/', csrf_exempt(pathology_views.pathology_ai_analysis), name='analyze-pathology'),
    path('pathology/health/', pathology_views.pathology_ai_health, name='pathology-health'),
    path('pathology/save-result/', pathology_views.save_pathology_result, name='save-pathology-result'),
    
    # 병리 이미지 업로드 API
    path('pathology/upload/', csrf_exempt(pathology_upload_views.upload_pathology_image), name='upload-pathology'),
    path('pathology/images/', pathology_upload_views.get_pathology_images, name='get-pathology-images'),
]

