@echo off
chcp 65001 >nul
rem control_room 대시보드 실행: 브라우저가 자동으로 열립니다. 끝내려면 이 창에서 Ctrl+C
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행: 패키지를 설치합니다...
  call npm install || exit /b 1
)
node server/index.js --open
