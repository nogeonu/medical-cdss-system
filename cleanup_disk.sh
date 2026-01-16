#!/bin/bash

# 디스크 정리 스크립트
# 프로젝트에서 불필요한 파일들을 안전하게 삭제합니다.

set -e

PROJECT_DIR="/srv/django-react/app"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "🧹 디스크 정리 시작..."
echo ""

# 1. Python 캐시 파일 정리
echo "📦 Python 캐시 파일 정리 중..."
find "$BACKEND_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$BACKEND_DIR" -name "*.pyc" -delete 2>/dev/null || true
find "$BACKEND_DIR" -name "*.pyo" -delete 2>/dev/null || true
find "$BACKEND_DIR" -name "*.pyd" -delete 2>/dev/null || true
find "$BACKEND_DIR" -name ".Python" -delete 2>/dev/null || true
echo "✅ Python 캐시 파일 정리 완료"

# 2. 로그 파일 정리 (오래된 것만)
echo "📋 로그 파일 정리 중..."
find "$BACKEND_DIR" -name "*.log" -type f -mtime +7 -delete 2>/dev/null || true
find "$BACKEND_DIR" -name "django.log" -type f -mtime +7 -delete 2>/dev/null || true
echo "✅ 로그 파일 정리 완료 (7일 이상 된 파일만 삭제)"

# 3. OS 생성 파일 정리
echo "🗑️  OS 생성 파일 정리 중..."
find "$PROJECT_DIR" -name ".DS_Store" -delete 2>/dev/null || true
find "$PROJECT_DIR" -name "Thumbs.db" -delete 2>/dev/null || true
find "$PROJECT_DIR" -name "*.swp" -delete 2>/dev/null || true
find "$PROJECT_DIR" -name "*.swo" -delete 2>/dev/null || true
find "$PROJECT_DIR" -name "*~" -delete 2>/dev/null || true
echo "✅ OS 생성 파일 정리 완료"

# 4. 프론트엔드 빌드 캐시 정리
echo "⚛️  프론트엔드 빌드 캐시 정리 중..."
if [ -d "$FRONTEND_DIR/node_modules/.cache" ]; then
    rm -rf "$FRONTEND_DIR/node_modules/.cache" 2>/dev/null || true
    echo "✅ node_modules 캐시 정리 완료"
fi
if [ -d "$FRONTEND_DIR/.vite" ]; then
    rm -rf "$FRONTEND_DIR/.vite" 2>/dev/null || true
    echo "✅ Vite 캐시 정리 완료"
fi
if [ -f "$FRONTEND_DIR/.eslintcache" ]; then
    rm -f "$FRONTEND_DIR/.eslintcache" 2>/dev/null || true
    echo "✅ ESLint 캐시 정리 완료"
fi
if [ -f "$FRONTEND_DIR/tsconfig.tsbuildinfo" ]; then
    rm -f "$FRONTEND_DIR/tsconfig.tsbuildinfo" 2>/dev/null || true
    echo "✅ TypeScript 빌드 정보 정리 완료"
fi

# 5. pip 캐시 정리
echo "📚 pip 캐시 정리 중..."
if [ -d "$BACKEND_DIR/.venv" ]; then
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    pip cache purge 2>/dev/null || true
    deactivate
    echo "✅ pip 캐시 정리 완료"
fi

# 6. 임시 파일 정리
echo "🗂️  임시 파일 정리 중..."
find "$PROJECT_DIR" -type f -name "*.tmp" -delete 2>/dev/null || true
find "$PROJECT_DIR" -type f -name "*.temp" -delete 2>/dev/null || true
find "$PROJECT_DIR" -type d -name "tmp" -empty -exec rmdir {} + 2>/dev/null || true
find "$PROJECT_DIR" -type d -name "temp" -empty -exec rmdir {} + 2>/dev/null || true
echo "✅ 임시 파일 정리 완료"

# 7. IDE 설정 파일 정리 (선택적)
echo "💻 IDE 설정 파일 정리 중..."
if [ -d "$PROJECT_DIR/.vscode" ] && [ ! -f "$PROJECT_DIR/.vscode/settings.json" ]; then
    rm -rf "$PROJECT_DIR/.vscode" 2>/dev/null || true
    echo "✅ .vscode 정리 완료"
fi
if [ -d "$PROJECT_DIR/.idea" ] && [ ! -f "$PROJECT_DIR/.idea/workspace.xml" ]; then
    rm -rf "$PROJECT_DIR/.idea" 2>/dev/null || true
    echo "✅ .idea 정리 완료"
fi

echo ""
echo "🎉 디스크 정리 완료!"
echo ""
echo "📊 정리 후 디스크 사용량:"
df -h / | tail -1

echo ""
echo "📁 프로젝트 디렉토리 크기:"
du -sh "$PROJECT_DIR" 2>/dev/null || true
