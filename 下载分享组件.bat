@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "bin\cloudflared.exe" (
  for %%A in ("bin\cloudflared.exe") do if %%~zA GTR 30000000 (
    echo [OK] bin\cloudflared.exe already exists.
    pause
    exit /b 0
  )
)
if not exist "bin" mkdir "bin"
echo Downloading cloudflared share component ^(about 55MB^)...
echo.

set URL1=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
set URL2=https://ghfast.top/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe

curl -L --retry 2 --max-time 600 -o "bin\cloudflared.exe.part" "%URL1%"
if not exist "bin\cloudflared.exe.part" goto try2
for %%A in ("bin\cloudflared.exe.part") do if %%~zA GTR 40000000 goto done

:try2
echo Primary route was slow. Trying mirror...
curl -L --retry 2 --max-time 600 -o "bin\cloudflared.exe.part" "%URL2%"
if not exist "bin\cloudflared.exe.part" goto fail
for %%A in ("bin\cloudflared.exe.part") do if %%~zA LSS 40000000 goto fail

:done
move /y "bin\cloudflared.exe.part" "bin\cloudflared.exe" >nul
echo.
echo [OK] Downloaded: bin\cloudflared.exe
echo Return to the web page and click Share.
pause
exit /b 0

:fail
echo.
echo [FAILED] Automatic download failed.
echo Open this URL in a browser:
echo %URL1%
echo Then rename the file to cloudflared.exe and put it in the bin folder.
pause
exit /b 1
