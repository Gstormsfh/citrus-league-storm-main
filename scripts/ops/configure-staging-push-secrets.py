#!/usr/bin/env python3
"""Provision the staging draft engine's APNs credentials, without printing them."""
import json
import os
import re
import subprocess
from pathlib import Path

PROJECT = 'citrus-fantasy-staging'
MEMBER = 'serviceAccount:citrus-draft-engine@citrus-fantasy-staging.iam.gserviceaccount.com'


def gcloud(args, value=None):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT, '--quiet'],
                            input=value, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Staging push provisioning failed: ' + ' '.join(args[:3]))
    return result.stdout


def provision(key_id, key_path):
    if not re.fullmatch(r'[A-Z0-9]{10}', key_id):
        raise ValueError('Expected a ten-character Apple push key ID')
    pem = Path(key_path).read_text()
    check = subprocess.run(['openssl', 'pkey', '-noout'], input=pem, text=True, capture_output=True)
    if check.returncode:
        raise ValueError('Invalid APNs private key')
    values = {'APNS_KEY_ID': key_id, 'APNS_TEAM_ID': 'TFMG57326Z', 'APNS_PRIVATE_KEY': pem}
    existing = {x['name'].rsplit('/', 1)[-1] for x in json.loads(gcloud(['secrets', 'list', '--format=json(name)']))}
    # Check the entire existing set before any mutation; never rotate implicitly.
    for name, value in values.items():
        if name in existing and gcloud(['secrets', 'versions', 'access', 'latest', '--secret=' + name]).strip() != value.strip():
            raise RuntimeError('Existing staging APNs configuration differs; explicit rotation is required')
    for name, value in values.items():
        if name not in existing:
            gcloud(['secrets', 'create', name, '--replication-policy=automatic', '--data-file=-'], value)
        gcloud(['secrets', 'add-iam-policy-binding', name, '--member=' + MEMBER,
                '--role=roles/secretmanager.secretAccessor', '--condition=None'])
        print('Staging push secret configured: ' + name)


if __name__ == '__main__':
    provision(os.environ['CITRUS_APNS_KEY_ID'], os.environ['CITRUS_APNS_KEY_PATH'])
