# 启动 CokePLUS 并等待代理端口就绪
param(
    [string]$Exe = 'F:\CokePlus\CokePLUS.exe',
    [int]$Port = 7897
)
$ErrorActionPreference = 'Stop'

function Test-ProxyPort([int]$p) {
    return (Test-NetConnection 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue)
}

if (Test-ProxyPort $Port) {
    Write-Host "VPN 已在运行（127.0.0.1:$Port）"
    exit 0
}

if (-not (Test-Path $Exe)) {
    throw "找不到 CokePLUS：$Exe"
}

# 关键：去掉 ELECTRON_RUN_AS_NODE，否则 Electron 会被当成 Node 脚本运行并立即退出
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe)
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-ProxyPort $Port) {
        Write-Host "VPN 已启动（127.0.0.1:$Port）"
        exit 0
    }
}
throw "VPN 已启动但 $Port 端口未就绪，请在 CokePLUS 窗口里点「连接」后重试"
