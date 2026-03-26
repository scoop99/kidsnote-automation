@echo off
cd /d "%~dp0.."
echo [INSTALL] Starting...
npm install && npx playwright install chromium
echo [INSTALL] Done!
pause
