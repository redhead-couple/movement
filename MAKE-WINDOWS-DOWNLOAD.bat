@echo off
setlocal EnableExtensions
title Build Movement Timeline Studio Windows Download

rem This file works from either the project root or the folder above "public".
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%"
if exist "%SCRIPT_DIR%public\package.json" set "PROJECT_DIR=%SCRIPT_DIR%public\"

if not exist "%PROJECT_DIR%package.json" (
    echo.
    echo ERROR: Could not find package.json.
    echo Put this file inside the public folder or directly above it.
    goto :failed
)

where node.exe >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js is not installed or is not available in PATH.
    echo Install Node.js 22.12 or newer, then run this file again.
    goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: npm.cmd is not available in PATH.
    echo Reinstall Node.js with npm, then run this file again.
    goto :failed
)

pushd "%PROJECT_DIR%"
if errorlevel 1 goto :failed

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%V"

echo.
echo ============================================================
echo   Movement Timeline Studio - Windows Download Builder
echo ============================================================
echo.
echo Current version: %CURRENT_VERSION%
echo.
echo [1] Rebuild version %CURRENT_VERSION%
echo     Use this while testing. The existing ZIP is replaced.
echo.
echo [2] Create the next alpha build
echo     Increments the prerelease, for example 0.1.0-alpha.1 to 0.1.0-alpha.2.
echo.
choice /C 12 /N /M "Choose 1 or 2: "
if errorlevel 2 (
    set "BUMP_VERSION=1"
) else (
    set "BUMP_VERSION=0"
)

if not exist "node_modules\electron\package.json" (
    echo.
    echo Installing project dependencies. This is normally needed only once...
    call npm.cmd install
    if errorlevel 1 goto :build_failed
)

echo.
echo Running the test suite...
call npm.cmd test
if errorlevel 1 goto :build_failed

if "%BUMP_VERSION%"=="1" (
    echo.
    echo Creating the next alpha version...
    call npm.cmd version prerelease --preid=alpha --no-git-tag-version
    if errorlevel 1 goto :build_failed
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "BUILD_VERSION=%%V"

echo.
echo Building Windows ZIP version %BUILD_VERSION%...
call npm.cmd run dist:authoring-kit
if errorlevel 1 goto :build_failed

set "OUTPUT_DIR=%PROJECT_DIR%dist\desktop-authoring-kit"
set "ZIP_PATH=%OUTPUT_DIR%\Movement Timeline Studio-Authoring-Kit-%BUILD_VERSION%-x64.zip"

if not exist "%ZIP_PATH%" (
    echo.
    echo ERROR: The build finished but the expected ZIP was not found:
    echo %ZIP_PATH%
    goto :build_failed
)

echo.
echo ============================================================
echo   BUILD COMPLETED SUCCESSFULLY
echo ============================================================
echo.
echo Version: %BUILD_VERSION%
echo ZIP:     %ZIP_PATH%
echo.
echo The download page will use this file automatically on this computer.
echo For the live website, upload the ZIP to /dist/desktop-authoring-kit/.
echo.

start "" explorer.exe "%OUTPUT_DIR%"
popd
pause
exit /b 0

:build_failed
echo.
echo ============================================================
echo   BUILD FAILED
echo ============================================================
echo Read the error above. The old downloadable ZIP was not intentionally removed.
popd

:failed
echo.
pause
exit /b 1
