#!/bin/bash

# GCP 서버 코드 업데이트 스크립트
# 사용법: ./scripts/update_server.sh

GCP_HOST="34.42.223.43"
GCP_USER="shrjsdn908"  # 사용자 이름은 실제에 맞게 수정
APP_DIR="/srv/django-react/app"

echo "🚀 GCP 서버 코드 업데이트 시작..."
echo "서버: ${GCP_USER}@${GCP_HOST}"
echo "경로: ${APP_DIR}"
echo ""

# SSH로 접속하여 코드 업데이트 및 서비스 재시작
ssh ${GCP_USER}@${GCP_HOST} << 'ENDSSH'
    set -e  # 에러 발생 시 중단
    
    echo "📂 프로젝트 디렉토리로 이동..."
    cd /srv/django-react/app
    
    echo "📥 Git 저장소에서 최신 코드 가져오기..."
    git fetch origin
    git pull origin main
    
    echo "✅ 코드 업데이트 완료"
    echo ""
    
    echo "🔄 Gunicorn 재시작 중..."
    sudo systemctl restart gunicorn
    
    echo "⏳ Gunicorn 상태 확인 중..."
    sleep 2
    sudo systemctl status gunicorn --no-pager | head -20
    
    echo ""
    echo "🎉 업데이트 완료!"
    echo ""
    echo "📋 최근 커밋 정보:"
    git log --oneline -5
ENDSSH

echo ""
echo "✅ 서버 업데이트 완료!"
