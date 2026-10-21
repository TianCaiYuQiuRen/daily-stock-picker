@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Daily Stock Picker

rem Open the stock picker if the service is already running.
powershell -NoProfile -Command "try { Invoke-WebRequest 'http://127.0.0.1:8765/api/state' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  powershell -NoProfile -Command "Start-Process 'http://127.0.0.1:8765'"
  exit /b 0
)

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://127.0.0.1:8765'"
set "PY=python"
if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe"
"%PY%" server.py
echo.
echo Server stopped. Press any key to close this window.
pause >nul
