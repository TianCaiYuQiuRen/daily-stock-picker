@echo off
chcp 65001 >nul
title 允许局域网访问每日选股
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="每日选股8765" >nul 2>&1
netsh advfirewall firewall add rule name="每日选股8765" dir=in action=allow protocol=TCP localport=8765 >nul
if %errorlevel%==0 (
  echo [OK] 已放行 TCP 8765 端口
) else (
  echo [失败] 放行失败，请手动在 Windows 防火墙中允许 Python
)

for /f %%i in ('powershell -NoProfile -Command "$s=New-Object Net.Sockets.UdpClient; $s.Connect('8.8.8.8',80); ($s.Client.LocalEndPoint).Address.ToString()"') do set LANIP=%%i
echo.
echo 同一 Wi-Fi 下，用手机/其他电脑打开：
echo     http://%LANIP%:8765
echo.
pause
