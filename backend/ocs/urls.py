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
    ImagingAnalysisResultViewSet,
    PathologyAnalysisResultViewSet,
    DrugSearchView,
    DrugInteractionCheckView,
)

router = DefaultRouter()
router.register(r'orders', OrderViewSet, basename='order')
router.register(r'status-history', OrderStatusHistoryViewSet, basename='order-status-history')
router.register(r'drug-interaction-checks', DrugInteractionCheckViewSet, basename='drug-interaction-check')
router.register(r'allergy-checks', AllergyCheckViewSet, basename='allergy-check')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'imaging-analysis', ImagingAnalysisResultViewSet, basename='imaging-analysis')
router.register(r'pathology-analysis', PathologyAnalysisResultViewSet, basename='pathology-analysis')

urlpatterns = [
    path('', include(router.urls)),
    # 약물 검색 및 상호작용 검사 API
    path('drugs/search/', DrugSearchView.as_view(), name='drug-search'),
    path('drugs/check-interactions/', DrugInteractionCheckView.as_view(), name='drug-interaction-check'),
]
