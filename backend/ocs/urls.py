"""
OCS URLs
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    OrderViewSet,
    OrderStatusHistoryViewSet,
    DrugInteractionCheckViewSet,
    AllergyCheckViewSet,
    NotificationViewSet,
    ImagingAnalysisResultViewSet
)

router = DefaultRouter()
router.register(r'orders', OrderViewSet, basename='order')
router.register(r'status-history', OrderStatusHistoryViewSet, basename='order-status-history')
router.register(r'drug-interaction-checks', DrugInteractionCheckViewSet, basename='drug-interaction-check')
router.register(r'allergy-checks', AllergyCheckViewSet, basename='allergy-check')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'imaging-analysis', ImagingAnalysisResultViewSet, basename='imaging-analysis')

urlpatterns = [
    path('', include(router.urls)),
]
