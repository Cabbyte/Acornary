#!/usr/bin/env python3
"""Pixel 3 hardware deployment. All system changes live in one removable Magisk module."""
import argparse
import json
import pathlib
import shlex
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUTPUT = REPO / "output/android"
SERIAL = "8AJX0TMS5"
FINGERPRINT = "google/blueline/blueline:12/SP1A.210812.016.C2/8618562:user/release-keys"
MODULE = "/data/adb/modules/acornary_pixel3_aod"
OVERLAY = "top.protium.acornary.aod.overlay"
COMPONENT = "top.protium.acornary.aod/.AcornaryDreamService"

ADB = shutil.which("adb") or str(pathlib.Path.home() / "Library/Android/sdk/platform-tools/adb")

def adb(*args):
    return subprocess.check_output([ADB, "-s", SERIAL, *args], text=True, timeout=90).strip()

def shell(command, root=False):
    return adb("shell", "su -c " + shlex.quote(command) if root else command)

def check_device():
    if shell("getprop ro.build.fingerprint") != FINGERPRINT:
        raise SystemExit("Refusing an unverified device/firmware; Pixel 3 SP1A.210812.016.C2 required.")
    if "uid=0(" not in shell("id", root=True):
        raise SystemExit("Magisk Shell root authorization is required.")

def install(variant="release", migration=False):
    check_device()
    if "RUNNING_UNLOCKED" not in shell("dumpsys user"):
        raise SystemExit("Unlock the phone once after reboot before installing an app update.")
    baseline = OUTPUT / "pixel3-baseline/settings.json"
    if not baseline.exists():
        raise SystemExit("Save the original device settings before installing the AOD module.")
    suffix = "migration" if migration else variant
    apks = {name: ROOT / name / "build/outputs/apk" / variant / f"{name}-{suffix}.apk" for name in ("app", "aod", "overlay")}
    if not all(p.is_file() for p in apks.values()):
        raise SystemExit("Build all three APKs for the selected variant first.")
    stage = OUTPUT / "magisk-stage/acornary_pixel3_aod"
    if stage.exists():
        shutil.rmtree(stage)
    def write(name, value):
        p = stage / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(value)
    write("module.prop", "id=acornary_pixel3_aod\nname=Acornary Pixel 3 AOD\nversion=0.2.0-terminal\nversionCode=2\nauthor=Acornary\ndescription=Reversible Android 12 Pixel 3 ambient display integration\n")
    write("system/etc/sysconfig/acornary-aod.xml", '<config><hidden-api-whitelisted-app package="top.protium.acornary.aod" /></config>\n')
    for module, target in [("aod", "system/priv-app/AcornaryAod/AcornaryAod.apk"), ("overlay", "system/product/overlay/AcornaryAodOverlay.apk")]:
        p = stage / target
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(apks[module], p)
    write("service.sh", '''#!/system/bin/sh
MODDIR=${0%/*}
# Bound boot waiting as well as verification; never hold up Android boot.
attempt=0
until [ "$(getprop sys.boot_completed)" = "1" ]; do
  sleep 2
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    touch "$MODDIR/disable"
    /system/bin/reboot
    exit 1
  fi
done
if [ "$(getprop ro.build.fingerprint)" != "google/blueline/blueline:12/SP1A.210812.016.C2/8618562:user/release-keys" ]; then
  touch "$MODDIR/disable"
  exit 1
fi
# Only the signed companion receives the two bounded settings capabilities.
pm grant top.protium.acornary.aod android.permission.WRITE_SECURE_SETTINGS
appops set top.protium.acornary.aod WRITE_SETTINGS allow
# The first boot requires explicit verification. Restore stock AOD if validation never arrives.
sleep 300
if [ ! -f "$MODDIR/validated" ]; then
  touch "$MODDIR/disable"
  # Static framework overlays are loaded before system_server starts.
  /system/bin/reboot
fi
''')
    print(adb("install", "-r", str(apks["app"])))
    # Android may prefer an existing /data update over the Magisk system APK.
    # Keep that update in sync when iterating on an already installed companion.
    if shell("pm path top.protium.acornary.aod || true"):
        print(adb("install", "-r", str(apks["aod"])))
    print(adb("push", str(stage), "/data/local/tmp/"))
    # A task-owned module path only; existing third-party modules are not modified.
    shell(f"mkdir -p {MODULE}; cp -R /data/local/tmp/acornary_pixel3_aod/. {MODULE}/; chown -R 0:0 {MODULE}; find {MODULE} -type d -exec chmod 755 '{{}}' ';'; find {MODULE} -type f -exec chmod 644 '{{}}' ';'; chmod 755 {MODULE}/service.sh; rm -f {MODULE}/disable {MODULE}/validated {MODULE}/system/etc/permissions/privapp-permissions-acornary.xml", root=True)
    shell("pm grant top.protium.acornary.aod android.permission.WRITE_SECURE_SETTINGS; appops set top.protium.acornary.aod WRITE_SETTINGS allow", root=True)
    print("Module staged. Reboot required; first-boot verification has a 300-second recovery timer.")

def validate():
    check_device()
    component = shell("cmd overlay lookup android android:string/config_dozeComponent")
    dreams = shell("dumpsys dreams")
    if component != COMPONENT or "mCurrentDreamIsDozing=true" not in dreams or "top.protium.acornary.aod" not in dreams:
        raise SystemExit("Not verified: must be the active dozing service before accepting installation.")
    if "mCurrentDreamDozeScreenState=DOZE" not in dreams:
        raise SystemExit("Not verified: low-power display state missing.")
    shell(f"touch {MODULE}/validated", root=True)
    (OUTPUT / "aod-verified.txt").write_text(dreams)
    print("Verified actual AOD component and low-power display state; recovery timer disarmed.")

def restore():
    check_device()
    baseline = json.loads((OUTPUT / "pixel3-baseline/settings.json").read_text())
    shell(f"touch {MODULE}/disable", root=True)
    for qualified, value in baseline.items():
        ns, key = qualified.split("/", 1)
        shell(f"settings delete {ns} {key}" if value == "null" else f"settings put {ns} {key} {shlex.quote(value)}")
    print("Module marked disabled and original settings restored. Reboot required to restore stock AOD.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["status", "install-aod", "validate-aod", "restore-aod"])
    parser.add_argument("--variant", choices=["debug", "release"], default="release")
    parser.add_argument("--migration", action="store_true", help="Use APKs with the debug-to-release proof of rotation")
    args = parser.parse_args()
    if args.action == "status":
        check_device()
        print(shell("dumpsys dreams"))
        print(shell("cmd overlay lookup android android:string/config_dozeComponent"))
    elif args.action == "install-aod": install(args.variant, args.migration)
    elif args.action == "validate-aod": validate()
    else: restore()
