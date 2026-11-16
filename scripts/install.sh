#!/bin/bash
# Build the editor bundle and the debug APK, then install it on the phone that adb sees.
set -euo pipefail
cd "$(dirname "$0")/.."
./gradlew :app:assembleDebug --quiet
adb install -r app/build/outputs/apk/debug/app-debug.apk
