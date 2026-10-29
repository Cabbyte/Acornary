#!/usr/bin/env python3
"""One-time debug -> release migration using Android 9+ proof of rotation, no data wipe."""
import getpass, os, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]
JAVA = pathlib.Path('/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home')
SIGNING = pathlib.Path.home() / '.config/acornary/android-signing'
SIGNER = pathlib.Path.home() / 'Library/Android/sdk/build-tools/36.0.0/apksigner'
key = SIGNING / 'terminal-release.jks'
lineage = SIGNING / 'debug-to-release.lineage'
password = subprocess.check_output(['security','find-generic-password','-a',getpass.getuser(),'-s','Acornary Android release signing','-w'],text=True).rstrip('\n')
env = dict(os.environ, JAVA_HOME=str(JAVA), ACORNARY_ANDROID_KEY_PASSWORD=password)
newSigner = ['--ks',str(key),'--ks-key-alias','acornary-terminal','--ks-pass','env:ACORNARY_ANDROID_KEY_PASSWORD']
# The same historical permission capability is needed to upgrade each permission owner.
subprocess.run([str(SIGNER),'rotate','--out',str(lineage),'--old-signer','--ks',str(pathlib.Path.home()/'.android/debug.keystore'),'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--set-installed-data','true','--set-shared-uid','false','--set-permission','true','--set-rollback','false','--set-auth','false','--new-signer',*newSigner],env=env,check=True)
lineage.chmod(0o600)
for module in ['app','aod','overlay']:
    apk=ROOT/module/'build/outputs/apk/release'/f'{module}-release.apk'
    output=apk.with_name(f'{module}-migration.apk')
    subprocess.run([str(SIGNER),'sign',*newSigner,'--lineage',str(lineage),'--rotation-min-sdk-version','28','--v1-signing-enabled','false','--v2-signing-enabled','false','--v4-signing-enabled','false','--out',str(output),str(apk)],env=env,check=True)
    subprocess.run([str(SIGNER),'verify','--min-sdk-version','31',str(output)],env=env,check=True)
    print(module+': release certificate with verified migration lineage')
