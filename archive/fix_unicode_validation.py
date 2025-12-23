#!/usr/bin/env python3
"""Fix Unicode emoji characters in validation scripts."""

import os
import re

files = [
    'validate_gsax_stability.py',
    'validate_gsax_predictive.py',
    'validate_gar_team_correlation.py',
    'validate_gar_component_stability.py',
    'validate_gar_components.py'
]

for filename in files:
    if not os.path.exists(filename):
        print(f"Skipping {filename} (not found)")
        continue
    
    print(f"Fixing {filename}...")
    
    with open(filename, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Replace emojis with plain text
    content = content.replace('✅', 'OK')
    content = content.replace('❌', 'ERROR')
    content = content.replace('⚠️', 'WARNING')
    content = content.replace('⚠', 'WARNING')
    
    # Remove any corrupted WARNING strings that might have been created
    # This is a simple fix - if the file is too corrupted, we'll need to restore from git
    if 'WARNINGEWARNING' in content:
        print(f"  WARNING: {filename} appears corrupted. Restoring from git...")
        os.system(f'git checkout HEAD -- {filename}')
        continue
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"  Fixed {filename}")

print("Done!")

