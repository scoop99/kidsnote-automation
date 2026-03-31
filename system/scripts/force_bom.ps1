$menuScript = @'
# KidsNote Automation Master Menu
function Show-Master-Menu {
    Clear-Host
    Write-Host ""
    Write-Host "======================================================"
    Write-Host "   키즈노트 자동 백업 통합 관리 도구"
    Write-Host "======================================================"
    Write-Host ""
    Write-Host "  1. [설치] 프로그램 환경 설정 (최초 1회 필수)"
    Write-Host "  2. [시작] 지금 즉시 백업 수행 (로그인 창 실행)"
    Write-Host "  3. [예약] 매일 정해진 시간에 자동 백업 설정"
    Write-Host "  4. [해제] 매일 자동 백업 기능 끄기"
    Write-Host "  5. [도움말] 상세 사용 설명서 열기"
    Write-Host "  6. [종료] 프로그램 닫기"
    Write-Host ""
    Write-Host "======================================================"
    $choice = Read-Host "원하는 메뉴 번호를 입력하고 엔터를 누르세요 (1-6)"
    return $choice
}

while ($true) {
    $c = Show-Master-Menu
    if ($c -eq "1") { 
        Clear-Host
        Write-Host "[상태] 설치를 진행 중입니다..."
        Start-Process "cmd.exe" -ArgumentList "/c system\bat\setup.bat" -Wait
    } elseif ($c -eq "2") {
        Clear-Host
        Write-Host "[상태] 백업을 시작합니다..."
        Start-Process "cmd.exe" -ArgumentList "/c system\bat\start.bat" -Wait
    } elseif ($c -eq "3") {
        Clear-Host
        Start-Process "cmd.exe" -ArgumentList "/c system\bat\setup_schedule.bat" -Wait
    } elseif ($c -eq "4") {
        Clear-Host
        Start-Process "cmd.exe" -ArgumentList "/c system\bat\remove_schedule.bat" -Wait
    } elseif ($c -eq "5") {
        Clear-Host
        Write-Host "[안내] 한글 설명서를 메모장으로 엽니다."
        Start-Process "notepad.exe" -ArgumentList "MANUAL.md"
    } elseif ($c -eq "6") {
        exit
    } else {
        Write-Host "잘못된 입력입니다. 1~6 사이의 숫자를 입력해 주세요."
        Start-Sleep -Seconds 1
    }
}
'@

$path = "$PSScriptRoot\start_menu.ps1"
# In PowerShell 5.1, -Encoding UTF8 creates UTF-8 with BOM (Byte Order Mark)
# Windows CMD/PowerShell on KR locale NEEDS this to detect UTF-8 properly.
$menuScript | Out-File -FilePath $path -Encoding UTF8
