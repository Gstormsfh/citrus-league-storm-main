"""Run the source-coverage gate in the normal pipeline/CI test collection."""
import json
from pathlib import Path
import subprocess
import sys


def test_analytics_input_scope_has_no_unreconciled_changes():
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run([sys.executable, str(root / 'scripts/proof/check_analytics_input_coverage.py')],
                            cwd=root, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report['status'] == 'coverage_reconciled_only'
    assert report['production_authorized_by_this_check'] is False
