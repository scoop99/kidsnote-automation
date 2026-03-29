# KidsNote Automation Master Menu
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show-Menu {
    Clear-Host
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host " 키즈노트 자동 백업 관리 도구 " -ForegroundColor White -BackgroundColor Blue
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host "1. 프로그램 설치 (초기 1회)"
    Write-Host "2. 즉시 백업 시작"
    Write-Host "3. 백업 시간 예약"
    Write-Host "4. 예약 해제"
    Write-Host "5. 도움말 보기"
    Write-Host "6. 경로 변경"
    Write-Host "Q. 종료"
    Write-Host "===============================" -ForegroundColor Cyan
}

function Run-StartBat {
    param([string]$arg)
    $cmd = "/c system\bat\start.bat $arg"
    Start-Process cmd.exe -ArgumentList $cmd -Wait
}

do {
    Show-Menu
    $choice = Read-Host "선택하세요"
    switch ($choice) {
        "1" { Run-StartBat "install" }
        "2" {
            $sub = Read-Host "1:이번달, 2:날짜지정, 3:전체"
            if ($sub -eq "1") { Run-StartBat "" }
            elseif ($sub -eq "2") { 
                $target = Read-Host "연-월 (예: 2024-03)"
                Run-StartBat $target
            }
            elseif ($sub -eq "3") { Run-StartBat "all" }
        }
        "3" { 
            $hour = Read-Host "시간 (0-23)"
            Start-Process cmd.exe -ArgumentList "/c system\bat\setup_schedule.bat $hour" -Wait 
        }
        "4" { Start-Process cmd.exe -ArgumentList "/c system\bat\remove_schedule.bat" -Wait }
        "5" { if (Test-Path "MANUAL.md") { Start-Process notepad.exe "MANUAL.md" } }
        "6" { 
            if (Test-Path "system/config.json") {
                $config = Get-Content -Path "system/config.json" -Raw -Encoding UTF8 | ConvertFrom-Json
                Write-Host "현재: $($config.download_path)"
                $newPath = Read-Host "새 경로 (엔터 시 취소)"
                if ($newPath) {
                    $config.download_path = $newPath
                    $config | ConvertTo-Json | Set-Content -Path "system/config.json" -Encoding UTF8
                }
            }
        }
        "q" { exit }
        "Q" { exit }
    }
} while ($true)
