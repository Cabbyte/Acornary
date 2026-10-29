#!/usr/bin/env python3
"""Build all three APKs with one local key. Secrets stay outside Git and command output."""
import argparse, getpass, os, pathlib, secrets, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]
JAVA = pathlib.Path('/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home')
SIGNING = pathlib.Path.home() / '.config/acornary/android-signing'
SERVICE = 'Acornary Android release signing'
ACCOUNT = getpass.getuser()
parser = argparse.ArgumentParser()
parser.add_argument('--create-key', action='store_true', help='Create a new dedicated signing key once')
args = parser.parse_args()
SIGNING.mkdir(parents=True, exist_ok=True, mode=0o700)
key = SIGNING / 'terminal-release.jks'
def security(*args):
    return subprocess.run(['security', *args], capture_output=True, text=True, check=True).stdout.rstrip('\n')
if args.create_key:
    if key.exists(): raise SystemExit('Key already exists; refusing replacement.')
    password = secrets.token_urlsafe(36)
    security('add-generic-password','-U','-a',ACCOUNT,'-s',SERVICE,'-w',password)
    env = dict(os.environ, ACORNARY_ANDROID_KEY_PASSWORD=password)
    subprocess.run([str(JAVA/'bin/keytool'),'-genkeypair','-keystore',str(key),'-storepass:env','ACORNARY_ANDROID_KEY_PASSWORD','-keypass:env','ACORNARY_ANDROID_KEY_PASSWORD','-alias','acornary-terminal','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Acornary Terminal, O=Acornary'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    key.chmod(0o600)
if not key.is_file(): raise SystemExit('Create the dedicated local key first with --create-key.')
password = security('find-generic-password','-a',ACCOUNT,'-s',SERVICE,'-w')
env = dict(os.environ, JAVA_HOME=str(JAVA), ACORNARY_ANDROID_KEYSTORE=str(key), ACORNARY_ANDROID_KEY_PASSWORD=password)
subprocess.run([str(ROOT/'gradlew'),':app:assembleRelease',':aod:assembleRelease',':overlay:assembleRelease'],cwd=ROOT,env=env,check=True)
# This is a public certificate fingerprint, safe to publish in assetlinks.json.
certificate = subprocess.check_output([str(JAVA/'bin/keytool'),'-exportcert','-keystore',str(key),'-storepass:env','ACORNARY_ANDROID_KEY_PASSWORD','-alias','acornary-terminal'],env=env)
import hashlib
fingerprint = ':'.join(f'{b:02X}' for b in hashlib.sha256(certificate).digest())
(SIGNING/'certificate-sha256.txt').write_text(fingerprint+'\n')
print('Android certificate SHA256:', fingerprint)
