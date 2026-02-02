# 워커팀 정보: 고해상도 뷰어 DZI 연동 방식

## 1. 전체 흐름

1. 검사실 브라우저 → Django 서버로 DZI/타일 요청
2. Django 서버 → 워커(ngrok) URL로 프록시 요청 (헤더 포함)
3. 워커 → DZI/타일 응답
4. Django → 브라우저로 응답 전달

---

## 2. Django 프록시 경로

**[서버팀에 확인 필요]** 정확한 경로:

- **현재 우리 코드 기준**: `/api/mri/pathology/dzi-proxy/`
- 예상 가능한 형태: `/api/pathology/dzi-proxy/` 또는 `/pathology-dzi-proxy/`
- **사용 방식**: `GET {경로}/<URL인코딩된_워커_DZI_URL>`

**예시 (현재 코드 경로 기준):**
```
GET /api/mri/pathology/dzi-proxy/https%3A%2F%2Fxxx.ngrok.app%2Fdzi%2Fwsi%2Ftumor.tif.dzi
GET /api/mri/pathology/dzi-proxy/https%3A%2F%2Fxxx.ngrok.app%2Fdzi%2Fwsi%2Ftumor.tif_files%2F0%2F0_0.jpeg
```

서버팀에 **실제 배포된 프록시 경로**를 확인받으세요.

---

## 3. 워커가 제공하는 것

### complete API 호출 시

```json
{
  "task_id": "...",
  "result": "Tumor",
  "confidence": 0.95,
  "dzi_url": "https://xxx.ngrok-free.app/dzi/wsi/tumor_076.tif.dzi"
}
```

- **dzi_url**: 워커의 DZI 메타데이터 **전체 URL** (ngrok 포함)
- Django는 이 URL을 프록시 경로로 변환하여 OpenSeadragon에 전달

---

## 4. 워커 DZI 서버 설정

- **포트**: 8000
- **CORS**: **필요함.** 브라우저가 워커로 직접 요청하는 경우를 대비해 워커 DZI 서버에도 CORS 설정이 있어야 합니다.  
  (Django→워커는 서버 간 통신이라 CORS 불필요하지만, 직접 요청 대비용으로 워커 쪽 CORS 권장.)  
  예: `allow_origins=["*"]` (현재 dzi_server.py에 설정되어 있으면 문제없음)
- **ngrok**: 워커가 자동 기동 (authtoken 설정 완료)

**엔드포인트 예시:**
- `/health` — 헬스 체크
- `/dzi/{filename:path}.dzi` — DZI 메타데이터
- `/dzi/{filename:path}_files/{level}/{col}_{row}.jpeg` — 타일 이미지

---

## 5. 서버팀 확인 사항

1. Django 프록시 **경로가 정확히 무엇인지**
2. **ngrok-skip-browser-warning: true** 헤더가 프록시 요청에 포함되는지
3. OpenSeadragon이 Django 프록시 경로를 사용하도록 설정되었는지

---

## 6. 서버팀에 전달할 질문

아래 질문을 서버팀에 전달하면 원인 파악에 도움이 됩니다.

### (1) OpenSeadragon이 타일을 어떤 URL로 요청하나요?

- **전부** `.../dzi-proxy/<인코딩된_전체_URL>` 형태인지  
  (DZI 메타 + 타일 모두 Django 프록시 경유)
- 아니면 **.dzi만 프록시**이고, 타일은 `ngrok주소/dzi/..._files/...` 로 **직접** 가는지

### (2) 실제 배포된 프록시 경로

- 예: `http://34.42.223.43/api/mri/pathology/dzi-proxy/` 인지, **다른 경로**인지 확인 필요

### (3) Network 탭에서 실패한 요청 URL

- 고해상도 뷰어에서 로딩 실패 시, 브라우저 **개발자 도구(F12) → Network** 탭에서  
  **실패한 요청(빨간색) 1~2개의 전체 URL**을 캡처해서 서버팀에 보내면 원인 파악이 빠릅니다.

---

**작성일**: 2026.01.30
