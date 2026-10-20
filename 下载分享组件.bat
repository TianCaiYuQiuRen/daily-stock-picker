@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "bin\cloudflared.exe" (
  for %%A in ("bin\cloudflared.exe") do if %%~zA GTR 30000000 (
    echo [OK] 已存在 bin\cloudflared.exe，无需下载。
    pause
    exit /b 0
  )
)
if not exist "bin" mkdir "bin"
echo 正在下载分享组件 cloudflared（约 55MB），请稍候...
echo.

set URL1=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
set URL2=https://ghfast.top/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe

curl -L --retry 2 --max-time 600 -o "bin\cloudflared.exe.part" "%URL1%"
if not exist "bin\cloudflared.exe.part" goto try2
for %%A in ("bin\cloudflared.exe.part") do if %%~zA GTR 40000000 goto done

:try2
echo 主线路较慢，切换镜像...
curl -L --retry 2 --max-time 600 -o "bin\cloudflared.exe.part" "%URL2%"
if not exist "bin\cloudflared.exe.part" goto fail
for %%A in ("bin\cloudflared.exe.part") do if %%~zA LSS 40000000 goto fail

:done
move /y "bin\cloudflared.exe.part" "bin\cloudflared.exe" >nul
echo.
echo [OK] 下载完成：bin\cloudflared.exe
echo 现在可以回到网页点右上角「分享」。
pause
exit /b 0

:fail
echo.
echo [失败] 自动下载未成功。请用浏览器打开下面的地址，
echo 下载后改名为 cloudflared.exe 放到本目录的 bin 文件夹：
echo %URL1%
pause
exit /b 1
