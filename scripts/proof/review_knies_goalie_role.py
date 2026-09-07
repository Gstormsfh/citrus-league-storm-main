"""Preserve public role evidence and audit goalie-carry ambiguity offline."""
import hashlib
import json
import subprocess
from pathlib import Path
from projections.possession_candidates import infer

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'


def run():
    out=BASE/'knies-goalie-role-v2-20260907';out.mkdir()
    # PBP returned 403. Use the already accessible public landing response,
    # not an authentication workaround; threeStars supplies these goalie roles.
    url='https://api-web.nhle.com/v1/gamecenter/2025020061/landing'
    response=subprocess.run(['node','-e',
        'fetch(process.argv[1]).then(async r=>{if(!r.ok)throw Error(String(r.status));process.stdout.write(await r.text())}).catch(e=>{console.error(e.message);process.exitCode=1})',url],
        capture_output=True,check=True,timeout=25)
    raw=response.stdout
    (out/'landing.json').write_bytes(raw)
    (out/'landing.receipt.json').write_text(json.dumps(dict(url=url,status=200,sha256=hashlib.sha256(raw).hexdigest())))
    landing=json.loads(raw)
    goalies=[r['playerId'] for r in landing['summary']['threeStars'] if r['position']=='G']
    if 8478048 not in goalies: raise ValueError('Expected goalie identity not confirmed by source')
    source=BASE/'tracked-comotion-unseen-20260907/2025020061-271.json'
    frames=json.loads(source.read_bytes())
    receipt=json.loads(source.with_suffix('.receipt.json').read_bytes())
    assert hashlib.sha256(source.read_bytes()).hexdigest()==receipt['sha256']
    before=infer(frames,radius=60,retention_radius=84)
    after=infer(frames,radius=60,retention_radius=84,goalie_ids=goalies)
    report=dict(source_sha256=receipt['sha256'],goalie_ids=goalies,role_source_scope='Goalies identified in official threeStars; not a complete roster guarantee',
        target_frames=[dict(frame=i,before=before[i],after=after[i]) for i in (126,127,128)],
        goalie_control_candidates_before=sum(r['player_id'] in goalies for r in before),
        goalie_control_candidates_after=sum(r['player_id'] in goalies for r in after),
        video_page='https://nhl.com/video/nyr-tor-knies-scores-ppg-against-igor-shesterkin-6382866443112',
        video_replay_alignment_verified=False,confirmed_false_positives=None,
        interpretation='Role-specific abstention, not demonstrated possession accuracy',production_changed=False)
    (out/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!='target_frames'}))


if __name__=='__main__':run()
