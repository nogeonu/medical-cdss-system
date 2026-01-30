
from django.contrib.auth import authenticate, login as django_login, logout as django_logout, get_user_model
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt

from .doctor_utils import (
    ALLOWED_DEPARTMENTS,
    DEPARTMENT_ADMIN,
    DEPARTMENT_IMAGING,
    DEPARTMENT_MAPPING,
    DEPARTMENT_RADIOLOGY,
    DEPARTMENT_RESPIRATORY,
    DEPARTMENT_SURGERY,
    ensure_doctor_id,
    get_department,
    get_doctor_id,
    normalize_department,
    set_department,
)


def get_role_from_user(user):
    if user.is_superuser:
        return "superuser"
    if user.is_staff:
        return "medical_staff"  # 의료진 (is_staff=1)
    return "admin_staff"  # 원무과 (is_staff=0)


@require_http_methods(["GET"])
def me(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Unauthorized"}, status=401)
    user = request.user
    return JsonResponse({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": getattr(user, 'first_name', ''),
        "last_name": getattr(user, 'last_name', ''),
        "role": get_role_from_user(user),
        "doctor_id": get_doctor_id(user.id),
        "department": get_department(user.id),
    })


@csrf_exempt
@require_http_methods(["POST"])  # CSRF는 개발 편의를 위해 면제. 운영 시 CSRF 처리 필요
def login(request):
    import json
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        payload = {}
    username = payload.get("username")
    password = payload.get("password")

    if not username or not password:
        return JsonResponse({"detail": "username and password are required"}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"detail": "Invalid credentials"}, status=401)

    actual_role = get_role_from_user(user)

    django_login(request, user)
    try:
        doctor_id = get_doctor_id(user.id)
        department = get_department(user.id)
    except Exception as e:
        print(f"[로그인] doctor_id/department 조회 오류: {e}")
        doctor_id = None
        department = None
    
    return JsonResponse({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": getattr(user, 'first_name', ''),
        "last_name": getattr(user, 'last_name', ''),
        "role": actual_role,
        "doctor_id": doctor_id,
        "department": department,
    })


@csrf_exempt
@require_http_methods(["POST"])  # Session 기반 로그아웃
def logout(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Already logged out"})
    django_logout(request)
    return JsonResponse({"detail": "Logged out"})


@csrf_exempt
@require_http_methods(["POST"])  # 간단 회원가입: 의료진 또는 원무과 선택 허용
def register(request):
    import json
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        payload = {}

    username = payload.get("username")
    password = payload.get("password")
    email = payload.get("email")
    first_name = payload.get("first_name")
    last_name = payload.get("last_name")
    department = payload.get("department", DEPARTMENT_ADMIN)
    
    # 영어 코드가 들어오면 한글로 변환 (하위 호환성)
    department = normalize_department(department)

    print(f"[회원가입] 받은 데이터: username={username}, department={department}, email={email}")

    if not username or not password:
        return JsonResponse({"detail": "username and password are required"}, status=400)

    if department not in ALLOWED_DEPARTMENTS:
        return JsonResponse({"detail": "Invalid department"}, status=400)

    inferred_role = "admin_staff" if department == DEPARTMENT_ADMIN else "medical_staff"

    User = get_user_model()
    # 중복 확인
    try:
        if User.objects.filter(username=username).exists():
            print(f"[회원가입] 중복된 사용자명: {username}")
            return JsonResponse({"detail": "Username already exists"}, status=400)
    except Exception as e:
        print(f"[회원가입] 중복 확인 실패: {e}")

    # 사용자 생성
    print(f"[회원가입] 사용자 생성 시도: {username}")
    try:
        user = User.objects.create_user(
            username=username,
            password=password,
            email=email,
        )
        if first_name:
            user.first_name = first_name
        if last_name:
            user.last_name = last_name
        user.is_staff = department != DEPARTMENT_ADMIN
        user.save()
        set_department(user.id, department)
        doctor_id = ensure_doctor_id(user.id)
        print(f"[회원가입] 사용자 생성 성공: ID={user.id}")
    except Exception as e:
        print(f"[회원가입] 사용자 생성 실패: {e}")
        return JsonResponse({"detail": f"Failed to save user: {str(e)}"}, status=500)

    return JsonResponse({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": inferred_role,
        "department": department,
        "doctor_id": doctor_id,
    }, status=201)


@require_http_methods(["GET"])
def list_doctors(request):
    department = request.GET.get("department")
    if department:
        # 영어 코드가 들어오면 한글로 변환 (하위 호환성)
        department = normalize_department(department)
        if department not in ALLOWED_DEPARTMENTS:
            return JsonResponse({"detail": "Invalid department"}, status=400)
        if department == DEPARTMENT_ADMIN:
            return JsonResponse({"detail": "Department must be medical"}, status=400)
        # 호흡기내과와 외과만 허용
        if department not in (DEPARTMENT_RESPIRATORY, DEPARTMENT_SURGERY):
            return JsonResponse({"detail": "Only respiratory and surgery departments are allowed"}, status=400)

    # 원무과, 방사선과, 영상의학과 제외 (호흡기내과와 외과만 포함)
    query = [
        "SELECT id, username, email, first_name, last_name, doctor_id, department",
        "FROM auth_user",
        "WHERE department <> %s AND department <> %s AND department <> %s",
    ]
    params = [DEPARTMENT_ADMIN, DEPARTMENT_RADIOLOGY, DEPARTMENT_IMAGING]

    if department:
        # 특정 진료과로 추가 필터링
        query[2] = "WHERE department <> %s AND department <> %s AND department <> %s AND department = %s"
        params = [DEPARTMENT_ADMIN, DEPARTMENT_RADIOLOGY, DEPARTMENT_IMAGING, department]

    query.append("ORDER BY first_name, last_name, username")
    sql = " ".join(query)

    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

    doctors = [
        {
            "id": row[0],
            "username": row[1],
            "email": row[2],
            "first_name": row[3] or "",
            "last_name": row[4] or "",
            "doctor_id": row[5],
            "department": row[6],
        }
        for row in rows
    ]

    return JsonResponse({"doctors": doctors})
