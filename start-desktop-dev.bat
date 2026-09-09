@echo off
setlocal
cd /d "%~dp0"
start "Movement Desktop Console" /min cmd.exe /d /c "npm.cmd run desktop"
endlocal
exit /b 0
