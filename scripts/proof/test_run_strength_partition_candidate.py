import importlib.util
from pathlib import Path
import numpy as np
import pytest

spec=importlib.util.spec_from_file_location('strength_runner',Path(__file__).with_name('run_strength_partition_candidate.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def test_reference_vectors_exact_identity_and_probability():
    rows=[{'game_id':1,'event_id':2,'label':0}]
    old=[{'game_id':1,'event_id':2,'target':0,'raw_probability':.2}]
    assert m.verify_vectors(rows,np.array([.2]),old,'calibration')['max_raw_absolute_drift']==0
    with pytest.raises(ValueError):m.verify_vectors(rows,np.array([.3]),old,'calibration')
    with pytest.raises(ValueError):m.verify_vectors(rows,np.array([.2]),old+old,'calibration')


def test_scope_rejects_before_output(tmp_path):
    out=tmp_path/'wrong'
    with pytest.raises(ValueError):m.run(out)
    assert not out.exists()
