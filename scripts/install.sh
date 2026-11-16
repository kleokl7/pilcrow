#!/bin/bash
# Build the editor bundle and the app, then install it on the phone that adb sees.
# With keystore.properties present this installs the signed release build, so it updates an
# installed release in place. Without it, the debug build is installed.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e keystore.properties ]; then task=assembleRelease; dir=release; else task=assembleDebug; dir=debug; fi
./gradlew ":app:$task" --quiet
adb install -r app/build/outputs/apk/$dir/pilcrow-*-$dir.apk
