#!/usr/bin/env bash
# Run only on the disposable CI emulator: connectedAndroidTest removes target apps.
set -uo pipefail
verification_status=0
./gradlew :app:connectedDebugAndroidTest || verification_status=$?
mkdir -p ../../output/android-design
adb pull /sdcard/Download/acornary-design-qa ../../output/android-design/ || true
exit "$verification_status"
