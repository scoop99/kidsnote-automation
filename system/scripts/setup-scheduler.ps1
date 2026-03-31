# KidsNote Automation Task Scheduler Setup
# This script registers the kidsnote-automation tool to run daily at a specific time.

param (
    [int]$Hour = 22
)

$TimeStr = "{0:D2}:00" -f $Hour
# Running from 'system' directory, call the start.bat inside 'bat'
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c start /min bat\start.bat" -WorkingDirectory "$PSScriptRoot\.."
$Trigger = New-ScheduledTaskTrigger -Daily -At $TimeStr
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName "KidsNoteBackup" -Action $Action -Trigger $Trigger -Settings $Settings -Description "Daily backup of KidsNote" -Force

Write-Host "=========================================="
Write-Host "  KidsNote 자동 백업 예약 완료!"
Write-Host "  - 매일 $TimeStr 시에 실행됩니다."
Write-Host "=========================================="
