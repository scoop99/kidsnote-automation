# KidsNote Automation Launcher
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location "$ScriptDir\..\.."

Write-Host "============================" -ForegroundColor Cyan
Write-Host " 키즈노트 자동 백업 시스템 " -ForegroundColor White -BackgroundColor Blue
Write-Host "============================" -ForegroundColor Cyan

# Node.js 확인
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[SETUP] Node.js 설치가 필요합니다..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Read-Host "설치 후 창을 닫고 다시 실행하세요."
    exit 0
}

# 라이브러리 설치
if (-not (Test-Path "system\node_modules")) {
    Write-Host "[SETUP] 라이브러리 설치 중..." -ForegroundColor Cyan
    Set-Location system
    npm install
    npx playwright install chromium
    Set-Location ..
}

# 업데이트 및 메뉴 실행
node system/src/updater.js
if (Test-Path "$ScriptDir\menu.ps1") {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\menu.ps1"
} else {
    Write-Host "[오류] 메뉴 파일(menu.ps1)을 찾을 수 없습니다!" -ForegroundColor Red
    Read-Host "엔터를 누르면 종료됩니다."
}