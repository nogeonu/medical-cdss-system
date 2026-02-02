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
- **검사실 브라우저는 Django 서버로만 요청**하고, Django가 워커(ngrok)로 프록시할 때 `ngrok-skip-browser-warning` 헤더를 포함함 (DZI 프록시 사용)

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

- DZI 타일은 **Django DZI 프록시**를 통해 요청하므로, 기본적으로 브라우저→워커 직접 요청은 아님
- **워커 DZI 서버에도 CORS 설정 필요**: 브라우저가 워커로 직접 요청하는 경우를 대비해 워커 쪽 CORS(예: `allow_origins=["*"]`)를 설정해 두는 것이 좋음 (dzi_server.py에 이미 설정되어 있으면 문제없음)

---

## 3. 참고: 우리 쪽 준비 상황

- `/pathology-analysis` 페이지에 **"고해상도 뷰어 (원본 TIF 확대)"** 버튼 추가됨
- `dzi_url` 또는 `viewer_url`이 있으면 버튼 표시
- 버튼 클릭 시 **Django DZI 프록시** 경유 → OpenSeadragon 모달로 타일 표시 (브라우저는 Django로만 요청, Django가 ngrok에 `ngrok-skip-browser-warning` 포함하여 프록시)
- 워커 PC가 꺼져 있으면 타일 로드 실패 (연결 불가)
- 서버팀 상세: `docs/DZI_PROXY_SERVER.md` 참고

---

**작성일**: 2026.01.30
