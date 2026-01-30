"""
Django settings for eventeye project.
"""

from pathlib import Path
from decouple import config
import os
import pymysql

# PyMySQL을 MySQLdb로 사용
pymysql.install_as_MySQLdb()

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = config('SECRET_KEY', default='django-insecure-your-secret-key-here')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = config('DEBUG', default=True, cast=bool)

# FastAPI 서버 URL (약물 검색 및 상호작용 검사)
# 서버 내부에서는 localhost로 접근 (포트 8002는 외부에서 접근 불가)
FASTAPI_BASE_URL = config('FASTAPI_BASE_URL', default='http://127.0.0.1:8002')

ALLOWED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '192.168.41.140', '34.42.223.43', '*']

# Application definition
INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'drf_yasg',
    'django_filters',
    'patients',
    'medical_images',
    'dashboard',
    'lung_cancer',
    'literature',
    'mri_viewer',
    'ocs',
    'chatbot',
    'lis',
    'channels',
    'chat',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'eventeye.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'eventeye.wsgi.application'
ASGI_APPLICATION = 'eventeye.asgi.application'

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("127.0.0.1", 6379)],
        },
    },
}

# Chat 설정
OPEN_CHAT_ACCESS = True  # 모든 사용자가 채팅방 접근 가능
MESSAGE_HISTORY_LIMIT = 50  # WebSocket 연결 시 로드할 최근 메시지 수

# Chat 설정
OPEN_CHAT_ACCESS = True  # 모든 사용자가 채팅방 접근 가능
MESSAGE_HISTORY_LIMIT = 50  # WebSocket 연결 시 로드할 최근 메시지 수

# Database
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'hospital_db',
        'USER': 'acorn',
        'PASSWORD': 'acorn1234',
        'HOST': '34.42.223.43',
        'PORT': '3306',
        'OPTIONS': {
            'charset': 'utf8mb4',
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES', time_zone='+09:00'",
        },
    },
}

# 외부 데이터베이스 연결 플래그 (참고용)
EXTERNAL_DB_AVAILABLE = True

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
LANGUAGE_CODE = 'ko-kr'
TIME_ZONE = 'Asia/Seoul'
USE_I18N = True
USE_TZ = False

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# 프로덕션 도메인 설정 (이미지 URL 생성용)
PRODUCTION_DOMAIN = config('PRODUCTION_DOMAIN', default='http://34.42.223.43')

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS settings
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5001",
    "http://127.0.0.1:5001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://34.42.223.43",
    "http://34.42.223.43:80",
]

CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_ALL_ORIGINS = True  # 개발 환경에서만 사용

# 개발 편의용 CSRF/세션 설정
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5001",
    "http://127.0.0.1:5001",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://34.42.223.43",
]

SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = 86400  # 24시간

# REST Framework settings
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',  # 채팅 API 인증을 위해 필요
    ],
    # CSRF 면제를 위한 설정 (연구실 컴퓨터 워커용 API)
    'EXEMPT_VIEWS': [
        'mri_viewer.segmentation_views.segment_series',
        'mri_viewer.segmentation_views.request_local_inference',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'chat_messages': '1000/hour',  # 메시지 조회 throttle
        'chat_search': '100/hour',     # 메시지 검색 throttle
        'chat_upload': '50/hour',      # 파일 업로드 throttle
    },
}

# Swagger settings
SWAGGER_SETTINGS = {
    'SECURITY_DEFINITIONS': {
        'Basic': {
            'type': 'basic'
        }
    },
    'USE_SESSION_AUTH': False,
    'JSON_EDITOR': True,
    'SUPPORTED_SUBMIT_METHODS': [
        'get',
        'post',
        'put',
        'delete',
        'patch'
    ],
    'OPERATIONS_SORTER': 'alpha',
    'TAGS_SORTER': 'alpha',
    'DOC_EXPANSION': 'none',
    'DEEP_LINKING': True,
    'SHOW_EXTENSIONS': True,
    'SHOW_COMMON_EXTENSIONS': True,
}

REDOC_SETTINGS = {
    'LAZY_RENDERING': False,
}

# Flutter 모바일 앱 설정
FLUTTER_GITHUB_REPO = 'nogeonu/flutter-mobile'  # GitHub 저장소 (owner/repo)

# File upload size limits (for NIfTI and DICOM files)
DATA_UPLOAD_MAX_MEMORY_SIZE = 500 * 1024 * 1024  # 500 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 500 * 1024 * 1024  # 500 MB
DATA_UPLOAD_MAX_NUMBER_FIELDS = 100000  # DICOM 파일 업로드를 위해 증가 (seq_0~seq_3 폴더, 각 134장씩 총 536장)
DATA_UPLOAD_MAX_NUMBER_FILES = 1000  # 동시 업로드 가능한 파일 수 제한 (seq_0~seq_3 폴더, 각 134장씩 총 536장)