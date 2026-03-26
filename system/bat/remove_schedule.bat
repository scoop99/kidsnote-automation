@echo off
setlocal
:: Admin check
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Please run this as Administrator.
    pause
    exit /b
)

echo.
echo ======================================================
echo    Remove Scheduler
echo ======================================================
echo.
echo Do you want to remove the daily auto-backup task?
echo.
pause

powershell -Command "Unregister-ScheduledTask -TaskName 'KidsNoteBackup' -Confirm:$false"

echo.
echo [COMPLETE] Auto-backup is now disabled.
pause
