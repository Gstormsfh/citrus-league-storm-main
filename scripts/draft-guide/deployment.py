"""Dated editorial deployment, separate from the immutable numeric forecast."""
import json
import copy
import hashlib
import re
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent


def verify_editorial_review(bundle, path=ROOT/'deployment-research.json'):
    digest=hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if bundle.get('deploymentSha256') != digest:
        raise ValueError('Editorial copy needs review against the changed deployment research')


def normalized(name):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFKD', name.replace('-', ' ')).encode('ascii', 'ignore').decode().lower())).strip()


# Explicit identity mappings, not surname joins. Keep the canonical name intact.
ALIASES = {'Josh Norris': ('8480064', 'Joshua Norris'),
           'Matthew Savoie': ('8483512', 'Matt Savoie'),
           'J.J. Moser': ('8482655', 'Janis Moser'),
           'Elias Nils Pettersson': ('8483678', 'Elias N. Pettersson')}


def load_deployment(data, path=ROOT/'deployment-research.json'):
    bundle = json.loads(Path(path).read_text())
    if bundle['canonicalRevision'] != data['canonicalRevision']:
        raise ValueError('Deployment requires review against the new canonical snapshot')
    if date.fromisoformat(bundle['asOf']) > date.today():
        raise ValueError('Future-dated deployment review')
    source_players = {p['playerId']: p for p in data['players']}
    names = {normalized(p['name']): p for p in data['players']}
    teams = {}; roles = {}; changes = []
    for item in bundle['items']:
        item = copy.deepcopy(item)
        team = item['team']
        if team in teams or team not in data['schedule']:
            raise ValueError('Invalid or duplicate deployment team: '+team)
        if not item['url'].startswith('https://') or not item['updated'] <= item['checkedAt'] <= bundle['asOf']:
            raise ValueError('Invalid deployment source/date: '+team)
        for change in item.get('adjustments', []):
            if change['field'] not in ('forwards','defence','goalies','injuries') or not change['url'].startswith('https://') or not item['updated'] <= change['date'] <= item['checkedAt']:
                raise ValueError('Invalid sourced deployment adjustment: '+team)
            if 'replace' in change:
                if not isinstance(change['replace'],list) or not all(isinstance(v,str) for v in change['replace']):
                    raise ValueError('Invalid deployment replacement: '+team)
                item[change['field']]=change['replace'][:]
                continue
            a,b = change['swap']
            values=item[change['field']]
            if a==b or not 0<=a<len(values) or not 0<=b<len(values):
                raise ValueError('Invalid deployment swap: '+team)
            values[a],values[b]=values[b],values[a]
        groups = {}; missing_injuries = []
        for field in ('forwards', 'defence', 'PP1', 'PP2', 'goalies', 'injuries'):
            ids = []
            for name in item[field]:
                p = names.get(normalized(name))
                if name in ALIASES:
                    pid, expected = ALIASES[name]
                    p = source_players.get(pid)
                    if not p or p['name'] != expected:
                        raise ValueError('Deployment alias no longer matches: '+name)
                if not p:
                    if field == 'injuries':
                        missing_injuries.append(name); continue
                    raise ValueError('Unresolved deployment identity: '+team+'/'+name)
                if p['team'] != team:
                    # Kreider's September 12 Montreal signing is independently
                    # sourced. Keep his FA/rates-only numerical record unchanged.
                    if (p['playerId'], p['team'], team) not in {('8475184', 'FA', 'MTL'),('8475660','FA','CBJ')}:
                        raise ValueError('New roster movement needs source review: '+name)
                ids.append(p['playerId'])
            if len(ids) != len(set(ids)):
                raise ValueError('Duplicate deployment identity: '+team+'/'+field)
            groups[field] = ids
        for field, count in (('forwards',12), ('defence',6), ('PP1',5), ('PP2',5)):
            if len(groups[field]) != count:
                raise ValueError('Incomplete deployment group: '+team+'/'+field)
        if set(groups['PP1']) & set(groups['PP2']):
            raise ValueError('Player assigned to both power plays: '+team)
        starters = groups['forwards']+groups['defence']+groups['goalies']
        if len(set(starters)) != len(starters):
            raise ValueError('Duplicate starting deployment: '+team)
        injured = set(groups['injuries'])
        for pid in sorted(set(starters+groups['PP1']+groups['PP2']+groups['injuries'])):
            p = source_players[pid]
            if pid in roles:
                raise ValueError('Player assigned to two editorial teams: '+p['name'])
            line = None
            if pid in groups['forwards']:
                if p['isGoalie'] or p['position'] in ('D','LD','RD'):
                    raise ValueError('Incompatible forward: '+p['name'])
                line = 'F'+str(groups['forwards'].index(pid)//3+1)
            elif pid in groups['defence']:
                if p['position'] not in ('D','LD','RD'):
                    raise ValueError('Incompatible defenceman: '+p['name'])
                line = 'D'+str(groups['defence'].index(pid)//2+1)
            elif pid in groups['goalies'] and not p['isGoalie']:
                raise ValueError('Incompatible goalie: '+p['name'])
            pp = next((u for u in ('PP1','PP2') if pid in groups[u]), None)
            role = dict(team=team, line=None if pid in injured else line,
                        powerPlay=None if pid in injured else pp,
                        sourceListedUnavailable=pid in injured, source=item['url'],
                        sourceUpdated=item['updated'], checkedAt=item['checkedAt'])
            roles[pid] = role
            for field in ('team','line','powerPlay'):
                if p.get(field) != role[field]:
                    changes.append(dict(playerId=pid, name=p['name'], field=field,
                                        canonical=p.get(field), editorial=role[field], source=item['url']))
        teams[team] = dict(item, ids=groups, unallocatedInjuryNames=missing_injuries)
    if set(teams) != set(data['schedule']):
        raise ValueError('Deployment must cover every scheduled team')
    return dict(asOf=bundle['asOf'], teams=teams, roles=roles, changes=changes,
                sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest())


def editorial_player(player, deployment):
    """Presentation copy only. Never pass this view back into the scorer."""
    role = deployment['roles'].get(str(player['playerId']))
    if not role:
        return dict(player, line=None, powerPlay=None)
    return dict(player, forecastTeam=player['team'], **{k:role[k] for k in ('team','line','powerPlay')})


def team_deployment(team, players, deployment):
    item = deployment['teams'][team]
    by_id = {str(p['playerId']): editorial_player(p, deployment) for p in players}
    groups = item['ids']; unavailable = set(groups['injuries'])
    lines = {f'L{i}': {} for i in range(1,5)}
    pairs = {f'D{i}': {} for i in range(1,4)}
    keys = []; issues = []
    for field, slots, width, positions, prefix in (
        ('forwards',lines,3,('LW','C','RW'),'L'), ('defence',pairs,2,('LD','RD'),'D')):
        for i,pid in enumerate(groups[field]):
            p = by_id[pid]; label = prefix+str(i//width+1)
            if pid in unavailable:
                issues.append(dict(slot=label, name=p['name'], reason='Source lists player unavailable; replacement not assigned'))
                continue
            slots[label][positions[i%width]] = p; keys.append(p['key'])
    crease = [by_id[pid] for pid in groups['goalies'] if pid not in unavailable]
    keys.extend(p['key'] for p in crease)
    crease.sort(key=lambda p: -(p.get('games') or 0))
    return dict(lines=lines,pairs=pairs,crease=crease,watch=[by_id[pid] for pid in groups['injuries']],
                issues=issues,startingKeys=sorted(keys),
                powerPlay={u:[by_id[pid] if pid not in unavailable else None for pid in groups[u]] for u in ('PP1','PP2')})


def resolve_name(name, players):
    target = normalized(name)
    exact = [p for p in players if normalized(p['name']) == target]
    if len(exact) == 1:
        return exact[0]
    parts = target.split()
    matches = [p for p in players if normalized(p['name']).split()[-1:] == parts[-1:]
               and (len(parts) == 1 or normalized(p['name']).startswith(parts[0]))]
    return matches[0] if len(matches) == 1 else None


def source_conflicts(data):
    """Audit both imported representations. No automatic winner or fuzzy guess."""
    issues = []
    for team in data['teams']:
        players = [p for p in data['players'] if p['team'] == team['team']]
        by_key = {p['key']: p for p in players}
        for slot in team.get('lineupSlots', []):
            p = by_key.get(slot.get('key'))
            label = slot.get('slot') or ''
            if not p or not re.fullmatch('[LD][1-4]', label):
                continue
            expected = label.replace('L', 'F')
            if p.get('line') != expected:
                issues.append(dict(team=team['team'], playerId=p['playerId'], name=p['name'],
                                   field='line', playerRecord=p.get('line'), teamSheet=expected))
        for unit in ('PP1', 'PP2'):
            rows = [r for r in team.get('specialTeams', []) if r['unit'] == unit]
            if not rows:
                continue
            named = set()
            for token in rows[0].get('imported_text', '').split(','):
                p = resolve_name(token.strip(), players)
                if not p:
                    issues.append(dict(team=team['team'], name=token.strip(), field='identity', teamSheet=unit))
                    continue
                named.add(p['playerId'])
                if p.get('powerPlay') != unit:
                    issues.append(dict(team=team['team'], playerId=p['playerId'], name=p['name'],
                                       field='powerPlay', playerRecord=p.get('powerPlay'), teamSheet=unit))
            for p in players:
                if p.get('powerPlay') == unit and p['playerId'] not in named:
                    issues.append(dict(team=team['team'], playerId=p['playerId'], name=p['name'],
                                       field='powerPlay', playerRecord=unit, teamSheet='Not listed on '+unit))
    return issues


if __name__ == '__main__':
    data = json.loads((ROOT/'review-inputs/guide-data.json').read_text())
    issues = source_conflicts(data)
    print(json.dumps(dict(count=len(issues), teams=sorted({i['team'] for i in issues}), issues=issues), indent=2))
