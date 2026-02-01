# 병리 이미지 고해상도 뷰어 - 워커 PC 준비 요청

검사실 `/pathology-analysis` 페이지에서 **원본 TIF를 구글 맵처럼 줌인/줌아웃**할 수 있도록 프론트엔드 준비가 완료되었습니다. 워커 PC에서 아래를 준비해 주시면 연동됩니다.

---

## 1. 워커 PC에서 준비할 것

### 1) DZI 타일 서버 구축

- **OpenSlide**로 원본 TIF(.tif, .svs 등)를 읽어 **실시간 Crop** 방식으로 타일 제공
- **Deep Zoom Image (DZI)** 형식으로 메타데이터 및 타일 제공
- 예: FastAPI + OpenSlide + `DeepZoomGenerator`

```
엔드포인트 예시:
- GET /dzi/{filename}.dzi          → DZI 메타데이터 XML
- GET /dzi/{filename}_files/{level}/{col}_{row}.jpeg  → 타일 이미지
```

### 2) 외부 접근 가능 URL

- 워커 PC가 **ngrok** 또는 **공인 IP:포트**로 외부에서 접근 가능해야 함
- 사용자 브라우저가 워커 PC에 직접 타일 요청을 보냄 (우리 서버 경유 없음)

### 3) `complete` API 호출 시 DZI URL 전달

분석 완료 후 `POST /api/pathology/complete/` 호출 시 아래 필드를 추가해 주세요.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `dzi_url` | string | 권장 | **OpenSeadragon용 DZI 메타데이터 URL** (예: `https://xxx.ngrok.app/dzi/tumor_076.tif.dzi`) |
| `viewer_url` | string | 선택 | DZI URL과 동일해도 됨. `dzi_url`이 없으면 이 값을 사용 |

**예시 (multipart/form-data):**
```
task_id: "pathology_xxx_123"
result: "Tumor"
confidence: "0.95"
dzi_url: "https://abcd1234.ngrok-free.app/dzi/tumor_076.tif.dzi"
```

---

## 2. CORS 설정

- 워커 타일 서버에서 **CORS 헤더** 허용 필요
- 우리 프론트엔드 도메인(예: `http://34.42.223.43`, `https://...`)에서 오는 요청 허용
- 또는 `Access-Control-Allow-Origin: *` (개발 시)

---

## 3. 참고: 우리 쪽 준비 상황

- `/pathology-analysis` 페이지에 **"고해상도 뷰어 (원본 TIF 확대)"** 버튼 추가됨
- `dzi_url` 또는 `viewer_url`이 있으면 버튼 표시
- 버튼 클릭 시 OpenSeadragon 모달로 DZI 타일 표시
- 워커 PC가 꺼져 있으면 타일 로드 실패 (연결 불가)

---

**작성일**: 2026.01.30
