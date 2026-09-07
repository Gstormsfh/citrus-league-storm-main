import pytest
import diagnose_recent_residuals as m
from run_recent_timing import fit_offset


def test_ridge_retains_training_residual_without_changing_targets():
    rows=[{'game_id':i//3+1,'target':0,'neutral_xg':.4} for i in range(30)]
    offset=fit_offset(rows);out=m.gradient_check(rows,offset)
    assert out['training_residual']>0 and out['ridge_gradient']<0
    assert out['gradient_residual']==pytest.approx(0,abs=1e-10)


def test_residual_sums_do_not_clip_negative_errors():
    r=[{'game_id':1,'target':1,'recent_xg':.2},{'game_id':2,'target':0,'recent_xg':.1}]
    assert m.residual(r)['excess_xg']==pytest.approx(-.7)
