"""
병리 이미지 전용 URL 라우팅
교육원 조원 워커용: /api/pathology/ 경로로 직접 접근
"""
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from . import pathology_views, pathology_upload_views

urlpatterns = [
    # 병리 이미지 AI 분석 API
    path('analyze/', csrf_exempt(pathology_views.pathology_ai_analysis), name='analyze-pathology'),
    path('result/<str:request_id>/', pathology_views.get_analysis_result, name='pathology-result'),
    path('health/', pathology_views.pathology_ai_health, name='pathology-health'),
    
    # 병리 이미지 업로드 API
    path('upload/', csrf_exempt(pathology_upload_views.upload_pathology_image), name='upload-pathology'),
    path('images/', pathology_upload_views.get_pathology_images, name='get-pathology-images'),
    
    # 교육원 컴퓨터 추론 요청 API (HTTP API 방식)
    path('pending-requests/', csrf_exempt(pathology_views.get_pending_requests), name='pathology-pending-requests'),
    path('update-status/<str:request_id>/', csrf_exempt(pathology_views.update_request_status), name='pathology-update-status'),
    path('complete-request/<str:request_id>/', csrf_exempt(pathology_views.complete_request), name='pathology-complete-request'),
    
    # 교육원 조원 요청 형식 API
    path('complete/', csrf_exempt(pathology_views.complete_task), name='pathology-complete'),
    path('fail/', csrf_exempt(pathology_views.fail_task), name='pathology-fail'),
]
