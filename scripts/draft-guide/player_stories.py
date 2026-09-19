"""Individually authored stories. Missing research never becomes template prose.

The board retains all ranking/checklist rows. Essays are an editorial selection,
not a 300-player quota. Every included story requires its own researched evidence
and fantasy conclusion; missing stories never become boilerplate.
"""
import json
import re
from collections import defaultdict
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

LIBRARY = Path(__file__).with_name('player-story-library.json')
SEASON_CONTEXT = Path(__file__).with_name('player-season-context.json')
METRICS = {
    'goalie_gp': ('APPEARANCES', 0), 'nhl_wins': ('WINS', 0),
    'nhl_saves': ('SAVES', 0), 'nhl_save_pct': ('SAVE %', 3),
    'nhl_gaa': ('GAA', 2), 'nhl_shots_on_goal': ('SHOTS', 0),
    'nhl_goals': ('GOALS', 0), 'nhl_assists': ('ASSISTS', 0),
    'nhl_hits': ('HITS', 0), 'nhl_blocks': ('BLOCKS', 0),
}


def normalized_copy(item):
    text=item['body'].casefold()
    for token in item['name'].casefold().split():
        text=re.sub(r'\b'+re.escape(token)+r'\b', 'player', text)
    return re.sub(r'\d+(?:[.,]\d+)*', '#', text)


def load_library(players, path=LIBRARY):
    data=json.loads(Path(path).read_text())
    cutoff=date.fromisoformat(data['asOf'])
    by_id={str(p['playerId']):p for p in players}
    stories={};source_usage=defaultdict(int)
    for item in data['items']:
        pid=item['playerId'];name=item['name']
        if pid in stories:raise ValueError('Duplicate player story: '+name)
        if pid not in by_id or by_id[pid]['name']!=name:
            raise ValueError('Story identity mismatch: '+name)
        if date.fromisoformat(item['date'])>cutoff:
            raise ValueError('Future-dated story: '+name)
        if urlparse(item['url']).scheme!='https' or not urlparse(item['url']).netloc:
            raise ValueError('Usable source link required: '+name)
        if not all(item.get(k,'').strip() for k in ('headline','body','source','evidence','kind')):
            raise ValueError('Missing authored copy or evidence: '+name)
        if '\u2014' in json.dumps(item,ensure_ascii=False):
            raise ValueError('Em dash in authored story: '+name)
        source_usage[item['url']]+=len((item['headline']+' '+item['body']).split())
        if source_usage[item['url']]>item['sourceWordLimit']:
            raise ValueError('Source word budget exceeded: '+name)
        if item.get('metrics'):
            if not item.get('metricRead') or not isinstance(item.get('metricSeason'),int):
                raise ValueError('Metrics need a dated, authored interpretation: '+name)
            if any(k not in METRICS for k in item['metrics']):
                raise ValueError('Unsupported metric: '+name)
        for other in stories.values():
            if SequenceMatcher(None,normalized_copy(item),normalized_copy(other)).ratio()>.78:
                raise ValueError('Near-duplicate story: '+name+' / '+other['name'])
        stories[pid]=item
    return stories


def coverage(players, library, require_complete=False):
    covered=[p for p in players if str(p['playerId']) in library]
    missing=[dict(playerId=str(p['playerId']),name=p['name'],key=p['key'],
                  rank=p.get('overallRank')) for p in players if str(p['playerId']) not in library]
    report=dict(target=len(players),authored=len(covered),remaining=len(missing),
                complete=not missing,missing=missing,
                coveredKeys=[p['key'] for p in covered],fallback='omit-unwritten-essay')
    if require_complete and missing:
        raise ValueError(f"Player research incomplete: {len(missing)} of {len(players)} still need authored copy")
    return report


def load_season_context(players, canonical_revision, path=SEASON_CONTEXT, *, deployment_path=None):
    """Separate the story's historical clock from this season's evidence."""
    bundle=json.loads(Path(path).read_text());by_id={str(p['playerId']):p for p in players}
    from deployment import verify_editorial_review
    verify_editorial_review(bundle, deployment_path) if deployment_path else verify_editorial_review(bundle)
    if canonical_revision!=bundle['canonicalRevision']:
        raise ValueError('Season context requires review against the canonical snapshot')
    cutoff=date.fromisoformat(bundle['asOf']);notes={};usage=defaultdict(int)
    for note in bundle['items']:
        pid=note['playerId'];p=by_id.get(pid)
        if pid in notes or not p or any(p.get(k)!=note[k] for k in ('name','team')):
            raise ValueError('Season context identity mismatch: '+pid)
        if any(p.get(k)!=v for k,v in note.get('expectedRole',{}).items()):
            raise ValueError('Season context role requires review: '+pid)
        if not all(note.get(k) for k in ('headline','body','evidence','sources')):
            raise ValueError('Season context needs authored copy and evidence: '+pid)
        if '\u2014' in json.dumps(note,ensure_ascii=False):raise ValueError('Em dash in season context')
        for source in note['sources']:
            if date.fromisoformat(source['date'])>cutoff:raise ValueError('Future season-context source')
            if source.get('kind')=='canonical':continue
            if urlparse(source['url']).scheme!='https' or not urlparse(source['url']).netloc:
                raise ValueError('Usable season-context source required')
            attributed=source.get('factualText')
            if attributed is not None and (not isinstance(attributed,str) or not attributed.strip() or attributed not in note['body']):
                raise ValueError('Source factual text must appear in the authored body')
            usage[source['url']]+=len((attributed if attributed is not None else note['headline']+' '+note['body']).split())
            if usage[source['url']]>source['wordLimit']:
                raise ValueError('Season-context source budget exceeded: '+source['url'])
        for other in notes.values():
            if SequenceMatcher(None,normalized_copy(note),normalized_copy(other)).ratio()>.78:
                raise ValueError('Near-duplicate season context')
        notes[pid]=note
    return notes


def require_story_conclusions(stories, notes):
    """A researched story cannot silently export without its fantasy landing."""
    missing=[story['name'] for pid,story in stories.items() if pid not in notes]
    if missing:
        raise ValueError('Published stories missing fantasy conclusions: '+', '.join(missing))


def historical_metrics(item, evidence):
    """Imported NHL actuals only, not invented tracking metrics or silent zeros."""
    fields=item.get('metrics',[])
    if not fields:return []
    matches=[a for a in evidence.get('actuals',[]) if str(a['player_id'])==item['playerId']
             and a.get('season')==item['metricSeason']]
    if len(matches)!=1:raise ValueError('Exact historical metric record required: '+item['name'])
    a=matches[0];rows=[]
    for key in fields:
        value=a.get(key)
        if value is None:raise ValueError('Missing requested historical metric: '+item['name']+' / '+key)
        label,decimals=METRICS[key]
        display=f'{value:,.{decimals}f}'
        if key=='nhl_save_pct' and 0<=value<1:display=display[1:]
        rows.append(dict(field=key,label=label,value=value,display=display,season=a['season']))
    return rows
