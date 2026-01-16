from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PatientViewSet,
    MedicalRecordViewSet,
    PatientSignupView,
    PatientLoginView,
    PatientProfileView,
    AppointmentViewSet,
)
from .mobile_views import (
    get_latest_apk_info,
    record_apk_download,
)

router = DefaultRouter()
router.register(r'patients', PatientViewSet)
router.register(r'records', MedicalRecordViewSet)
router.register(r'appointments', AppointmentViewSet, basename='appointment')

urlpatterns = [
    path('', include(router.urls)),
    path('signup/', PatientSignupView.as_view(), name='patient-signup'),
    path('login/', PatientLoginView.as_view(), name='patient-login'),
    path('profile/<str:account_id>/', PatientProfileView.as_view(), name='patient-profile'),
    # 모바일 앱 관련
    path('mobile/latest-apk/', get_latest_apk_info, name='latest-apk'),
    path('mobile/download-stats/', record_apk_download, name='download-stats'),
]
