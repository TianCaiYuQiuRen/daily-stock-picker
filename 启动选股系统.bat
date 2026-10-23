@echo off
cd /d "%~dp0"
wscript "%~dp0run_hidden.vbs"
ping -n 3 127.0.0.1 >nul
start "" "http://127.0.0.1:8765"
exit /b 0
