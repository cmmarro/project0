@echo off
REM Castaway - grab the latest version. Double-click me.
REM Keeps your settings and your installed packages; only the game files change.

setlocal
cd /d "%~dp0"
set BRANCH=claude/llm-game-characters-gyqubv
set URL=https://github.com/cmmarro/project0/archive/refs/heads/%BRANCH%.zip

echo.
echo   Downloading the latest Castaway...
echo.

if exist _update rmdir /s /q _update
mkdir _update

curl -L --fail --silent --show-error -o _update\latest.zip "%URL%"
if errorlevel 1 (
  echo.
  echo   Couldn't download it. Check you're online, then try again.
  echo   If this keeps failing, download the ZIP by hand from:
  echo   https://github.com/cmmarro/project0/tree/%BRANCH%
  echo.
  rmdir /s /q _update
  pause
  exit /b 1
)

tar -xf _update\latest.zip -C _update
if errorlevel 1 (
  echo   Couldn't unpack the download. Is this Windows 10 or newer?
  rmdir /s /q _update
  pause
  exit /b 1
)

REM The zip unpacks into one folder whose name we don't want to guess.
for /d %%D in (_update\project0-*) do set SRC=%%D

REM /XD .venv keeps your installed packages. settings.json now lives in
REM %APPDATA%\castaway, so updating can't touch it either way.
robocopy "%SRC%" "." /E /XD .venv _update /NFL /NDL /NJH /NJS /NP >nul
rmdir /s /q _update

echo.
echo   Updated. Starting the game.
echo.
call run.bat
