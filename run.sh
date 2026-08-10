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

if [ ! -d .venv ]; then
  echo
  echo "  First run — setting up. This takes a minute, only happens once."
  echo
  "$PY" -m venv .venv
fi

echo "  Checking dependencies..."
.venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt

echo
exec .venv/bin/python server.py
