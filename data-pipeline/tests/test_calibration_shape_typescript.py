import json
from pathlib import Path
import subprocess
import numpy as np
import pytest
from projections import calibration_shape as c
from tests.test_calibration_shape import sample

SCRIPT=Path(__file__).resolve().parents[2]/'scripts/proof/score_calibration_shape.mjs'

def test_cross_language_all_maps_knots_unknown_missing_and_extremes(tmp_path,sample):
    models={k:c.fit(k,*sample) for k in c.KINDS}
    path=tmp_path/'models.json';path.write_text(json.dumps(models,allow_nan=False))
    p=np.unique(np.r_[np.linspace(0,1,1000),c.SETTINGS['knots'],models['smooth_isotonic_clipped']['x']])
    ctx=[{'shot_type':None if i%2 else 'new','prior_sog_same_team':None if i%3 else '1','strength':'5v5'} for i in range(len(p))]
    rows=[{'game_id':2022020001,'event_id':i,'raw_probability':float(v),'context':ctx[i]} for i,v in enumerate(p)]
    result=subprocess.run(['node',str(SCRIPT),str(path.resolve())],input=''.join(json.dumps(r)+'\n' for r in rows),text=True,capture_output=True,check=True,timeout=30)
    output=[json.loads(line) for line in result.stdout.splitlines()]
    assert len(output)==len(rows)
    for i,r in enumerate(output):assert r['game_id']==rows[i]['game_id'] and r['event_id']==i
    for k in c.KINDS:np.testing.assert_allclose([r['predictions'][k] for r in output],c.predict(models[k],p,ctx),atol=1e-12,rtol=0)

@pytest.mark.parametrize('bad',['settings','coefficient','negative_slope','missing_context','invalid_probability','duplicate_model_kind'])
def test_typescript_fail_closed(tmp_path,sample,bad):
    models={k:c.fit(k,*sample) for k in c.KINDS}
    row={'game_id':2022020001,'event_id':1,'raw_probability':.1,'context':sample[2][0]}
    if bad=='settings':models['monotone_logit']['settings']['epsilon']=.001
    elif bad=='coefficient':models['smooth_isotonic_clipped']['coefficients'][0][0]+=.1
    elif bad=='negative_slope':models['monotone_logit']['slopes'][0]=-1
    elif bad=='missing_context':row.pop('context')
    elif bad=='invalid_probability':row['raw_probability']=True
    else:models['monotone_logit']['kind']='monotone_logit_group'
    path=tmp_path/'models.json';path.write_text(json.dumps(models))
    result=subprocess.run(['node',str(SCRIPT),str(path.resolve())],input=json.dumps(row)+'\n',text=True,capture_output=True,timeout=30)
    assert result.returncode!=0 and result.stdout==''
