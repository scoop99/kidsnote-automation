@echo off
setlocal
:: Change to current directory
cd /d "%~dp0"
:: Check for updates
echo [UPDATE] 최신 버전을 확인 중입니다...
node system/src/updater.js
:: Launch the new menu file to avoid any old cache
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0system\scripts\menu.ps1"
:: Handle errors
if %errorlevel% neq 0 (
    echo [ERROR] System cannot start.
    echo Fail code: %errorlevel%
    pause
)
