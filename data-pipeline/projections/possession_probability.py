"""Fit on adjudicated labels with game-disjoint train/calibration/test partitions.

This is a per-skater probability of control, not a categorical possession model.
Predictions are not renormalized to force an owner. Calling code must preserve
source hashes and adjudication evidence for every label. No production writes.
"""
import math
from projections.passing_time_alignment import assess_video_coverage

FEATURES = ('distance_renderer_units', 'relative_step_renderer_units',
            'nearest_competitor_margin', 'consecutive_support')


def join_review_labels(labels, corpora, game_splits):
    """Join adjudicated exported labels to frozen feature corpora by hashes.

    Corpora keyed by (game_id, event_id) contain controlEvidence and source hashes.
    Review status is an externally audited assertion, not certified by this code.
    """
    rows = []
    for label in labels:
        if label.get('state') == 'uncertain':
            continue
        if label.get('state') not in ('controlled', 'no_control'):
            raise ValueError('Explicit reviewed control state required')
        corpus = corpora[(label['game_id'], label['event_id'])]
        if any(label.get(k) != corpus[k] for k in ('source_sha256', 'video_sha256')):
            raise ValueError('Label/corpus source mismatch')
        frame = label['replay_frame']
        if type(frame) is not int or not 0 <= frame < len(corpus['controlEvidence']):
            raise ValueError('Invalid reviewed frame')
        evidence = corpus['controlEvidence'][frame]
        if evidence.get('frame') != frame:
            raise ValueError('Evidence frame index mismatch')
        actors = evidence['actors']
        if label['state']=='controlled' and label.get('player_id') not in {a['player_id'] for a in actors}:
            raise ValueError('Reviewed controlling player absent from evidence')
        if label['state']=='controlled':
            owner = next(a for a in actors if a['player_id']==label['player_id'])
            if owner.get('actor_role') != 'skater':
                raise ValueError('This model requires a source-identified skater; goalie/unknown control is separate')
            if any(owner.get(f) is None for f in FEATURES):
                raise ValueError('Controlling player features missing; do not retain only negatives')
        for actor in actors:
            if actor.get('actor_role') == 'goalie':
                continue
            if actor.get('actor_role') != 'skater':
                raise ValueError('Unknown actor role cannot enter skater-control training')
            if any(actor.get(f) is None for f in FEATURES):
                continue
            if 'offset_interval' not in corpus:
                raise ValueError('Reviewed video alignment/coverage metadata required')
            coverage=assess_video_coverage(replay_ticks=[frame,frame],offset_seconds=corpus['offset_interval'],
                seconds_per_tick=.1,segments=corpus.get('reviewed_live_segments',[]))
            if not coverage['fully_within_reviewed_segment']:
                raise ValueError('Label lies outside or crosses reviewed video coverage')
            video_time=label.get('video_seconds')
            viewing_offset=label.get('video_minus_replay_offset')
            if any(type(v) not in (int,float) or not math.isfinite(v) for v in (video_time,viewing_offset)):
                raise ValueError('Finite observed video time and viewing offset required')
            low,high=corpus['offset_interval']
            if not low<=viewing_offset<=high or abs(video_time-(frame*.1+viewing_offset))>.05:
                raise ValueError('Observed video time does not match reviewed replay frame/alignment')
            rows.append(dict(label, **{f: actor[f] for f in FEATURES},
                reviewed_video_coverage=True,
                frame=frame, player_id=actor['player_id'], actor_role='skater', split=game_splits[label['game_id']],
                target=int(label['state']=='controlled' and label['player_id']==actor['player_id'])))
    return rows


def fit_evaluate(rows):
    # Validation precedes imports/fitting: provisional labels cannot train.
    partitions = {name: [] for name in ('train', 'calibration', 'test')}
    seen = set()
    for row in rows:
        if row.get('reviewed_video_coverage') is not True:
            raise ValueError('Reviewed video coverage required')
        if row.get('actor_role') != 'skater':
            raise ValueError('Source-identified skater role required')
        if row.get('review_status') != 'adjudicated' or len(set(row.get('reviewers', []))) < 2:
            raise ValueError('Adjudicated multi-reviewer labels required')
        if not row.get('source_sha256') or not row.get('video_sha256') or not row.get('evidence_reference'):
            raise ValueError('Source provenance and review evidence required')
        if row.get('alignment_status') != 'verified':
            raise ValueError('Verified frame alignment required')
        key = (row['game_id'], row['event_id'], row['frame'], row['player_id'])
        if key in seen:
            raise ValueError('Duplicate actor/frame label')
        seen.add(key)
        if row['split'] not in partitions or type(row['target']) is not int or row['target'] not in (0, 1):
            raise ValueError('Explicit split and binary control target required')
        if any(type(row.get(f)) not in (float, int) or not math.isfinite(row[f]) for f in FEATURES):
            raise ValueError('Finite measured features required; missing evidence cannot become zero')
        partitions[row['split']].append(row)
    games = {name: {r['game_id'] for r in group} for name, group in partitions.items()}
    for name, group in partitions.items():
        if {r['target'] for r in group} != {0, 1}:
            raise ValueError(f'{name} requires positive and negative reviewed labels')
        if any(games[name] & games[other] for other in games if other != name):
            raise ValueError('Game leakage between train, calibration and test')

    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import brier_score_loss, roc_auc_score, log_loss

    def arrays(name):
        group = partitions[name]
        return np.array([[r[f] for f in FEATURES] for r in group]), np.array([r['target'] for r in group])

    x, y = arrays('train')
    # Equal weight per game; repeated near-identical frames must not let a
    # longer clip dominate the fit merely because it was sampled more densely.
    counts = {g: sum(r['game_id']==g for r in partitions['train']) for g in games['train']}
    sample_weight = np.array([len(y)/len(counts)/counts[r['game_id']] for r in partitions['train']])
    model = make_pipeline(StandardScaler(), LogisticRegression(C=1., max_iter=1000, random_state=0))
    model.fit(x, y, logisticregression__sample_weight=sample_weight)
    cx, cy = arrays('calibration')
    calibrator = LogisticRegression(C=1., max_iter=1000, random_state=0)
    calibrator.fit(model.decision_function(cx).reshape(-1, 1), cy)
    tx, ty = arrays('test')
    p = calibrator.predict_proba(model.decision_function(tx).reshape(-1, 1))[:, 1]
    raw = model.predict_proba(tx)[:, 1]
    prior = np.full(len(ty), np.average(y, weights=sample_weight))

    def metrics(prediction):
        return dict(brier=float(brier_score_loss(ty, prediction)), auc=float(roc_auc_score(ty, prediction)),
                    log_loss=float(log_loss(ty, prediction, labels=[0, 1])))

    report = dict(features=FEATURES, role_scope='source_identified_skaters_only', games={k: sorted(v) for k, v in games.items()},
                  test_count=len(ty), calibrated=metrics(p), uncalibrated=metrics(raw), prior=metrics(prior),
                  per_game={str(g): dict(count=sum(r['game_id']==g for r in partitions['test']),
                    brier=float(np.mean([(float(prob)-r['target'])**2 for r, prob in zip(partitions['test'], p) if r['game_id']==g])))
                    for g in games['test']},
                  test_probabilities=p.tolist(), production_eligible=False,
                  limitation='Per-actor held-out estimates; no joint ownership consistency or deployment approval')
    return model, calibrator, report
