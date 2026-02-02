from django.urls import path
from . import views

urlpatterns = [
    path('', views.chat, name='chat'),  # /api/chat/
    path('chat/', views.chat, name='chat_legacy'), # /api/chat/chat/ (혹시 모를 하위 호환)
    path('skin/analyze/', views.skin_analyze, name='skin_analyze'),
]
