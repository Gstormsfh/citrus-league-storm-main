"""Customer presentation only. Citrus's scorer and canonical numbers stay authoritative."""
import json, math, os, re, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def availability_watch(player, deployment=None):
    """Current source status overrides an older editorial injury label.

    A camp watch does not assert a regular-season absence or change workload.
    """
    status=(player.get('availability') or {}).get('status')
    role=(deployment or {}).get('roles',{}).get(str(player.get('playerId')), {})
    if status=='healthy':return False
    return status in {'injured','out','ir','ltir','dtd','day_to_day','suspended'} or bool(role.get('sourceListedUnavailable'))

def require_preseason_horizon(data):
    """A refreshed preseason runtime is the same horizon, not an older source.

    Caller must also verify_snapshot. Never relabel an in-season remaining
    forecast as a full-season draft guide or fabricate zero participation.
    """
    if not data.get('canonicalRevision'):
        raise ValueError('Downloads require a verified full-season Citrus snapshot.')
    edition=data.get('edition') or {}
    if not edition:return
    if (edition.get('kind')!='effective_runtime' or edition.get('horizon')!='remaining_season'
            or not edition.get('asOf') or edition.get('runtimeRevision')!=data['canonicalRevision']):
        raise ValueError('Incomplete preseason runtime evidence')
    covered=set()
    for player in data['players']:
        if player.get('forecastStatus')!='projected':continue
        remaining=player.get('canonicalRemaining') or {}
        full=data.get('schedule',{}).get(player['team'])
        known_zero=type(remaining.get('actual_gp')) in (int,float) and remaining['actual_gp']==0
        unused_prior=(remaining.get('actual_gp') is None
            and remaining.get('method')=='organization_prior_remaining'
            and remaining.get('participation_semantics')=='not_used_by_prior')
        if (type(full) not in (int,float) or full<=0 or remaining.get('team_games')!=full
                or remaining.get('as_of')!=edition['asOf'] or not (known_zero or unused_prior)
                or player.get('games')!=player.get('canonicalExposure',{}).get('used')):
            raise ValueError('Preseason downloads cannot use a reduced or unverified remaining-season horizon')
        covered.add(player['team'])
    if covered!=set(data.get('schedule',{})) or not covered:
        raise ValueError('Complete team schedule evidence required for preseason downloads')

def verify_snapshot(data, *, source_root=None):
    """Fail closed if a presentation snapshot has drifted from its canonical input."""
    from import_canonical import validate, convert
    name=Path(data['source']['name']).name
    source_path=(Path(source_root) if source_root is not None else ROOT/'review-inputs')/name
    if not source_path.exists():raise ValueError('Matching canonical input is required in review-inputs: '+name)
    source=json.loads(source_path.read_text())
    preimage=None
    if source.get('revision_algorithm')=='sha256_postgres_jsonb_v1':
        preimage_path=source_path.with_suffix('.preimage.json')
        if not preimage_path.exists():raise ValueError('Matching canonical PostgreSQL preimage is required: '+preimage_path.name)
        preimage=preimage_path.read_text()
    canonical=validate(source,data['canonicalRevision'],revision_preimage=preimage)
    ids=[p.get('playerId') for p in data['players']]
    if len(ids)!=len(set(ids)) or set(ids)!=set(canonical):raise ValueError('Guide coverage differs from canonical input')
    # Reuse the adapter contract, including remaining-season exposure. Comparing
    # only totals allowed stale injury labels, old club roles and notes to pass.
    # League weights and separately reviewed editorial copy are not source data.
    edition=data.get('edition') or {}
    expected=convert(source,{'players':[],'source':{},'readMe':[]},source['revision'],
                     source_name=name,revision_preimage=preimage,
                     runtime_run_id=edition.get('runtimeRunId'),runtime_activated_at=edition.get('activatedAt'))
    by_id={p['playerId']:p for p in expected['players']}
    fields=('key','name','team','position','isGoalie','source','baseGames','games','stats',
            'rosterProbability','line','powerPlay','note','forecastStatus','availability',
            'exposureSemantics','canonicalExposure','canonicalRates','canonicalRemaining',
            'canonicalAvailabilityScenario',
            'canonicalCounts','canonicalRole','canonicalSources','canonicalIssues',
            'ratePolicy','exposurePolicy','canonicalRateComponents','legacyOverrides',
            'unscoredCategories','zeroExposureWithoutRates')
    for p in data['players']:
        o=by_id[p['playerId']]
        if any(p.get(field)!=o.get(field) for field in fields):
            raise ValueError('Guide record differs from canonical input: '+p['name'])
    for field in ('canonicalContract','teamLedger','coverage','schedule','season','seasonGames','edition','publication'):
        if data.get(field)!=expected.get(field):
            raise ValueError('Guide metadata differs from canonical input: '+field)
    # Full source-derived team slots must move with the player records. The
    # independent editorial deployment library is validated separately.
    if data.get('teams')!=expected['teams']:
        raise ValueError('Guide team structure differs from canonical input')
    for field in ('canonicalRevision','sha256','asOf','schemaVersion','revisionAlgorithm'):
        if data['source'].get(field)!=expected['source'].get(field):
            raise ValueError('Guide source metadata differs from canonical input: '+field)
    return source['revision']

