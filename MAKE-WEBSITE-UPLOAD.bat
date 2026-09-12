@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Build Movement Website Upload

rem --no-ui runs the same build without opening Explorer or waiting for a key.
set "WEB_BUILD_INTERACTIVE=1"
if /I "%~1"=="--no-ui" set "WEB_BUILD_INTERACTIVE=0"
set "WEB_BUILD_PUSHED=0"
pushd "%~dp0"
if errorlevel 1 goto :failed
set "WEB_BUILD_PUSHED=1"

where node.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not available in PATH.
    goto :failed
)
where php.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: PHP is not available in PATH. Add your PHP folder to PATH.
    goto :failed
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Windows PowerShell is not available in PATH.
    goto :failed
)

echo.
echo Building website files from your current local project...
node.exe tools\build-web.cjs
if errorlevel 1 goto :failed

echo.
echo READY TO UPLOAD
echo.
echo FileZilla: upload the CONTENTS of dist\website\upload
echo cPanel: upload dist\website\website.zip and extract into the website root.
echo.
echo Keep the live app-config.php, private-data and examples untouched.
echo This builder does not connect to or change your live website.
echo.
if "%WEB_BUILD_INTERACTIVE%"=="1" start "" explorer.exe "%CD%\dist\website"
popd
if "%WEB_BUILD_INTERACTIVE%"=="1" pause
exit /b 0

:failed
echo.
echo BUILD FAILED. Do not upload the output from this attempt.
echo Check the error above, correct it, and run this file again.
if "%WEB_BUILD_PUSHED%"=="1" popd
if "%WEB_BUILD_INTERACTIVE%"=="1" pause
exit /b 1
