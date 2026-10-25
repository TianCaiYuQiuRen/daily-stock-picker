@echo off
chcp 65001 >nul
title Allow LAN Access - Daily Stock Picker
net session >nul 2>&1
if %errorlevel% neq 0 (
  set "LAUNCH_PATH=%~f0"
  powershell -NoProfile -Command "Start-Process -FilePath $env:LAUNCH_PATH -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="DailyStockPicker8765" >nul 2>&1
netsh advfirewall firewall add rule name="DailyStockPicker8765" dir=in action=allow protocol=TCP localport=8765 >nul
if %errorlevel%==0 (
  echo [OK] TCP port 8765 allowed.
) else (
  echo [FAILED] Please allow Python in Windows Firewall manually.
)

for /f %%i in ('powershell -NoProfile -Command "$s=New-Object Net.Sockets.UdpClient; $s.Connect('8.8.8.8',80); ($s.Client.LocalEndPoint).Address.ToString()"') do set LANIP=%%i
echo.
echo Open this on a phone or another PC on the same Wi-Fi:
echo     http://%LANIP%:8765
echo.
pause
