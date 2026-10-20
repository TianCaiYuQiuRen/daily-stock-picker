@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 每日选股系统

rem 如果服务已经在运行，直接打开网页
powershell -NoProfile -Command "try { Invoke-WebRequest 'http://127.0.0.1:8765/api/state' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "http://127.0.0.1:8765"
  exit /b 0
)

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://127.0.0.1:8765'"
python server.py
echo.
echo 服务已停止，按任意键关闭窗口。
pause >nul
