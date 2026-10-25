@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=8090"
set "ENTRY="

if exist "index.html" set "ENTRY=index.html"
if not defined ENTRY for %%F in (*.html) do if not defined ENTRY set "ENTRY=%%~nxF"

if not defined ENTRY (
    echo ERROR: No HTML entry file was found in this folder.
    pause
    exit /b 1
)

if not exist "HTML5LaunchHelper.exe" (
    echo ERROR: HTML5LaunchHelper.exe was not found in this folder.
    echo Run this launcher from the packed HTML5 output folder.
    pause
    exit /b 1
)

netstat -ano -p tcp | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
    echo ERROR: Port %PORT% is already in use.
    echo Change PORT in this file or close the existing server.
    pause
    exit /b 1
)

echo Serving "%CD%" at http://127.0.0.1:%PORT%/%ENTRY%
start "" "http://127.0.0.1:%PORT%/%ENTRY%"
HTML5LaunchHelper.exe -ServerRoot="%CD%" -ServerPort=%PORT%
pause
