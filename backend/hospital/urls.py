from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'patients', views.PatientViewSet)
router.register(r'examinations', views.ExaminationViewSet)
router.register(r'medical-images', views.MedicalImageViewSet)
router.register(r'ai-analysis', views.AIAnalysisResultViewSet)
router.register(r'voc', views.VoiceOfCustomerViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
