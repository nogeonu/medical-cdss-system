from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import LabTestViewSet, RNATestViewSet

router = DefaultRouter()
router.register(r'lab-tests', LabTestViewSet, basename='lab-test')
router.register(r'rna-tests', RNATestViewSet, basename='rna-test')

urlpatterns = [
    path('', include(router.urls)),
]
