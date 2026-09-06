from pathlib import Path
import sys
import pytest

FOLDER=Path(__file__).resolve().parent
sys.path.insert(0,str(FOLDER))
import record_calibration_checkpoint as c


def test_unsafe_archive_output_does_not_create(tmp_path):
    with pytest.raises(ValueError):c.archive(tmp_path/'outside')
    assert not (tmp_path/'outside').exists()


def test_failed_review_keeps_attempt_and_never_overwrites(tmp_path,monkeypatch):
    monkeypatch.setattr(c,'REPO',tmp_path)
    (tmp_path/'scripts/proof/results').mkdir(parents=True)
    out=tmp_path/'scripts/proof/results/analytics-calibration-checkpoint-test'
    def fails():raise ValueError('missing evidence')
    monkeypatch.setattr(c,'bound_review',fails)
    with pytest.raises(ValueError):c.archive(out)
    assert (out/'attempt-started.json').exists() and (out/'failure.json').exists()
    assert not (out/'receipt.json').exists()
    with pytest.raises(FileExistsError):c.archive(out)


def test_exact_targets_do_not_replace_old_roots():
    assert c.ROOTS==['scripts/proof/results/official-calibration-experiment-20260906',
        'scripts/proof/results/official-calibration-typescript-parity-20260906',
        'scripts/proof/results/official-calibration-review-20260906']
