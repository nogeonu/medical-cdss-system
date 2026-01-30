"""
URL configuration for eventeye project.
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from . import auth_views
from . import github_views
from django.http import JsonResponse, HttpResponse
from rest_framework import permissions
from drf_yasg.views import get_schema_view
from drf_yasg import openapi

def api_root(request):
    return JsonResponse({
        'message': 'EventEye API',
        'version': '1.0.0',
        'endpoints': {
            'patients': '/api/patients/',
            'medical_images': '/api/medical-images/',
            'dashboard': '/api/dashboard/',
            'lung_cancer': '/api/lung_cancer/',
            'mri_viewer': '/api/mri/',
            'ocs': '/api/ocs/',
            'chatbot': '/api/chat/',
            'messenger': '/api/messenger/',
            'lis': '/api/lis/',
            'admin': '/admin/',
            'swagger': '/swagger/',
            'redoc': '/redoc/'
        }
    })

# Swagger 설정
schema_view = get_schema_view(
    openapi.Info(
        title="병원 관리 시스템 API",
        default_version='v1',
        description="폐암 진단 및 환자 관리를 위한 RESTful API",
        terms_of_service="https://www.google.com/policies/terms/",
        contact=openapi.Contact(email="contact@hospital.local"),
        license=openapi.License(name="BSD License"),
    ),
    public=True,
    permission_classes=[permissions.AllowAny],
)

def favicon_view(request):
    """favicon.ico 요청 처리 - 204 No Content 반환"""
    return HttpResponse(status=204)

urlpatterns = [
    path('favicon.ico', favicon_view, name='favicon'),
    path('', api_root, name='root'),
    path('admin/', admin.site.urls),
    path('api/', api_root, name='api-root'),
    path('api/patients/', include('patients.urls')),
    path('api/medical-images/', include('medical_images.urls')),
    path('api/dashboard/', include('dashboard.urls')),
    path('api/lung_cancer/', include('lung_cancer.urls')),
    path('api/literature/', include('literature.urls')),
    path('api/mri/', include('mri_viewer.urls')),
    path('api/pathology/', include('mri_viewer.pathology_urls')),  # 교육원 조원 워커용 (병리 이미지 전용)
    path('api/inference/', include('mri_viewer.urls')),  # 조원님 워커 호환용
    path('api/ocs/', include('ocs.urls')),
    path('api/chat/', include('chatbot.urls')),
    path('api/messenger/', include('chat.urls')),
    path('api/lis/', include('lis.urls')),
    # Auth endpoints
    path('api/auth/login', auth_views.login, name='login'),
    path('api/auth/me', auth_views.me, name='me'),
    path('api/auth/logout', auth_views.logout, name='logout'),
    path('api/auth/register', auth_views.register, name='register'),
    path('api/auth/doctors/', auth_views.list_doctors, name='doctor-list'),
    
    # GitHub API Proxy
    path('api/github/latest-release', github_views.get_latest_release, name='github-latest-release'),
    
    # Swagger URLs
    re_path(r'^swagger(?P<format>\.json|\.yaml)$', schema_view.without_ui(cache_timeout=0), name='schema-json'),
    path('swagger/', schema_view.with_ui('swagger', cache_timeout=0), name='schema-swagger-ui'),
    path('redoc/', schema_view.with_ui('redoc', cache_timeout=0), name='schema-redoc'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)