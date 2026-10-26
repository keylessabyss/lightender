@echo off
setlocal
cd /d "%~dp0"
set "PORT=8090"
if not exist "index.html" (
  echo ERROR: index.html not found in %CD%
  echo Place this launcher alongside your HTML5 game's index.html.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  pause
  exit /b 1
)
netstat -ano -p tcp | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo ERROR: Port %PORT% is already in use.
  echo Close the existing server or change PORT in this file.
  pause
  exit /b 1
)
echo Serving %CD% at http://localhost:%PORT%/index.html
start "" "http://localhost:%PORT%/index.html"
call npx --yes serve@14.2.5 . -l tcp://127.0.0.1:%PORT% --no-clipboard
pause