def top_players(result, limit=300):
    weights=result.get('weights')
    active={group:any(value != 0 for value in values.values()) for group,values in (weights or {}).items()}
    if active and not any(active.values()):
        raise ValueError('Every scoring weight is zero. Add your league scoring before building a Top 300.')
    eligible = [p for p in result['players'] if p.get('rank') is not None
                and active.get('goalie' if p.get('isGoalie') else 'skater',True)
                and isinstance(p.get('fantasyPoints'), (int, float))
                and math.isfinite(p['fantasyPoints'])]
    eligible.sort(key=lambda p: (-p['fantasyPoints'], p['name'].casefold(), p['key']))
    # An entirely unscored cohort is not an alphabetized zero-point draft target.
    # This is a customer-board selection rule, not a change to the scorer or forecasts.
    # Deliberately ordinal: exactly 300, deterministic ties; original cohort ranks retained.
    return [dict(p, overallRank=i+1) for i,p in enumerate(eligible[:limit])]

def raw_totals(p):
    """Use verified canonical totals directly; scale legacy workbook rates once."""
    if p.get('games') is None or p.get('forecastStatus', 'projected') != 'projected':
        return {}
    if isinstance(p.get('canonicalCounts'),dict):
        return dict(p['canonicalCounts'])
    factor = p['games']/p['baseGames'] if p.get('baseGames') else 0
    totals={k: v*factor for k,v in p['stats'].items()
            if isinstance(v,(int,float)) and math.isfinite(v)}
    return totals

def clean(text):
    text=str(text or '').replace('\u2014', '. ').replace('\u2015', '. ')
    return re.sub(r'\s+', ' ', re.sub('[\u2010-\u2013]', '-', text)).strip()

def assessments(evidence, players, weights):
    runner = os.environ.get('CITRUS_TSX') or shutil.which('tsx')
    local = ROOT.parents[1]/'node_modules/.bin/tsx'
    if not runner and local.exists(): runner=str(local)
    if not runner: raise ValueError('Existing Citrus editorial engine requires tsx. Set CITRUS_TSX; no generic substitute is used.')
    proc=subprocess.run([runner,str(ROOT/'editorial.ts')], input=json.dumps(dict(evidence=evidence,players=players,weights=weights)),text=True,capture_output=True,timeout=90)
    if proc.returncode:raise ValueError('Citrus editorial adapter failed: '+proc.stderr[:1500])
    return {p['key']:p for p in json.loads(proc.stdout)}

def team_structure(team, players):
    """Read imported slots without promoting a stale, incompatible or duplicate assignment.
    Player membership is a roster assumption, not a confirmed opening-night assignment.
    """
    bykey={p['key']:p for p in players}
    lines={f'L{i}':{} for i in range(1,5)}
    pairs={f'D{i}':{} for i in range(1,4)}
    crease=[];watch=[];issues=[];seen=set()
    for slot in team.get('lineupSlots',[]):
        p=bykey.get(slot.get('key'))
        if not p:
            issues.append({'slot':slot.get('slot'),'name':slot.get('imported_name'),'reason':'Unresolved player identity'})
            continue
        label=slot.get('slot') or '';position=slot['position']
        if label not in lines and label not in pairs and position!='G':
            watch.append(p);continue
        reason=None
        if p['team']!=team['team']:reason='Team differs from Citrus projection record'
        elif p.get('forecastStatus') not in (None,'projected'):reason='No allocated season forecast'
        elif label in pairs and p['position'] not in ('D','LD','RD'):reason='Forward assigned to a defence slot'
        elif label in lines and (p['isGoalie'] or p['position'] in ('D','LD','RD')):reason='Position incompatible with forward slot'
        elif position=='G' and not p['isGoalie']:reason='Skater assigned to crease'
        elif p['key'] in seen:reason='Duplicate starting assignment'
        if reason:
            issues.append({'slot':label,'name':p['name'],'key':p['key'],'reason':reason});watch.append(p);continue
        seen.add(p['key'])
        if label in lines:lines[label][position]=p
        elif label in pairs:pairs[label][position]=p
        elif position=='G':crease.append(p)
    crease.sort(key=lambda p:-(p.get('games') or 0))
    return dict(lines=lines,pairs=pairs,crease=crease,watch=list({p['key']:p for p in watch}.values()),issues=issues,startingKeys=sorted(seen))
