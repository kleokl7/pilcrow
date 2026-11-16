#!/bin/bash
# Builds the editor and photographs Home, Formatted, Source and the conflict question at phone size,
# in light and dark, with headless Chrome. Output: build/shots/light.png and build/shots/dark.png.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd editor && npm run build --silent)
mkdir -p build/shots
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for theme in light dark; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --virtual-time-budget=6000 --window-size=1584,848 \
    --screenshot="$PWD/build/shots/$theme.png" "file://$PWD/scripts/shots.html?theme=$theme" >/dev/null 2>&1
  echo "build/shots/$theme.png"
done
