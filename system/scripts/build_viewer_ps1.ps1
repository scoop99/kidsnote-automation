
$viewer = @'
# KidsNote Awesome Viewer (KAV) - Launcher Script
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$SystemDir = Join-Path $RootDir "system"
$ServerScript = Join-Path $SystemDir "viewer\server.js"

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "    마이 알림장뷰어 (KAV) 시작 중..." -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# Node.js 설치 확인
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [오류] Node.js가 설치되어 있지 않습니다." -ForegroundColor Red
    Write-Host "  https://nodejs.org 에서 설치 후 다시 시도하세요." -ForegroundColor Yellow
    Read-Host "  엔터를 누르면 창이 닫힙니다"
    exit 1
}

# server.js 존재 확인
if (-not (Test-Path $ServerScript)) {
    Write-Host "  [오류] 뷰어 파일을 찾을 수 없습니다." -ForegroundColor Red
    Read-Host "  엔터를 누르면 창이 닫힙니다"
    exit 1
}

# express 모듈 설치 확인
$ExpressDir = Join-Path $SystemDir "node_modules\express"
if (-not (Test-Path $ExpressDir)) {
    Write-Host "  [설치] 필요한 패키지를 설치합니다..." -ForegroundColor Cyan
    Set-Location $SystemDir
    npm install --quiet
    Set-Location $RootDir
}

Write-Host "  브라우저가 자동으로 열립니다." -ForegroundColor Green
Write-Host "  이 창을 닫으면 뷰어도 함께 종료됩니다." -ForegroundColor Gray
Write-Host ""

node $ServerScript

Write-Host ""
Write-Host "  [종료] 뷰어 서버가 종료되었습니다." -ForegroundColor Yellow
'@

$target = Join-Path $PSScriptRoot "viewer.ps1"
$viewer | Out-File -FilePath $target -Encoding UTF8
Write-Host "viewer.ps1 생성 완료"
[System.IO.File]::ReadAllBytes($target)[0..2] -join ","
