# KidsNote Automation Launcher (UTF-8 with BOM)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location "$ScriptDir\..\.."
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "       키즈노트 자동 백업 시스템 시작" -ForegroundColor White -BackgroundColor Blue
Write-Host "==============================================" -ForegroundColor Cyan
# 1. Node.js 설치 확인
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[SETUP] Node.js를 찾을 수 없어 자동 설치를 진행합니다..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[오류] Node.js 자동 설치 실패. https://nodejs.org 에서 직접 설치해 주세요." -ForegroundColor Red
        Read-Host "엔터를 누르면 종료됩니다."
        exit 1
    }
    Write-Host "[완료] Node.js 설치 성공! 창을 닫고 다시 실행해 주세요." -ForegroundColor Green
    Read-Host "엔터를 누르면 종료됩니다."
    exit 0
}
# 2. 필수 라이브러리 확인
if (-not (Test-Path "system\node_modules")) {
    Write-Host "[SETUP] 라이브러리 설치 중 (최초 1회, 1~2분 소요)..." -ForegroundColor Cyan
    Set-Location system
    npm install
    Write-Host "[SETUP] 브라우저 엔진(Playwright) 설치 중..." -ForegroundColor Cyan
    npx playwright install chromium
    Set-Location ..
}
# 3. 업데이트 체크
Write-Host "[런처] 최신 버전을 확인하고 있습니다..." -ForegroundColor Cyan
node system/src/updater.js
# 4. 메뉴 실행
if (Test-Path "$ScriptDir\menu.ps1") {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\menu.ps1"
}
else {
    Write-Host "[오류] 메뉴 파일(menu.ps1)을 찾을 수 없습니다!" -ForegroundColor Red
    Read-Host "엔터를 누르면 종료됩니다."
}