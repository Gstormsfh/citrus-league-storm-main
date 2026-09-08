#!/usr/bin/env python3
"""Provision only staging Apple cleanup secrets; never print secret values."""
import json
import os
import re
import subprocess

PROJECT = 'citrus-fantasy-staging'
RUNTIME = 'serviceAccount:citrus-api-runtime@citrus-fantasy-staging.iam.gserviceaccount.com'
NAMES = ('APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET', 'APPLE_TOKEN_ENCRYPTION_KEY')


def command(args, value=None):
    return subprocess.run(['gcloud', *args, '--project=' + PROJECT, '--quiet'],
                          input=value, text=True, capture_output=True)


def provision(values):
    if any(not values.get(name) for name in NAMES):
        raise RuntimeError('Missing staging Apple configuration')
    if values['APPLE_CLIENT_ID'] != 'com.citrussports.web':
        raise RuntimeError('Unexpected Apple client ID')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', values['APPLE_TOKEN_ENCRYPTION_KEY']):
        raise RuntimeError('Invalid encryption key format')
    listing = command(['secrets', 'list', '--format=json(name)'])
    if listing.returncode:
        raise RuntimeError('Cannot inspect staging Secret Manager')
    existing = {entry['name'].rsplit('/', 1)[-1] for entry in json.loads(listing.stdout)}
    for name in NAMES:
        if name in existing:
            current = command(['secrets', 'versions', 'access', 'latest', '--secret=' + name])
            if current.returncode:
                raise RuntimeError('Cannot verify existing staging secret ' + name)
            if current.stdout == values[name]:
                pass
            elif name == 'APPLE_TOKEN_ENCRYPTION_KEY':
                raise RuntimeError('Existing encryption key differs; preserve it and plan re-encryption before rotation')
            else:
                result = command(['secrets', 'versions', 'add', name, '--data-file=-'], values[name])
                if result.returncode:
                    raise RuntimeError('Cannot update staging secret ' + name)
        else:
            result = command(['secrets', 'create', name, '--replication-policy=automatic', '--data-file=-'], values[name])
            if result.returncode:
                raise RuntimeError('Cannot create staging secret ' + name)
        grant = command(['secrets', 'add-iam-policy-binding', name, '--member=' + RUNTIME,
                         '--role=roles/secretmanager.secretAccessor', '--condition=None'])
        if grant.returncode:
            raise RuntimeError('Cannot grant runtime access to staging secret ' + name)
        print('Staging secret configured: ' + name)


if __name__ == '__main__':
    provision({name: os.environ.get(name, '') for name in NAMES})
