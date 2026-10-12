@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js first.
  echo.
  pause
  exit /b 1
)
node "%~dp0install.js" %*
echo.
pause
