import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('push_setup', Path(__file__).with_name('configure-staging-push-secrets.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PushProvisioningTest(unittest.TestCase):
    def test_invalid_id_is_rejected_before_any_cloud_access(self):
        with patch.object(module, 'gcloud') as cloud:
            with self.assertRaises(ValueError):
                module.provision('invalid', '/missing')
            cloud.assert_not_called()

    def test_invalid_pem_is_rejected_before_any_cloud_access(self):
        with tempfile.NamedTemporaryFile(mode='w') as key:
            key.write('not a key')
            key.flush()
            with patch.object(module, 'gcloud') as cloud:
                with self.assertRaises(ValueError):
                    module.provision('ABCDE12345', key.name)
                cloud.assert_not_called()

    def test_existing_configuration_is_not_implicitly_rotated(self):
        from subprocess import CompletedProcess
        with tempfile.NamedTemporaryFile(mode='w') as key:
            key.write('fixture private key')
            key.flush()
            with patch.object(module.subprocess, 'run', return_value=CompletedProcess([], 0)), patch.object(module, 'gcloud', side_effect=['[{"name":"APNS_KEY_ID"}]', 'OTHER12345']) as cloud:
                with self.assertRaisesRegex(RuntimeError, 'explicit rotation'):
                    module.provision('ABCDE12345', key.name)
                self.assertEqual(cloud.call_count, 2)


if __name__ == '__main__':
    unittest.main()
