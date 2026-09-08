@echo off
REM cmd reads this file in the system code page, so keep everything here ASCII.
REM (chcp below applies to what runs afterwards, not to parsing this file.)
REM Switching to UTF-8 lets the server's Japanese output show correctly.
chcp 65001 > nul
cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org/ and run this again.
  echo.
  pause
  exit /b 1
)

REM Check the package itself rather than the folder: a failed install can leave
REM an empty node_modules behind.
if not exist "node_modules\proper-lockfile" (
  echo Installing dependencies ^(first run only^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
  echo.
)

REM The port shifts when 7317 is taken, so the server opens the browser itself.
node server.mjs --open

echo.
echo Viewer stopped.
pause
