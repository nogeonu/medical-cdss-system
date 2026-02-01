# DZI 타일 프록시 (서버팀 참고)

검사실 브라우저가 ngrok URL로 직접 요청하면 검정 화면이 나올 수 있어, **Django 서버가 DZI/타일 요청을 프록시**하도록 구현했습니다.

---

## 동작 방식

1. **브라우저** → Django 서버: `GET /api/mri/pathology/dzi-proxy/?url=<encoded_ngrok_dzi_url>`
2. **Django** → 워커(ngrok): 동일 URL로 요청 시 **`ngrok-skip-browser-warning: true` 헤더 포함**
3. Django가 응답( DZI XML 또는 타일 이미지 )을 그대로 브라우저에 전달

---

## 구현 내용

- **엔드포인트**: `GET /api/mri/pathology/dzi-proxy/?url=<encoded_full_url>`
- **헤더**: Django가 ngrok으로 요청할 때 `ngrok-skip-browser-warning: true` 포함
- **보안**: `PATHOLOGY_DZI_PROXY_ALLOWED_HOSTS` 환경 변수로 프록시 허용 호스트 제한 (기본: `ngrok-free.app`, `ngrok.io`, `ngrok.app`)

---

## 환경 변수 (선택)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PATHOLOGY_DZI_PROXY_ALLOWED_HOSTS` | 프록시 허용 호스트 (쉼표 구분) | `ngrok-free.app,ngrok.io,ngrok.app` |

다른 호스트(예: 워커 공인 IP)를 허용하려면:

```bash
PATHOLOGY_DZI_PROXY_ALLOWED_HOSTS=ngrok-free.app,ngrok.io,my-worker.example.com
```

---

## 프론트엔드

- `dzi_url`이 `http://` 또는 `https://`로 시작하면 자동으로 위 프록시 URL로 변환하여 사용합니다.
- 브라우저는 워커(ngrok)로 직접 요청하지 않고, 항상 Django를 경유합니다.

---

**작성일**: 2026.01.30
