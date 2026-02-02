# 서버팀 확인: 고해상도 뷰어 DZI 프록시

**워커팀 확인 결과**: DZI 서버·ngrok·타일 전달 모두 정상.  
고해상도 뷰어가 안 보이거나 검정/로딩만 되면 **서버/프론트 쪽** 확인이 필요합니다.

---

## 1. Django 프록시 경로·동작

### (1) 실제 배포된 프록시 경로

- **우리 코드 기준**: `GET /api/mri/pathology/dzi-proxy/<URL인코딩된_워커_DZI_URL>`
- 배포 환경에서 아래가 **실제로 동작하는지** 확인 필요:
  - 예: `http://34.42.223.43/api/mri/pathology/dzi-proxy/https%3A%2F%2Fxxx.ngrok-free.app%2Fdzi%2F...`
- Nginx/리버스 프록시에서 `/api/mri/` 가 Django로 전달되는지 확인

### (2) OpenSeadragon이 모든 DZI/타일 요청을 프록시로 보내는지

- **우리 프론트**: ngrok URL을 **경로 기반 프록시 URL 하나**로 바꿔서 OpenSeadragon에 전달
- OpenSeadragon은 그 URL에서 **.dzi** → **_files/level/col_row.jpeg** 로 타일 URL을 만듦
- 따라서 **DZI 메타 + 타일 요청 전부** `.../dzi-proxy/<인코딩된_URL>` 형태로 **Django로만** 감
- 브라우저가 워커(ngrok)로 직접 요청하지 않음 → Network 탭에서 `dzi-proxy` 로 가는 요청만 있어야 함

### (3) ngrok-skip-browser-warning 헤더를 프록시 요청에 넣는지

- **우리 백엔드**: Django가 워커(ngrok)로 요청할 때 아래 헤더 포함하도록 구현됨
  - `ngrok-skip-browser-warning: true`
- 배포된 서버에서 실제로 **Django → ngrok** 요청에 이 헤더가 포함되는지 확인 (미포함 시 ngrok 경고 페이지로 응답할 수 있음)

---

## 2. 서버팀에서 확인할 것 요약

| 항목 | 확인 내용 |
|------|-----------|
| **프록시 경로** | `/api/mri/pathology/dzi-proxy/` 가 배포되어 있고, `GET {경로}/<encoded_url>` 이 Django 뷰까지 도달하는지 |
| **요청 경로** | 브라우저 → Django 로 가는 요청이 **DZI 메타 + 타일 모두** `.../dzi-proxy/...` 인지 (Network 탭으로 확인) |
| **헤더** | Django → ngrok 요청에 `ngrok-skip-browser-warning: true` 가 포함되는지 |

---

## 3. 우리 코드 기준 (참고)

- **URL 라우트**: `backend/mri_viewer/urls.py`  
  - `path('pathology/dzi-proxy/', ...)`  
  - `path('pathology/dzi-proxy/<path:encoded_path>', ...)`  
  - prefix: `api/mri/` (eventeye/urls.py 에서 `path('api/mri/', include('mri_viewer.urls'))`)
- **뷰**: `pathology_dzi_proxy` — `encoded_path` 또는 `?url=` 디코딩 후 워커 URL로 `requests.get(..., headers={'ngrok-skip-browser-warning': 'true'})` 호출 후 응답 그대로 반환
- **프론트**: `PathologyHighResViewer.tsx` — `DZI_PROXY_PATH = '/api/mri/pathology/dzi-proxy/'`, 외부 DZI URL을 `origin + DZI_PROXY_PATH + encodeURIComponent(url)` 로 변환해 OpenSeadragon에 전달

---

**작성일**: 2026.01.30
