"""Build a local, evidence-linked mission handoff and preserve uncommitted files."""
import hashlib
import html
import json
from pathlib import Path
import subprocess
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'docs/citrus-handoff-20260907'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()


def link(path, label=None):
    return f'<a href="../../{html.escape(path, quote=True)}">{html.escape(label or path)}</a>'


def section(title, body):
    return f'<section><h2>{title}</h2>{body}</section>'


def main():
    OUT.mkdir(exist_ok=False)
    documents = sorted(ROOT.glob('docs/analytics-*'))
    dirty = set(git('diff', 'HEAD', '--name-only').splitlines())
    dirty.update(git('ls-files', '--others', '--exclude-standard').splitlines())
    dirty = sorted(p for p in dirty if p and (ROOT/p).is_file() and not p.startswith('docs/citrus-handoff-20260907/'))
    files = {}
    with zipfile.ZipFile(OUT/'uncommitted-work.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in dirty:
            raw = (ROOT/name).read_bytes()
            files[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
            archive.writestr(name, raw)
    with zipfile.ZipFile(OUT/'uncommitted-work.zip') as archive:
        for name, info in files.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == info['sha256']
    metrics_path = 'scripts/proof/results/joint-residual-adjustments-20260907/summary.json'
    metrics_raw = (ROOT/metrics_path).read_bytes()
    metrics = json.loads(metrics_raw)
    repo = dict(created_utc=datetime.now(timezone.utc).isoformat(), branch=git('branch', '--show-current'),
                head=git('rev-parse', 'HEAD'), fetched_origin_master=git('rev-parse', 'origin/master'),
                ahead_behind=git('rev-list', '--left-right', '--count', 'HEAD...origin/master').split(),
                safety_stash='47b1ca23', duplicate_file_backup='/tmp/citrus-handoff-sync.FzkMsR',
                status=git('status', '--short'), preserved_uncommitted_files=files,
                source_metrics=dict(path=metrics_path, sha256=hashlib.sha256(metrics_raw).hexdigest()),
                documents=[dict(path=str(p.relative_to(ROOT)), sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in documents],
                limitations=['Local snapshot, not off-machine backup', 'Ignored results and dependency caches are not bundled',
                             'Evidence catalog is path/hash inventory, not a fresh semantic audit of every report',
                             'Targeted tests rerun after merge; full application suite and production were not revalidated'])
    (OUT/'worktree-receipt.json').write_text(json.dumps(repo, indent=2))
    rows = ''
    for key, label in [('auc','AUC ↑'),('brier','Brier ↓'),('correlation','Shot-level correlation ↑'),('log_loss','Log loss ↓'),('ece_10_equal_width','10-bin calibration error ↓')]:
        rows += f'<tr><td>{label}</td><td>{metrics["scores"]["previous_ridge10"][key]:.8f}</td><td>{metrics["scores"]["joint_four"][key]:.8f}</td></tr>'
    content = section('01 / The honest bottom line', '''
<p class="lead">There are measured offline xG improvements, production operational repairs, and a working video-review prototype. These are three different accomplishments—not one deployed, validated model.</p>
<div class="cards"><article><span class="tag">Measured · offline</span><h3>xG corrections</h3><p>Saved experiments improved probability metrics on inspected development populations. No prospective superiority or production xG gain is established.</p></article>
<article><span class="tag">Documented · production</span><h3>Output integrity</h3><p>Projection write permissions were restricted, and competing scheduled writer behavior was replaced by output-health monitoring. These are security and operations improvements, not forecast accuracy gains.</p></article>
<article><span class="tag amber">Prototype · awaiting labels</span><h3>Pre-shot possession</h3><p>Replay-based candidates, image-derived body boxes and a blind human review workflow exist. Reliable puck control, player identity and calibrated hockey probabilities are not yet established.</p></article></div>''')
    content += section('02 / What actually moved the accuracy metrics', f'''
<p>One concrete saved result: the joint four-category residual correction versus the earlier ridge-10 candidate, on {metrics['events']:,} eligible last-season shots. These are <strong>offline adaptive development results</strong>, not the current production baseline and not an untouched test set.</p>
<table><thead><tr><th>Metric</th><th>Earlier candidate</th><th>Joint correction</th></tr></thead><tbody>{rows}</tbody></table>
<p>The adjustments address same-clock prior shots, strength, fast lateral recorded-event movement and close-range shots jointly in log-odds space. They are not percentages of total xG. Power-play and close-range aggregate biases slightly worsened; the result is useful, not universally better.</p>
<p>{link(metrics_path, 'Machine-readable scores')} · {link('docs/analytics-joint-residual-improvement-20260907.md','Experiment, caveats and replay evidence')}</p>
<p>The separate rolling recent-timing candidate remains the reference named in the current xG checkpoint. It improves original-fold probability losses but retains timing-cell weaknesses. Do not silently combine these candidate families or declare a single winner across different populations.</p>
<p>{link('docs/analytics-current-xg-checkpoint-20260907.md','Current reference checkpoint')} · {link('docs/analytics-recent-timing-result-20260907.md','Recent timing result')} · {link('docs/analytics-frozen-last-season-evaluation-20260907.md','Frozen last-season baseline')}</p>''')
    content += section('03 / The full landscape we must preserve', '''
<p>The mission includes database, organization and models together. It must not collapse into a flurry-only rebuild or a video-detector project.</p>
<table><thead><tr><th>Family</th><th>Preserve / distinguish / finish</th></tr></thead><tbody>
<tr><td>Source and actuals</td><td>Raw NHL payloads, identity, revisions, source receipts, quarantined games, official totals, appearances and TOI. Exclusions are not deletions or measured zeros.</td></tr>
<tr><td>Shot and pre-shot inputs</td><td>Geometry, angle, distance, shot type, strength, prior events, elapsed time, horizontal displacement, rink/era adjustments and missingness. A recorded-event displacement is not a verified pass.</td></tr>
<tr><td>Finishing and talent</td><td>Shooting %, goals/xG, percentage above expected and G−xG have distinct units. Source-linked descriptive finishing exists; persistent talent needs earlier evidence, shrinkage validation and compatible neutral baselines.</td></tr>
<tr><td>Rebounds and flurries</td><td>Shot probability, rebound creation and sequence credit are different targets. Preserve original helpers and new sequence accounting without double-counting finishing or creation.</td></tr>
<tr><td>Forecasts and uncertainty</td><td>Opportunity, participation, exposure, home/rest, opponent context, goalie roles, aging and joint uncertainty. A shot model is not a player-season projection.</td></tr>
<tr><td>GAR, goalies and new metrics</td><td>On-ice components, replacement/shrinkage, GSAx, rebound control, action-value research and the wider publication roadmap remain in scope. Research specifications are not deployed products.</td></tr>
<tr><td>FPAR</td><td>Still gated by validated physical forecasts, horizons, category availability, league scoring, eligibility and jointly feasible replacement assignments.</td></tr>
</tbody></table>'''+f'<p>{link("docs/analytics-method-preservation-20260906.md","Complete method-preservation map")} · {link("docs/ANALYTICS_ACCEPTANCE.md","Acceptance register")} · {link("docs/analytics-composed-player-finishing-20260907.md","Player-finishing bridge")} · {link("docs/analytics-finishing-exposure-reconciliation-20260907.md","Exposure reconciliation")}</p>')
    content += section('04 / What exists in the passing and possession system', '''
<p><strong>Implemented:</strong> source/timestamp validation; causal replay-based possession candidates; continuous distance/motion/separation/persistence evidence; goalie-role abstention; bounded video/replay alignment and live-play coverage checks; image-derived person boxes; blind review export; source-bound import; and a game-disjoint fitting/calibration/evaluation path exercised with synthetic fixtures.</p>
<p><strong>Not implemented or validated:</strong> reliable video puck/stick localization, camera-aware spatial registration, stable body-to-NHL identity, representative independently adjudicated possession labels, or a trained and calibrated hockey possession classifier. Body boxes alone do not prove control.</p>
<p>Hall suggests pass → carry → shot rather than an immediate one-timer. Knies illustrates why post-cut celebration footage cannot validate replay possession. Both are development examples, not a representative holdout. Same-clock events do not establish literal simultaneous shots or goalie position.</p>'''+f'<p>{link("docs/analytics-body-possession-prototype-20260907.md","Body detector limits")} · {link("docs/analytics-possession-reliability-20260907.md","Threshold sensitivity")} · {link("docs/analytics-possession-goalie-role-20260907.md","Goalie-role correction")} · {link("docs/analytics-possession-scoring-20260907.md","Scoring and label contracts")}</p>')
    content += section('05 / Garrett’s next input', '''
<div class="callout"><h3>Review the clips when you’re home</h3><p><a href="http://127.0.0.1:8768/garrett-batch-one/">Open the first review batch on this Mac →</a></p>
<ol><li>Enter Garrett. Review eight saved samples in each clip.</li><li>Judge the still’s timestamp; use nearby video for context and the return-to-sample button after playback.</li><li>Select controlled, no control, uncertain or not live play. If controlled, select the visible team/jersey.</li><li>Add a brief evidence note and save each observation. Do not force an identity or possession judgment.</li><li>Download observations before closing, then attach the JSON in this conversation. Partial reviews are accepted; there is no autosave.</li></ol></div>
<p>The importer preserves the original export and manifest, checks video/sample identities and timestamps, and rejects conflicting reviewer/sample duplicates. Uncertainty and non-play remain distinct. Reviews are not automatically adjudicated or approved for training.</p>'''+f'<p>{link("docs/analytics-independent-possession-review-pack-20260907.md","Review and import runbook")} · {link("data-pipeline/projections/possession_review_import.py","Importer source")}</p>')
    content += section('06 / Production, database and the iOS boundary', f'''
<p>The saved production records document a narrow projection-write restriction and the merged projection-output health workflow. Their scope is integrity, availability and writer ownership. They do not establish a production model-accuracy improvement.</p>
<p>{link('docs/analytics-production-projection-write-restriction-20260907.md','Production write restriction')} · {link('docs/analytics-production-projection-ownership-20260907.md','Scheduled writer ownership repair')}</p>
<p>The local model → PostgreSQL/PostgREST → TypeScript reader proof tested diagnostic publication, withholding, rollback and access denial in disposable infrastructure. It is not production model admission.</p>
<p>{link('docs/analytics-model-publication-result-20260906.md','Local publication proof')}</p>
<p>The worktree now includes incoming dashboard, projection-display and iOS release changes from master. Targeted server tests passed after integration. The current iOS screen has not been rechecked on Garrett’s device in this handoff; do not mark that user-visible issue resolved based on database rows or unit tests alone.</p>''')
    content += section('07 / Exact continuation order', '''
<ol><li><strong>Import Garrett’s observations.</strong> Retain originals; report completeness and uncertainty. Do not manufacture missing reviews.</li>
<li><strong>Compare judgments with the existing candidate.</strong> Resolve timestamp alignment and identity before labeling an algorithm error. Separate loose puck, carries, goalie interactions, occlusions and cuts.</li>
<li><strong>Freeze one bounded correction.</strong> Test its causal behavior and failure cases. Record rejected ideas alongside improvements rather than repeatedly searching an inspected holdout.</li>
<li><strong>Build representative game-disjoint labels.</strong> Goal-highlight-only examples cannot establish full-play performance. Independently adjudicate, then fit and calibrate on separate games.</li>
<li><strong>Test incremental xG value.</strong> Compare the same eligible shots, baseline, AUC, Brier, log loss, calibration, correlation and relevant subgroups. Account for feature availability and selection bias.</li>
<li><strong>Pass foundation and serving gates.</strong> Confirm original-input lineage, exposure, talent separation, consumer compatibility, rollback and prospective evaluation before model promotion. FPAR follows those gates.</li></ol>
<p>Use existing receipts and runners. Do not rerun every historical experiment merely to recreate a status update. No new paid provider, MoneyPuck files, weights or predictions are authorized by this handoff. Public methodology can inform original Citrus methods; rights remain separate.</p>''')
    content += section('08 / Worktree receipt and recovery', f'''
<p><strong>Branch:</strong> <code>{repo['branch']}</code><br><strong>HEAD:</strong> <code>{repo['head']}</code><br><strong>Fetched master:</strong> <code>{repo['fetched_origin_master']}</code></p>
<p>The local merge includes all fetched master commits: {repo['ahead_behind'][1]} behind. Local edits remain uncommitted. The only autostash conflict was a blank line in the game-log test; it was resolved without dropping test cases. The autostash <code>47b1ca23</code> is retained. Two identical incoming utility files have additional copies in <code>/tmp/citrus-handoff-sync.FzkMsR</code>.</p>
<p>Post-sync checks: 100 possession/passing/tracking tests passed; 93 server dashboard/game-log tests passed; git whitespace/conflict checks passed. These are targeted checks, not a full merged application certification. No push or deployment was performed in this handoff.</p>
<p><a href="uncommitted-work.zip">Download the uncommitted-file snapshot</a> · <a href="worktree-receipt.json">File hashes, source pins and Git receipt</a></p>
<p>The snapshot contains {len(files)} changed/untracked files, verified against the archive bytes. Ignored result directories, model caches and runtime dependencies remain in the worktree but are not included. This is a local copy—not an off-machine disaster-recovery backup. Do not blindly extract it over a newer tree or apply the retained stash again.</p>''')
    catalog = ''.join(f'<li>{link(str(p.relative_to(ROOT)),p.name)}</li>' for p in documents)
    content += section('09 / Complete analytics document index', f'<p>{len(documents)} retained analytics documents and machine-readable records, each hashed in the receipt. Older reports describe their own checkpoints; later work does not retroactively validate them. The index is exhaustive for <code>docs/analytics-*</code>, not every ignored artifact or external source.</p><details><summary>Browse the full evidence catalog</summary><ul class="catalog">{catalog}</ul></details>')
    css = '''*{box-sizing:border-box}body{margin:0;background:#f2f0e8;color:#183c31;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#102d24;color:#f6f2e8;padding:72px max(7vw,24px) 60px;border-bottom:8px solid #ea8a43}header small{letter-spacing:.2em;text-transform:uppercase;color:#ecaa77}h1{font-size:clamp(40px,6vw,76px);line-height:1.02;letter-spacing:-.05em;max-width:900px;margin:24px 0}header p{max-width:680px;color:#ccdbd2;font-size:20px}main{max-width:1120px;margin:auto;padding:20px 24px 70px}section{padding:32px 0;border-bottom:1px solid #cbd3c8}h2{font-size:26px;letter-spacing:-.03em}h3{line-height:1.2}a{color:#99501f;text-underline-offset:4px}code{font-size:12px;overflow-wrap:anywhere}.lead{font-size:22px;max-width:900px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.cards article{background:#fffdf7;padding:23px;border:1px solid #d7ded1;border-radius:14px}.tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#256448}.amber{color:#925624}table{width:100%;border-collapse:collapse;font-size:14px;background:#fffdf7}th{text-align:left;background:#193c30;color:white}td,th{padding:13px;border-bottom:1px solid #dce2d7;vertical-align:top}td:first-child{font-weight:600}.callout{background:#e2eadc;border-left:5px solid #e98a42;padding:18px 28px;border-radius:0 14px 14px 0}li{margin:10px 0}summary{cursor:pointer;font-weight:600}.catalog{columns:2;font-size:12px;overflow-wrap:anywhere}footer{padding:30px;text-align:center;color:#657569;font-size:13px}@media(max-width:700px){.cards{grid-template-columns:1fr}.catalog{columns:1}td,th{padding:8px;font-size:12px}header{padding-top:40px}}@media print{body{background:white}header{padding:25px;color:#183c31;background:white}header p{color:#183c31}section{break-inside:avoid}details{display:block}.catalog{font-size:9px}a{color:inherit}}'''
    page = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Citrus · Analytics Mission Handoff</title><style>{css}</style></head><body><header><small>Citrus / Research &amp; engineering / 07 September 2026</small><h1>Keep the evidence.<br>Build the edge.</h1><p>The analytics mission handoff: what changed, what is proven, what remains open, and exactly where to pick up.</p></header><main>{content}</main><footer>Prepared for Garrett · Local evidence-backed handoff · No industry-ranking claim</footer></body></html>'
    (OUT/'index.html').write_text(page)
    print(json.dumps(dict(handoff=str(OUT/'index.html'), documents=len(documents), preserved_files=len(files), behind=repo['ahead_behind'][1])))


if __name__ == '__main__':
    main()
