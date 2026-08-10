#!/usr/bin/env bash
# Castaway — run me on macOS or Linux:  ./run.sh
# Sets up everything the first time, then just starts the game.

set -e
cd "$(dirname "$0")"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  cat <<'MSG'

  Python isn't installed.

  macOS:  brew install python
          (or grab it from https://www.python.org/downloads/)
  Linux:  sudo apt install python3 python3-venv

  Then run ./run.sh again.

MSG
  exit 1
fi

VPY=".venv/bin/python"

# Check for the interpreter, not the folder. A venv that half-created leaves a
# .venv directory behind, and checking the folder means we never retry — we
# just fail at pip forever with a confusing message.
if [ ! -x "$VPY" ]; then
  [ -d .venv ] && { echo "  The .venv folder is broken. Rebuilding it."; rm -rf .venv; }
  echo
  echo "  First run — setting up. This takes a minute, and only happens once."
  echo
  "$PY" -m venv .venv || true
fi

pipfailed() {
  cat <<MSG

  ---------------------------------------------------------------
  Setup failed: couldn't install the packages the game needs.

  This is NOT the same as the game saying "offline" — that's the
  survivors' model backend, which you pick in the browser.
MSG
  [ -f pip-log.txt ] && { echo; echo "  What actually went wrong:"; echo; tail -12 pip-log.txt; echo; echo "  Full log in pip-log.txt."; }
  cat <<MSG

  To do it by hand, run:

      $1 -m pip install -r requirements.txt

  Then run ./run.sh again.
  ---------------------------------------------------------------

MSG
  exit 1
}

if [ ! -x "$VPY" ]; then
  echo
  echo "  Couldn't build the private environment (on Debian/Ubuntu you may need"
  echo "  'sudo apt install python3-venv'). Falling back to your main Python."
  echo
  "$PY" -m pip install --user -r requirements.txt || pipfailed "$PY"
  exec "$PY" server.py
fi

# Only touch the network when something is actually missing. A normal start
# shouldn't be able to fail because pip is having a bad day.
if ! "$VPY" -c "import flask" >/dev/null 2>&1; then
  echo "  Installing what the game needs. One minute, first time only."
  "$VPY" -m ensurepip --upgrade >/dev/null 2>&1 || true
  "$VPY" -m pip install --disable-pip-version-check -r requirements.txt >pip-log.txt 2>&1 \
    || pipfailed "$VPY"
  "$VPY" -c "import flask" >/dev/null 2>&1 || pipfailed "$VPY"
fi

echo
exec "$VPY" server.py
