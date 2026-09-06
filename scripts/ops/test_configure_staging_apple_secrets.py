import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('provision', Path(__file__).with_name('configure-staging-apple-secrets.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
VALUES = {'APPLE_CLIENT_ID': 'com.citrussports.web', 'APPLE_CLIENT_SECRET': 'test-secret', 'APPLE_TOKEN_ENCRYPTION_KEY': 'ab' * 32}

class StagingSecretsTest(unittest.TestCase):
    def test_configuration_validation_precedes_any_remote_call(self):
        with patch.object(module, 'command') as run:
            with self.assertRaises(RuntimeError):
                module.provision({**VALUES, 'APPLE_CLIENT_ID': 'unexpected-client'})
            run.assert_not_called()

    def test_never_rotates_an_existing_encryption_key(self):
        def call(args, value=None):
            if args[:2] == ['secrets', 'list']:
                return SimpleNamespace(returncode=0, stdout='[{"name":"APPLE_TOKEN_ENCRYPTION_KEY"}]')
            if args[:3] == ['secrets', 'versions', 'access']:
                return SimpleNamespace(returncode=0, stdout='different-existing-key')
            return SimpleNamespace(returncode=0, stdout='')
        with patch.object(module, 'command', side_effect=call) as run:
            with self.assertRaisesRegex(RuntimeError, 'preserve it'):
                module.provision(VALUES)
            self.assertFalse(any('APPLE_TOKEN_ENCRYPTION_KEY' in args[0] and ('create' in args[0] or 'add' in args[0]) for args, _ in run.call_args_list))

    def test_gcloud_target_is_always_staging_and_secret_uses_stdin(self):
        with patch.object(module.subprocess, 'run') as run:
            module.command(['secrets', 'create', 'APPLE_CLIENT_SECRET', '--data-file=-'], 'private-value')
            args, kwargs = run.call_args
            self.assertIn('--project=citrus-fantasy-staging', args[0])
            self.assertNotIn('private-value', args[0])
            self.assertEqual(kwargs['input'], 'private-value')
            self.assertTrue(kwargs['capture_output'])

if __name__ == '__main__':
    unittest.main()
