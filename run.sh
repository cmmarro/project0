#!/usr/bin/env sh
# Run this to play. It serves the folder and opens your browser.
# Leave the terminal open — closing it stops the server.

cd "$(dirname "$0")" || exit 1

for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1; then
    exec "$c" serve.py "$@"
  fi
done

echo
echo "  Python isn't installed, or the shell can't find it."
echo "  macOS:  brew install python   (or get it from python.org)"
echo "  Linux:  your package manager — apt install python3, dnf install python3, ..."
echo
exit 1
