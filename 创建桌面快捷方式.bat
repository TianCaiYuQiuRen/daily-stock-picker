@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Create Desktop Shortcuts
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_shortcuts.ps1"
echo.
pause
