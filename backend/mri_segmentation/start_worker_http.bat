@echo off
REM HTTP API 워커 시작 스크립트

echo ========================================
echo MRI 세그멘테이션 HTTP API 워커 시작
echo ========================================
echo.

cd /d "%~dp0"

REM 환경 변수 로드
if exist .env (
    echo [OK] .env 파일 발견
) else (
    echo [ERROR] .env 파일이 없습니다!
    pause
    exit /b 1
)

REM 모델 파일 확인
if exist "src\best_model.pth" (
    echo [OK] 모델 파일 존재
) else (
    echo [ERROR] 모델 파일이 없습니다!
    pause
    exit /b 1
)

echo.
echo HTTP API 워커를 시작합니다...
echo GCP 서버: http://34.42.223.43
echo 폴링 간격: 30초
echo.
echo 종료하려면 Ctrl+C를 누르세요.
echo.

python local_inference_worker_http.py

pause
