# KidsNote Automation Master Menu (UTF-8 with BOM)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show-Menu {
    Clear-Host
    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "          ?ㅼ쫰?명듃 ?먮룞 諛깆뾽 愿由??꾧뎄" -ForegroundColor White -BackgroundColor Blue
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. ?꾨줈洹몃옩 ?ㅼ튂 (珥덇린 1??"
    Write-Host "2. 利됱떆 諛깆뾽 ?쒖옉 (?대쾲 ???먮뒗 ?뱀젙 ??"
    Write-Host "3. 諛깆뾽 ?쒓컙 ?덉빟 (留ㅼ씪 ?먮룞)"
    Write-Host "4. ?먮룞 諛깆뾽 ?덉빟 ?댁젣"
    Write-Host "5. ?ъ슜踰?諛??꾩?留?蹂닿린 (MANUAL.md)"
    Write-Host "6. ???寃쎈줈 蹂寃?(湲곕낯: downloads)"
    Write-Host "Q. 醫낅즺"
    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Cyan
}

function Run-StartBat {
    param([string]$arg)
    $cmd = "/c system\bat\start.bat $arg"
    Start-Process cmd.exe -ArgumentList $cmd -Wait
}

function Set-Schedule {
    Write-Host "------------------------------------------------"
    $hour = Read-Host "留ㅼ씪 紐??쒖뿉 諛깆뾽?좉퉴?? (0~23 ?ъ씠???レ옄 ?낅젰)"
    if ($hour -match '^\d+$' -and [int]$hour -ge 0 -and [int]$hour -le 23) {
        $cmd = "/c system\bat\setup_schedule.bat $hour"
        Start-Process cmd.exe -ArgumentList $cmd -Wait
    }
    else {
        Write-Host "?섎せ???낅젰?낅땲?? 0~23 ?ъ씠???レ옄瑜??낅젰?섏꽭??" -ForegroundColor Red
        Start-Sleep -Seconds 2
    }
}

function Change-DownloadPath {
    Write-Host "------------------------------------------------"
    if (Test-Path "system/config.json") {
        $config = Get-Content -Path "system/config.json" -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "?꾩옱 寃쎈줈: $($config.download_path)"
        Write-Host ""
        Write-Host "[?낅젰 ?덉떆]" -ForegroundColor Yellow
        Write-Host " - D:\?ㅼ쫰?명듃?먮즺"
        Write-Host " - C:\User\Desktop\KidsNote"
        Write-Host ""
        $newPath = Read-Host "?덈줈?????寃쎈줈瑜??낅젰?섏꽭??(?뷀꽣 ??痍⑥냼)"
        if ($newPath) {
            $config.download_path = $newPath
            # Force UTF8 encoding with BOM for JSON
            $config | ConvertTo-Json | Set-Content -Path "system/config.json" -Encoding UTF8
            Write-Host "???寃쎈줈媛 蹂寃쎈릺?덉뒿?덈떎: $newPath" -ForegroundColor Cyan
        }
    }
    Start-Sleep -Seconds 2
}

do {
    Show-Menu
    $choice = Read-Host "?먰븯?쒕뒗 硫붾돱 踰덊샇瑜??좏깮?섏꽭??
    switch ($choice) {
        "1" { Run-StartBat "install" }
        "2" {
            Write-Host "------------------------------------------------"
            Write-Host "1. ?대쾲 ???먮즺留?諛깆뾽 (鍮좊쫫)"
            Write-Host "2. ?뱀젙 ???먮즺 諛깆뾽 (YYYY-MM ?뺤떇)"
            Write-Host "3. ?꾩껜 ?먮즺 諛깆뾽 (?먮┝)"
            $sub = Read-Host "?좏깮"
            switch ($sub) {
                "1" { Run-StartBat "" }
                "2" {
                    $target = Read-Host "?????낅젰 (?? 2024-03)"
                    if ($target -match '^\d{4}-\d{2}$') { Run-StartBat $target }
                }
                "3" { Run-StartBat "all" }
            }
        }
        "3" { Set-Schedule }
        "4" { Start-Process cmd.exe -ArgumentList "/c system\bat\remove_schedule.bat" -Wait }
        "5" { if (Test-Path "MANUAL.md") { Start-Process notepad.exe "MANUAL.md" } }
        "6" { Change-DownloadPath }
        "q" { exit }
        "Q" { exit }
    }
} while ($true)
