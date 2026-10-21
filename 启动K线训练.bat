@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "%~dp0data" mkdir "%~dp0data"
>>"%~dp0data\kline_launcher.log" echo [%time%] launcher start
title K-Line Training

rem Open the training page if the service is already running.
powershell -NoProfile -Command "try { Invoke-WebRequest 'http://127.0.0.1:8765/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
>>"%~dp0data\kline_launcher.log" echo [%time%] health=%errorlevel%
if %errorlevel%==0 (
  powershell -NoProfile -Command "Start-Process 'http://127.0.0.1:8765/training'"
  exit /b 0
)

rem Start the browser after the local service has had time to boot.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://127.0.0.1:8765/training'"
set "PY=python"
if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe"
"%PY%" server.py
echo.
echo Server stopped. Press any key to close this window.
pause >nul
