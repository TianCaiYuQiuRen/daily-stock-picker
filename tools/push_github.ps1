# 提交当前改动并推送到 GitHub（自动确保 VPN 已启动）
param(
    [string]$Message = "chore: 更新代码"
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

& "$PSScriptRoot\start_vpn.ps1"

$proxy = 'http://127.0.0.1:7897'
git config --global http.proxy $proxy
git config --global https.proxy $proxy
$env:GIT_TERMINAL_PROMPT = '0'

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "没有需要提交的改动"
} else {
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw "git commit 失败" }
}

git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push 失败" }

Write-Host "--- 远端 main ---"
git ls-remote --heads origin
