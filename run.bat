@echo off
rem Double-click this to play. It serves the folder and opens your browser.
rem The window has to stay open — closing it stops the server.

setlocal
cd /d "%~dp0"

rem Windows installs Python under several names depending on how you got it.
set "PY="
where py >nul 2>&1
if %errorlevel%==0 set "PY=py -3"
if not defined PY (
  where python >nul 2>&1
  if %errorlevel%==0 set "PY=python"
)
if not defined PY (
  where python3 >nul 2>&1
  if %errorlevel%==0 set "PY=python3"
)

if not defined PY (
  echo.
  echo   Python isn't installed, or Windows can't find it.
  echo.
  echo   Get it from https://www.python.org/downloads/ and tick
  echo   "Add python.exe to PATH" on the very first screen of the
  echo   installer. That box is easy to miss and nothing works without it.
  echo.
  echo   Then double-click this file again.
  echo.
  pause
  exit /b 1
)

%PY% serve.py %*

rem Only pause if something went wrong; a clean Ctrl+C shouldn't nag.
if %errorlevel% neq 0 (
  echo.
  pause
)
endlocal
