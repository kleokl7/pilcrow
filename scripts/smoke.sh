#!/bin/bash
# Smoke test on a real device or emulator: install an APK, start it, and check that the editor
# page really loads inside the app (the Home screen with its "Open from Drive" button appears).
# This is the one thing the unit tests cannot see: the WebView and the bundled page together.
#
#   scripts/smoke.sh                      # the release APK that Gradle built
#   scripts/smoke.sh path/to/pilcrow.apk  # any APK
set -euo pipefail
cd "$(dirname "$0")/.."

apk="${1:-$(ls app/build/outputs/apk/release/pilcrow-*-release.apk 2>/dev/null | head -1)}"
[ -f "$apk" ] || { echo "smoke: no APK found. Build one first, or pass a path." >&2; exit 2; }
package=io.github.kleokl7.pilcrow

adb get-state >/dev/null 2>&1 || { echo "smoke: adb sees no device." >&2; exit 2; }
adb install -r "$apk" >/dev/null
adb shell am force-stop "$package"
adb shell am start -n "$package/dev.pilcrow.editor.MainActivity" >/dev/null

for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    adb shell uiautomator dump /sdcard/pilcrow-smoke.xml >/dev/null 2>&1 || continue
    screen="$(adb shell cat /sdcard/pilcrow-smoke.xml)"
    if grep -q 'Open from Drive' <<< "$screen"; then
        echo "smoke: PASS. Home screen loaded from $apk"
        exit 0
    fi
done
echo "smoke: FAIL. The Home screen did not appear. Text on screen:" >&2
grep -o 'text="[^"]\{2,\}"' <<< "${screen:-}" | head -10 >&2 || true
exit 1
