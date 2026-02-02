# 기존 주문에 dzi_url 보정하기

워커가 예전에 `dzi_url`을 안 보냈던 주문(가나다 등)은 **고해상도 뷰어**에서 "이미지 로딩 중"만 나옵니다.  
아래 방법으로 **이미 분석된 주문**에 `dzi_url`만 추가하면 됩니다.

---

## 1. Django Admin에서 수정

1. **Django Admin** 접속: `http://34.42.223.43/admin/` (또는 배포 URL)
2. **병리 분석 결과들**(Pathology analysis results) 메뉴로 이동
3. 수정할 주문의 **병리 분석 결과** 행 선택
4. **DZI 메타데이터 URL**(`dzi_url`) 또는 **뷰어 URL**(`viewer_url`) 필드에 워커 ngrok URL 입력  
   예: `https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi`
5. 저장

---

## 2. API로 수정 (기존 주문 보정용)

**엔드포인트**: `POST /api/mri/pathology/update-dzi-url/`  
**인증**: 로그인 세션 필요

**Request Body (JSON):**
```json
{
  "order_id": "c3272f48-7f2c-48d4-80e2-04403daa99d9",
  "dzi_url": "https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi",
  "viewer_url": ""
}
```

- **order_id**: 주문 UUID (필수)
- **dzi_url**: 워커 DZI 메타데이터 전체 URL (필수 또는 viewer_url 중 하나)
- **viewer_url**: (선택) 대체 뷰어 URL

**예시 (curl):**
```bash
curl -X POST 'http://34.42.223.43/api/mri/pathology/update-dzi-url/' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: sessionid=...' \
  -d '{"order_id": "c3272f48-7f2c-48d4-80e2-04403daa99d9", "dzi_url": "https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi"}'
```

**성공 시 (200):**
```json
{
  "success": true,
  "message": "dzi_url/viewer_url이 업데이트되었습니다.",
  "order_id": "c3272f48-7f2c-48d4-80e2-04403daa99d9",
  "dzi_url": "https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi",
  "viewer_url": null
}
```

**에러 예시:**
- `404`: 주문 없음 또는 해당 주문에 병리 분석 결과 없음
- `400`: order_id / dzi_url(또는 viewer_url) 누락

---

## 3. DB에서 직접 확인/수정

**테이블**: `ocs_pathologyanalysisresult`  
**컬럼**: `dzi_url`, `viewer_url` (빈 문자열이면 고해상도 뷰어 버튼은 나와도 로딩만 됨)

**주문별로 확인:**
```sql
SELECT o.id AS order_id, p.id AS pathology_id, p.class_name, p.dzi_url, p.viewer_url
FROM ocs_order o
JOIN ocs_pathologyanalysisresult p ON p.order_id = o.id
WHERE o.id = 'c3272f48-7f2c-48d4-80e2-04403daa99d9';
```

**dzi_url만 넣기:**
```sql
UPDATE ocs_pathologyanalysisresult
SET dzi_url = 'https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi',
    updated_at = NOW()
WHERE order_id = 'c3272f48-7f2c-48d4-80e2-04403daa99d9';
```

워커 ngrok URL은 워커팀에 문의해 넣으면 됩니다.

---

## 4. 앞으로 새로 분석하는 경우

워커가 **분석 완료 시 `complete` API**에 `dzi_url`을 꼭 포함해서 보내면, 새로 분석되는 주문은 자동으로 고해상도 뷰어가 동작합니다.

**워커 complete 예시:**
```json
{
  "task_id": "...",
  "result": "Tumor",
  "confidence": 0.95,
  "dzi_url": "https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi"
}
```

---

**작성일**: 2026.01.30
