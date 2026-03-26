@echo off
setlocal
:: Admin check
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Please run this as Administrator. (Right-click -> Run as Administrator)
    pause
    exit /b
)

echo.
echo ======================================================
echo    Scheduler Setup
echo ======================================================
echo.
echo What time should we back up daily?
echo (Enter a number from 0 to 23 and press Enter)
echo.
echo Example: 1 AM -> 1 / 10 PM -> 22 / 12 AM -> 0
echo.

if not "%1"=="" (
    set BACKUP_HOUR=%1
) else (
    set /p BACKUP_HOUR="Hour: "
)

if not defined BACKUP_HOUR (set BACKUP_HOUR=22)

powershell -ExecutionPolicy Bypass -File "%~dp0..\scripts\setup-scheduler.ps1" -Hour %BACKUP_HOUR%
powershell -Command "$json = Get-Content '%~dp0..\config.json' | ConvertFrom-Json; $json.target_hour = [int]%BACKUP_HOUR%; $json | ConvertTo-Json | Set-Content '%~dp0..\config.json'"

echo.
echo [COMPLETE] Auto-backup is set at %BACKUP_HOUR%:00 every day.
pause
