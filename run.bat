@echo off
REM Castaway - double-click me on Windows.
REM Sets up everything the first time, then just starts the game.

setlocal enabledelayedexpansion
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

set VPY=.venv\Scripts\python.exe

REM Check for the interpreter itself, not the folder. A venv that half-created
REM leaves a .venv directory behind, and checking the folder means we never
REM retry - we just fail at pip forever with a confusing message.
if not exist "%VPY%" (
  if exist ".venv" (
    echo   The .venv folder is broken. Rebuilding it.
    rmdir /s /q .venv
  )
  echo.
  echo   First run - setting up. This takes a minute, and only happens once.
  echo.
  %PY% -m venv .venv
)

if not exist "%VPY%" (
  echo.
  echo   Couldn't build the private Python environment, so falling back to
  echo   installing into your main Python instead. This still works fine.
  echo.
  %PY% -m pip install --user -r requirements.txt
  if errorlevel 1 goto :pipfailed
  %PY% server.py
  goto :done
)

REM Only touch the network when something is actually missing. A normal start
REM shouldn't be able to fail because pip is having a bad day.
"%VPY%" -c "import flask" >nul 2>&1
if not errorlevel 1 goto :run

echo   Installing what the game needs. One minute, first time only.
"%VPY%" -m ensurepip --upgrade >nul 2>&1
"%VPY%" -m pip install --disable-pip-version-check -r requirements.txt > pip-log.txt 2>&1
if errorlevel 1 goto :pipfailed

"%VPY%" -c "import flask" >nul 2>&1
if errorlevel 1 goto :pipfailed

:run
echo.
"%VPY%" server.py
goto :done

:pipfailed
echo.
echo   ---------------------------------------------------------------
echo   Setup failed: couldn't install the packages the game needs.
echo.
echo   This is NOT the same as the game saying "offline" - that's the
echo   survivors' model backend, which you pick in the browser.
echo.
if exist pip-log.txt (
  echo   What actually went wrong:
  echo.
  powershell -NoProfile -Command "Get-Content pip-log.txt -Tail 12" 2>nul
  echo.
  echo   The full log is in pip-log.txt next to this file.
  echo.
)
echo   To do it by hand, open a terminal in this folder and run:
echo.
echo       .venv\Scripts\python.exe -m pip install -r requirements.txt
echo.
echo   Then double-click run.bat again.
echo   ---------------------------------------------------------------
echo.
pause
exit /b 1

:done
echo.
echo   Castaway has stopped.
pause
