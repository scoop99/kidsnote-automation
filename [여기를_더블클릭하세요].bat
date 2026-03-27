@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "system\scripts\launcher.ps1"
echo.
echo ------------------------------------------------
echo [SYSTEM] Program finished or stopped.
pause