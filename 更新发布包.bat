@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Update Release
set "PY=python"
if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
"%PY%" "%~dp0tools\sync_release.py"
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" (echo Update failed: %RC%) else (echo Update completed.)
pause
exit /b %RC%
