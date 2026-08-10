#!/usr/bin/env bash
# Castaway — grab the latest version:  ./update.sh
# Keeps your settings and your installed packages; only the game files change.
set -e
cd "$(dirname "$0")"
BRANCH="claude/llm-game-characters-gyqubv"

if [ -d .git ]; then
  echo "  This is a git checkout, so just pulling."
  git pull origin "$BRANCH"
else
  echo "  Downloading the latest Castaway..."
  rm -rf _update && mkdir _update
  curl -L --fail -o _update/latest.zip \
    "https://github.com/cmmarro/project0/archive/refs/heads/$BRANCH.zip"
  ( cd _update && unzip -q latest.zip )
  SRC=$(find _update -maxdepth 1 -type d -name 'project0-*' | head -1)
  # -a but never touching .venv; settings.json lives in ~/.config/castaway.
  ( cd "$SRC" && tar cf - --exclude=.venv . ) | tar xf - -C .
  rm -rf _update
fi

chmod +x run.sh update.sh 2>/dev/null || true
echo
echo "  Updated. Starting the game."
echo
exec ./run.sh
