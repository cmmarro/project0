@echo off
REM Castaway - double-click me on Windows.
REM Sets up everything the first time, then just starts the game.

setlocal
cd /d "%~dp0"

REM Find Python. The Microsoft Store stub called "python" is useless, so try py first.
set PY=
where py >nul 2>&1 && set PY=py
if "%PY%"=="" ( where python >nul 2>&1 && set PY=python )

if "%PY%"=="" (
  echo.
  echo   Python isn't installed, or isn't on your PATH.
  echo.
  echo   Get it from https://www.python.org/downloads/
  echo   IMPORTANT: tick "Add python.exe to PATH" on the first screen of the installer.
  echo   Then close this window and double-click run.bat again.
  echo.
  pause
  exit /b 1
)

if not exist ".venv" (
  echo.
  echo   First run - setting up. This takes a minute, only happens once.
  echo.
  %PY% -m venv .venv
  if errorlevel 1 (
    echo   Couldn't create the virtual environment. Is Python installed properly?
    pause
    exit /b 1
  )
)

echo   Checking dependencies...
".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo.
  echo   Couldn't install dependencies. Are you online?
  pause
  exit /b 1
)

echo.
".venv\Scripts\python.exe" server.py

echo.
echo   Castaway has stopped.
pause
