# OCS (Order Communication System) - 처방전달시스템

## 개요
의료진이 처방전, 검사 주문, 영상 촬영 의뢰를 생성하고 각 부서로 자동 전달하는 시스템입니다.

## 주요 기능

### 1. 주문 관리
- 처방전 주문 (약국으로 전달)
- 검사 주문 (검사실로 전달)
- 영상 촬영 의뢰 (방사선과로 전달)

### 2. 환자 안전 기능
- ✅ 약물 상호작용 자동 체크
- ✅ 알레르기 자동 체크
- ✅ 주문 검증

### 3. 우선순위 관리
- 일반 (routine)
- 긴급 (urgent)
- 즉시 (stat)
- 응급 (emergency)

### 4. 상태 관리
- 대기중 (pending)
- 전달됨 (sent)
- 처리중 (processing)
- 완료 (completed)
- 취소 (cancelled)

## API 엔드포인트

### 주문 관리
- `GET /api/ocs/orders/` - 주문 목록 조회
- `POST /api/ocs/orders/` - 주문 생성
- `GET /api/ocs/orders/{id}/` - 주문 상세 조회
- `PUT /api/ocs/orders/{id}/` - 주문 수정
- `DELETE /api/ocs/orders/{id}/` - 주문 삭제

### 주문 액션
- `POST /api/ocs/orders/{id}/send/` - 주문 전달
- `POST /api/ocs/orders/{id}/start_processing/` - 처리 시작
- `POST /api/ocs/orders/{id}/complete/` - 완료 처리
- `POST /api/ocs/orders/{id}/cancel/` - 주문 취소
- `POST /api/ocs/orders/{id}/revalidate/` - 재검증

### 통계 및 조회
- `GET /api/ocs/orders/statistics/` - 통계 정보
- `GET /api/ocs/orders/my_orders/` - 내가 생성한 주문
- `GET /api/ocs/orders/pending_orders/` - 대기 중인 주문

## 사용 예시

### 1. 처방전 주문 생성
```json
POST /api/ocs/orders/
{
  "order_type": "prescription",
  "patient": "patient-uuid",
  "order_data": {
    "medications": [
      {
        "name": "아스피린",
        "dosage": "100mg",
        "frequency": "1일 1회",
        "duration": "7일"
      }
    ]
  },
  "target_department": "pharmacy",
  "priority": "routine",
  "notes": "식후 복용"
}
```

### 2. 검사 주문 생성
```json
POST /api/ocs/orders/
{
  "order_type": "lab_test",
  "patient": "patient-uuid",
  "order_data": {
    "test_items": [
      {
        "name": "혈액검사",
        "priority": "routine"
      },
      {
        "name": "소변검사",
        "priority": "routine"
      }
    ]
  },
  "target_department": "lab",
  "priority": "routine"
}
```

### 3. 영상 촬영 의뢰 생성
```json
POST /api/ocs/orders/
{
  "order_type": "imaging",
  "patient": "patient-uuid",
  "order_data": {
    "imaging_type": "MRI",
    "body_part": "유방",
    "contrast": false
  },
  "target_department": "radiology",
  "priority": "urgent",
  "due_time": "2025-01-20T10:00:00Z"
}
```

## 모델 구조

### Order (주문)
- 주문 유형 (처방전/검사/영상촬영)
- 환자 정보
- 의사 정보
- 주문 내용 (JSON)
- 전달 부서
- 우선순위
- 상태
- 검증 결과

### OrderStatusHistory (상태 이력)
- 주문 상태 변경 기록
- 변경자 정보
- 변경 메모

### DrugInteractionCheck (약물 상호작용 검사)
- 체크한 약물 리스트
- 발견된 상호작용
- 심각도

### AllergyCheck (알레르기 검사)
- 환자 알레르기 정보
- 주문 항목
- 알레르기 경고

## 다음 단계

1. **마이그레이션 실행**
   ```bash
   python manage.py makemigrations ocs
   python manage.py migrate ocs
   ```

2. **RIS 연동** (2주차)
   - 영상 촬영 의뢰를 RIS로 자동 전달

3. **LIS 연동** (3주차)
   - 검사 주문을 LIS로 자동 전달

4. **알림 시스템** (4주차)
   - 주문 완료 시 의사에게 알림
   - 검증 실패 시 경고 알림
