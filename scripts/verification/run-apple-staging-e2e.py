#!/usr/bin/env python3
"""Run disposable staging checks with authorized operator credentials, never log secrets."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
environment = os.environ.copy()
for name in ('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'):
    result = subprocess.run(
        ['gcloud', 'secrets', 'versions', 'access', 'latest', '--secret=' + name,
         '--project=citrus-fantasy-staging'], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Cannot read staging test configuration: ' + name)
    environment[name] = result.stdout.strip()
subprocess.run(['node', 'scripts/verification/apple-staging-e2e.mjs'],
               cwd=ROOT, env=environment, check=True)
