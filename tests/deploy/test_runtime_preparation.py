"""Exercise the one-time runtime installer entirely inside temporary directories."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy' / 'prepare-v2-runtime.py'
spec = importlib.util.spec_from_file_location('prepare_runtime', SCRIPT)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RuntimePreparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        (self.state / 'jobs').mkdir(parents=True)
        self.controller = self.root / 'controller'
        self.controller.write_text('# previous trusted controller\n')
        self.controller.chmod(0o755)
        self.compose = self.root / 'compose.yaml'
        self.old_compose = """services:
  app:
    environment:
      BIND_HOST: 0.0.0.0
    tmpfs: ['/tmp:size=32m,mode=1777']
  admin:
    tmpfs: ['/tmp:size=32m,mode=1777']
volumes:
  pgdata:
"""
        self.compose.write_text(self.old_compose)
        self.config = self.root / 'release.json'
        self.config.write_text(json.dumps({'state_dir': str(self.state),
            'compose_file': str(self.compose), 'env_file': str(self.root / 'env')}))
        self.old_controller = self.controller.read_bytes()
        self.hashes = [prepare.digest(self.controller), prepare.digest(self.compose)]
        self.umask = os.umask(0o077)

    def tearDown(self):
        os.umask(self.umask)
        self.temp.cleanup()

    def run_installer(self, hashes=None, failure=None):
        def isolated_path(value):
            return {'/usr/local/sbin/acornary-release': self.controller,
                    '/etc/acornary/release.json': self.config}.get(str(value), Path(value))
        with patch.object(prepare, 'Path', side_effect=isolated_path), \
             patch.object(prepare.os, 'geteuid', return_value=0), \
             patch.object(prepare.sys, 'argv', [str(SCRIPT), *(hashes or self.hashes)]), \
             patch.object(prepare.subprocess, 'run', side_effect=failure) as command, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            prepare.main()
        return json.loads(output.getvalue()), command

    def test_installs_reviewed_controller_and_storage_without_restart_or_sql(self):
        record, command = self.run_installer()
        self.assertFalse(record['migrated'])
        self.assertFalse(record['restarted'])
        saved = Path(record['backup'])
        self.assertEqual((saved / 'acornary-release').read_bytes(), self.old_controller)
        self.assertEqual((saved / 'compose.cloud.yaml').read_text(), self.old_compose)
        self.assertEqual(self.controller.read_bytes(), (SCRIPT.parent / 'release.py').read_bytes())
        self.assertEqual(record['controller_sha256'], prepare.digest(self.controller))
        self.assertEqual(record['compose_sha256'], prepare.digest(self.compose))
        self.assertIn('ACORNARY_ATTACHMENT_ROOT', self.compose.read_text())
        self.assertEqual(self.compose.read_text().count("volumes: ['attachments:"), 1)
        self.assertEqual(self.controller.stat().st_mode & 0o777, 0o755)
        command.assert_called_once()
        self.assertEqual(command.call_args.args[0][-2:], ['config', '--quiet'])

    def test_refuses_changed_baseline_without_overwriting(self):
        with self.assertRaisesRegex(RuntimeError, 'baseline changed'):
            self.run_installer(['0' * 64, self.hashes[1]])
        self.assertEqual(self.controller.read_bytes(), self.old_controller)
        self.assertEqual(self.compose.read_text(), self.old_compose)
        self.assertEqual(list(self.state.glob('runtime-before-*')), [])

    def test_refuses_active_and_needs_attention_jobs(self):
        for phase in ['queued', 'migrating', 'needs_attention']:
            with self.subTest(phase=phase):
                (self.state / 'jobs' / 'job.json').write_text(json.dumps({'phase': phase}))
                with self.assertRaisesRegex(RuntimeError, 'active or needs_attention'):
                    self.run_installer()
                self.assertEqual(self.controller.read_bytes(), self.old_controller)

    def test_failed_compose_validation_preserves_both_originals(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_installer(failure=subprocess.CalledProcessError(1, ['docker', 'compose']))
        self.assertEqual(self.controller.read_bytes(), self.old_controller)
        self.assertEqual(self.compose.read_text(), self.old_compose)
        self.assertFalse(self.compose.with_name(self.compose.name + '.v2-candidate').exists())
        self.assertEqual(len(list(self.state.glob('runtime-before-*'))), 1)
