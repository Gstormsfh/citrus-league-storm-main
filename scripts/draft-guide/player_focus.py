"""Display-only draft lenses grounded in the supplied role, rate and exposure fields."""
BOARD_FOCUS = {'Macklin Celebrini','Cole Caufield','Jesper Bratt','Jack Hughes',
 'Dylan Larkin','Ivan Demidov','Matthew Schaefer','Logan Stankoven','Leo Carlsson',
 'Thatcher Demko','Filip Gustavsson','Frederik Andersen','Jacob Fowler','Dustin Wolf'}

PERSONAL_LENSES = {
 'Jack Hughes': ('RATE / VOLUME DISCOUNT', 'Separate the scoring pace from the games assumption. The retained workload note argues for restraint on volume; a strong points-per-game return does not erase the games omitted from this forecast.'),
 'Cole Caufield': ('SHOT VOLUME / SCORING FIT', 'The supplied shooting rate gives this profile value beyond goals alone when your league rewards shots. Check that category weight before treating the same hockey forecast as the same draft value.'),
 'Macklin Celebrini': ('ASSISTS / OPPORTUNITY', 'The supplied assist and shooting rates work through different categories. Read the scoring mix alongside the retained first-unit scenario; the forecast does not guarantee that deployment or a full schedule.'),
 'Jesper Bratt': ('PLAYMAKING / LEAGUE FIT', 'This profile carries more supplied assists than goals per game. Assist-heavy settings reward that mix differently from goal-heavy settings; use the recalculated per-game value rather than a fixed overall reputation.'),
 'Gavin McKenna': ('ROOKIE / PRICE THE ROLE', 'The retained editorial upside is broader than the supplied depth-chart role. Draft the current line and power-play scenario first; keep the possibility of a promotion separate from the points already on the board.'),
 'Ivar Stenberg': ('ROOKIE / PATH TO MINUTES', 'A prospect ceiling and an opening role answer different questions. The supplied deployment is the immediate constraint; do not price a top-line or first-unit promotion into this unchanged baseline.'),
 'Porter Martone': ('ROOKIE / DEPLOYMENT BET', 'The retained first-unit opportunity is the central draft assumption to monitor. The editorial enthusiasm is not a new confirmation of deployment, and the points here still use only the supplied workload.'),
 'Jiri Kulich': ('ROLE / AVOID DOUBLE DISCOUNT', 'Read the retained health commentary alongside its source date. This export preserves the approved workload as supplied; it does not apply another games reduction because an older note discusses a health issue.'),
 'James Hagens': ('ROOKIE / EARNING VOLUME', 'Use the supplied role and games as the baseline for this prospect. Development upside can matter in a keeper format without creating extra current-season games or fantasy points in this projection.'),
}

def lens(p):
    a=p.get('availability') or {}
    if a.get('status') in {'out','ir','ltir','injured'}:
        return ('WORKLOAD / RETURN RISK',
          f"Injury-adjusted workload: {p.get('games') if p.get('games') is not None else 'unavailable'} projected {'starts' if p.get('isGoalie') else 'games'}. Return timing is unconfirmed. Availability context is dated {a.get('as_of') or 'unknown'}; a review deadline is not a recovery forecast.")
    if p.get('games') == 0:
        return ('DEVELOPMENT / NO VOLUME',
          'This snapshot assigns zero NHL workload. Treat prospect upside separately from current-season points; no games or scoring are added for a possible promotion.')
    if p.get('name') in PERSONAL_LENSES:
        return PERSONAL_LENSES[p['name']]
    if p.get('isGoalie'):
        return ('CREASE / STARTS MATTER',
          'A strong per-start return needs actual starts to create season value. The workload below is a projection, not a confirmed crease share or a schedule guarantee.')
    if p.get('powerPlay') == 'PP1':
        return ('OPPORTUNITY / POWER PLAY',
          f"The retained {p.get('line') or 'line-unresolved'} / PP1 scenario is the opportunity to watch. Power-play value depends on that usage holding; the unit is a planning assumption, not a confirmed opening lineup.")
    if p.get('powerPlay'):
        return ('ROLE / ROOM TO GROW',
          f"The source places this player on {p['powerPlay']} with {p.get('line') or 'no settled line'}. Do not price an unapproved promotion into the baseline; reassess when the role is confirmed.")
    return ('ROLE / EARNED OPPORTUNITY',
      'No power-play role is supplied in this snapshot. Separate the per-game skill forecast from the opportunity needed to realize it; a depth-chart opening does not itself add games.')

def category_lens(p):
    personal = {
      'Troy Terry': 'Terry\'s workload already reflects absence. An extra injury haircut would discount the same risk twice; increasing the games needs a supported return assumption.',
      'Thatcher Demko': 'Demko\'s starts remain conditional on recovery and deployment. A return to the ice alone would not establish how quickly he resumes a larger share of the crease.',
      'Filip Gustavsson': 'Gustavsson\'s projected starts are a recovery scenario. Keep the per-start return separate from the unresolved question of when, and how often, he can play.',
      'Frederik Andersen': 'Andersen\'s value depends on both recovery and access to starts. The supplied workload already carries the absence assumption; it is not a confirmed return schedule.',
    }
    if p.get('name') in personal:return personal[p['name']]
    base=p.get('baseGames')
    rows=sorted((c for c in p.get('contributions',[]) if base and c.get('weight',0)>0 and c.get('raw') is not None),key=lambda c:c['raw']/base*c['weight'],reverse=True)
    if not rows:return 'No scored category edge is available under these settings.'
    names={'shots_on_goal':'shot volume','power_play_points':'power-play scoring','goals_against':'goals against','penalty_minutes':'penalty minutes'}
    labels=[names.get(c['key'],c['key'].replace('_',' ')) for c in rows[:2]]
    return p.get('name','This player')+' gets the largest positive scoring contributions from '+ ' and '.join(labels)+'. A league that downweights those categories will value this same hockey profile differently.'
