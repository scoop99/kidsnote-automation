@echo off
setlocal
cd /d "%~dp0"

:: 1. Node.js 설치 확인
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [SETUP] Node.js가 설치되어 있지 않습니다. 자동 설치를 시도합니다...
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo [ERROR] Node.js 자동 설치에 실패했습니다. https://nodejs.org 에서 직접 설치해 주세요.
        pause
        exit /b 1
    )
    echo [SETUP] Node.js 설치 완료! 프로그램 반영을 위해 '창을 닫고 다시 실행'해 주세요.
    pause
    exit /b 0
)

:: 2. 필수 라이브러리 확인
if not exist "system\node_modules" (
    echo [SETUP] 필수 라이브러리를 설치 중입니다 (최초 1회, 1~2분 소요)...
    cd system
    call npm install
    echo [SETUP] 브라우저 엔진(Chromium)을 설치 중입니다...
    call npx playwright install chromium
    cd ..
)

:: 3. 업데이트 확인
echo [UPDATE] 최신 버전을 확인 중입니다...
node system/src/updater.js

:: 4. 실행
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0system\scripts\menu.ps1"

:: 오류 발생 시
if %errorlevel% neq 0 (
    echo [ERROR] 시스템 가동 중 오류가 발생했습니다. (코드: %errorlevel%)
    pause
)
