$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Desktop = [Environment]::GetFolderPath("Desktop")
$Shell = New-Object -ComObject WScript.Shell

function New-Shortcut {
    param(
        [string]$Name,
        [string]$Target,
        [string]$Icon,
        [string]$Description
    )
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Host "跳过 $Name：找不到 $Target" -ForegroundColor Yellow
        return
    }
    $LinkPath = Join-Path $Desktop ($Name + ".lnk")
    $Shortcut = $Shell.CreateShortcut($LinkPath)
    $Shortcut.TargetPath = $Target
    $Shortcut.WorkingDirectory = $Root
    $Shortcut.Description = $Description
    if ($Icon -and (Test-Path -LiteralPath $Icon)) {
        $Shortcut.IconLocation = "$Icon,0"
    }
    $Shortcut.Save()
    Write-Host "已创建桌面快捷方式：$LinkPath" -ForegroundColor Green
}

$DailyBat = Join-Path $Root "启动选股系统.bat"
if (-not (Test-Path -LiteralPath $DailyBat)) {
    $DailyBat = Join-Path $Root "启动.bat"
}
New-Shortcut -Name "每日选股" -Target $DailyBat -Icon (Join-Path $Root "assets\app.ico") `
    -Description "每日选股 · 智选"

New-Shortcut -Name "K线训练" -Target (Join-Path $Root "启动K线训练.bat") `
    -Icon (Join-Path $Root "assets\training.ico") -Description "K线训练营 · 200根真实历史回放"

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($Shell) | Out-Null
