from django.utils import timezone
from rest_framework.views import exception_handler


def standard_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return response
    code = getattr(exc, "default_code", "error")
    response.data = {
        "error": response.data,
        "code": code,
        "timestamp": timezone.now().isoformat(),
    }
    return response
