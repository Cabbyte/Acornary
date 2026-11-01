#!/usr/bin/env python3
"""Install reviewed v2 controller/storage support without restarting or migrating.
Run as root from a trusted directory containing release.py. Preserve config and
all database files; refuse active/needs_attention jobs and unexpected baselines.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3:
        raise SystemExit('Usage (root): prepare-v2-runtime.py <old-controller-sha256> <old-compose-sha256>')
    os.umask(0o077)
    source = Path(__file__).resolve().parent / 'release.py'
    target = Path('/usr/local/sbin/acornary-release')
    config = json.loads(Path('/etc/acornary/release.json').read_text())
    state = Path(config['state_dir'])
    compose = Path(config['compose_file'])
    with (state / 'submit.lock').open('a') as submit, (state / 'deploy.lock').open('a') as deploy:
        for handle in (submit, deploy):
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for file in (state / 'jobs').glob('*.json'):
            if json.loads(file.read_text())['phase'] not in ('succeeded', 'failed'):
                raise RuntimeError('Release job active or needs_attention; refusing runtime update')
        if digest(target) != sys.argv[1] or digest(compose) != sys.argv[2]:
            raise RuntimeError('Runtime baseline changed; refusing overwrite')
        compile(source.read_bytes(), str(source), 'exec')
        text = compose.read_text()
        if 'ACORNARY_ATTACHMENT_ROOT' in text or 'attachments:' in text:
            raise RuntimeError('Storage already configured; inspect instead of overwriting')
        marker = '      BIND_HOST: 0.0.0.0'
        mount = "    tmpfs: ['/tmp:size=32m,mode=1777']"
        if text.count(marker) != 1 or text.count(mount) != 2 or text.count('volumes:\n  pgdata:') != 1:
            raise RuntimeError('Unexpected Compose structure; refusing automatic edit')
        text = text.replace(marker, marker + '\n      ACORNARY_ATTACHMENT_ROOT: /var/lib/acornary/attachments')
        text = text.replace(mount, mount + "\n    volumes: ['attachments:/var/lib/acornary/attachments']", 1)
        text = text.replace('volumes:\n  pgdata:', 'volumes:\n  attachments:\n  pgdata:')
        backup = state / ('runtime-before-v2-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
        backup.mkdir(mode=0o700)
        shutil.copy2(target, backup / 'acornary-release')
        shutil.copy2(compose, backup / 'compose.cloud.yaml')
        candidate = compose.with_name(compose.name + '.v2-candidate')
        controller_candidate = target.with_name(target.name + '.v2-candidate')
        try:
            with candidate.open('x') as out:
                out.write(text); out.flush(); os.fsync(out.fileno())
            subprocess.run(['docker', 'compose', '--env-file', config['env_file'], '-f', str(candidate),
                            'config', '--quiet'], check=True, stdout=subprocess.DEVNULL)
            with controller_candidate.open('xb') as out:
                out.write(source.read_bytes()); out.flush(); os.fsync(out.fileno())
            controller_candidate.chmod(0o755)
            os.replace(controller_candidate, target)
            os.replace(candidate, compose)
        except Exception:
            # This operation never starts containers or touches the database.
            for original, saved in ((target, backup / 'acornary-release'), (compose, backup / 'compose.cloud.yaml')):
                restore = original.with_name(original.name + '.v2-restore')
                shutil.copy2(saved, restore); os.replace(restore, original)
            raise
        finally:
            for path in (candidate, controller_candidate):
                if path.exists(): path.unlink()
        record = {'backup': str(backup), 'controller_sha256': digest(target), 'compose_sha256': digest(compose),
                  'restarted': False, 'migrated': False}
        (backup / 'result.json').write_text(json.dumps(record, indent=2) + '\n')
        print(json.dumps(record))


if __name__ == '__main__':
    main()
