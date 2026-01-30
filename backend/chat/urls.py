from rest_framework.routers import DefaultRouter

from .views import ChatAttachmentViewSet, ChatRoomViewSet, NotificationViewSet, UserViewSet

router = DefaultRouter()
router.register(r"chat/rooms", ChatRoomViewSet, basename="chat-room")
router.register(r"chat/users", UserViewSet, basename="chat-user")
router.register(r"chat/notifications", NotificationViewSet, basename="chat-notifications")
router.register(r"chat/files", ChatAttachmentViewSet, basename="chat-files")

urlpatterns = router.urls
