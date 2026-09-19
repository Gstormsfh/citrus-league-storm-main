"""Research-informed draft decisions, illustrated with unchanged Citrus forecasts."""
from xml.sax.saxutils import escape
from layout import INK, CREAM, ORANGE, MUTED, WHITE
from customer_data import raw_totals
from reader_value import goalie_cost_note

SOURCES = {
    'rules': ('FantraxHQ / Draft preparation (2022)', 'https://fantraxhq.com/9-fantasy-hockey-draft-strategies-tips-for-new-players/'),
    'formats': ('FantraxHQ / Scoring formats (2024)', 'https://fantraxhq.com/fantasy-hockey-for-beginners-get-on-the-ice/'),
    'tiers': ('NHL.com / Tier method (2025)', 'https://www.nhl.com/news/fantasy-hockey-draft-rankings-tiers-for-2025-26'),
    'goalies': ('The Hockey News / Zero G tradeoffs (2023)', 'https://thehockeynews.com/nhl/fantasy/latest-news/fantasy-hockey-draft-strategy-zero-g'),
    'flexibility': ('DobberHockey / Flexible draft plans (2024)', 'https://dobberhockey.com/2024/09/29/21-fantasy-hockey-rambles-293/'),
}
PHOTO_IDS = ['8478402', '8482157', '8481542', '8476883', '8476945', '8482661',
             '8480069', '8477942', '8486067', '8482124']
STRATEGIES = (
    'Draft to your scoring',
    'Compare tiers before picking a position',
    'Decide when to draft goalies',
    'Adapt without chasing a positional run',
    'Use late picks for upside',
)


def strategy_heading(g, number):
    """Keep the section and the actionable strategy visible on every page."""
    title = STRATEGIES[number-1]
    g.start(f'Draft strategy {number}: {title}', 'Draft strategy')
    g.text('DRAFT STRATEGY', 36, 94, 44, 'Display')
    g.text(f'{number} / {len(STRATEGIES)}', 576, 91, 16, 'Display', MUTED, 'right')
    g.fit(f'{number:02}  {title.upper()}', 36, 124, 540, 21, 'Display', ORANGE)


def wait_comparison(players):
    """A two-pick arithmetic example, not tiers, ADP or replacement-level value."""
    forwards = [p for p in players if not p['isGoalie'] and p['position'] not in ('D', 'LD', 'RD')]
    defence = [p for p in players if p['position'] in ('D', 'LD', 'RD')]
    if len(forwards) < 2 or len(defence) < 2:
        return None
    f1, f2 = forwards[:2]; d1, d2 = defence[:2]
    return dict(keys=[p['key'] for p in (f1, f2, d1, d2)],
                forwardFirst=f1['fantasyPoints']+d2['fantasyPoints'],
                defenceFirst=d1['fantasyPoints']+f2['fantasyPoints'],
                forwardGap=f1['fantasyPoints']-f2['fantasyPoints'],
                defenceGap=d1['fantasyPoints']-d2['fantasyPoints'])


def refs(g, names):
    for i, key in enumerate(names):
        label, url = SOURCES[key]
        g.para('<link href="'+url+'" color="#5A6C60">'+escape(label)+' / Read strategy reference</link>',
               36, 704+i*12, 540, 7, 9)


def player(g, pid):
    return g.bykey['canonical:'+pid]


def photo_card(g, p, x, y, w=168, h=114, detail=None):
    g.portrait(p, x, y, w, h)
    g.fit(p['name'].upper(), x, y+h+20, w, 18, 'Display')
    rank = g.ranks.get(p['key'])
    g.fit(f'#{rank} / {p["fantasyPoints"]:.1f} FPTS' if rank else 'Outside your top 300',
          x, y+h+36, w, 8.8, 'Semi', MUTED)
    if detail:
        g.block(detail, x, y+h+47, w, 36, 9.3)


def end(g, topic, sources, **record):
    refs(g, sources)
    g.finish('Draft strategy', type='strategy', topic=topic, sourceUrls=[SOURCES[k][1] for k in sources],
             researchAsOf='2026-09-14', **record)


def render_strategy(g):
    # 1. Scoring is genuinely personalized; roster/transaction rules are not inputs.
    strategy_heading(g, 1)
    g.block('Draft for the points your league awards, not a player\'s reputation. Use your custom rankings to compare total value. A scorer, a physical winger and a multi-category defenceman can change places when the scoring changes.', 36, 149, 540, 60, 11)
    ids=['8478402','8482157','8481542']; hit_weight=g.result['weights']['skater'].get('hits',0)
    hit_examples=[]
    for i,pid in enumerate(ids):
        p=player(g,pid);hits=raw_totals(p).get('hits')
        detail='Hits forecast unavailable.' if hits is None else f'{hits:.1f} projected hits x {hit_weight:g} = {hits*hit_weight:+.1f} FPTS'
        photo_card(g,p,36+i*186,222,detail=detail)
        hit_examples.append(dict(key=p['key'],hits=hits,weight=hit_weight,points=None if hits is None else hits*hit_weight))
    g.text('DO NOT CHASE AN UNPAID STAT',36,454,19,'Display')
    g.block('Hits only help directly if your scoring rewards them. Even then, compare the whole player total. Do not pass on more overall value just to collect one category. These rankings are for points leagues, not category wins.',36,468,258,80,10.5)
    g.text('DRAFT PLAYERS YOU CAN START',318,454,19,'Display')
    g.block('Track open starting slots and position eligibility. Stockpiling one position can leave useful points on your bench while another slot stays weak. Roster and transaction limits are not inputs to these rankings.',318,468,258,80,10.5)
    g.rect(36,575,540,109,INK)
    g.text('ON DRAFT NIGHT',50,599,20,'Display',ORANGE)
    g.block('Start with your custom board. Before each pick, check total projected value and your open starting slots. Let both guide the choice.',50,612,512,55,11,CREAM)
    end(g,'scoring',['formats','rules'],examples=hit_examples)

    # 2. Compare opportunity costs without inventing positional tiers or survival odds.
    strategy_heading(g, 2)
    g.block('Group similar options, then compare the fall to your next acceptable choice. A small gap at one position and a larger gap elsewhere can matter more than which player has the higher overall rank.',36,148,540,49,11)
    comparison=wait_comparison(g.players)
    if comparison:
        ps=[g.bykey[k] for k in comparison['keys']]
        for i,p in enumerate(ps):photo_card(g,p,36+i*139,214,123,99)
        f1,f2,d1,d2=ps
        g.text('TWO POSSIBLE PAIRS / YOUR ACTUAL SCORING',36,383,18,'Display')
        for i,(label,a,b,total) in enumerate([
            ('FORWARD FIRST',f1,d2,comparison['forwardFirst']),
            ('DEFENCE FIRST',d1,f2,comparison['defenceFirst'])]):
            y=398+i*57;g.rect(36,y,540,51,WHITE)
            g.text(label,48,y+16,8,'Bold',MUTED)
            g.fit(a['name']+' + '+b['name'],48,y+36,409,13,'Semi')
            g.text(f'{total:.1f}',564,y+34,23,'Display',INK,'right')
        g.block('Illustration only: assume the named second choice is still available at your next pick. These are season-total sums, not an availability forecast or a fixed draft order.',36,520,540,44,10,MUTED)
        g.text('Forward gap: '+f'{comparison["forwardGap"]:.1f}'+' FPTS',36,582,15,'Display')
        g.text('Defence gap: '+f'{comparison["defenceGap"]:.1f}'+' FPTS',318,582,15,'Display')
    else:
        for i,pid in enumerate(['8478402','8480069','8481542']):photo_card(g,player(g,pid),36+i*186,214)
        g.block('This custom top 300 does not contain two options in both comparison groups. Use the full player pool to build your alternatives. The cutoff does not remove a required starting position.',36,422,540,80,12)
    g.block('Before picking, name the player you would take next at each position. If several similar options remain at one spot, waiting may cost less there. Check open slots and eligibility. The example above is not a value-above-replacement model.',36,617,540,65,11)
    end(g,'opportunity-cost',['tiers','formats'],comparison=comparison)

    # 3. Explicitly conditional goalie approaches, including signed scoring costs.
    strategy_heading(g, 3)
    for i,pid in enumerate(['8476883','8476945','8482661']):
        p=player(g,pid);photo_card(g,p,424,154+i*150,152,95)
    blocks=[
        ('DRAFT EARLY IF THE VALUE IS THERE', 'Take an anchor when his projected value and workload justify passing on the available skaters. Required goalie starts can make a dependable workload useful. Do not pay up simply because the position feels uncomfortable.'),
        ('WAIT IF YOU CAN MANAGE THE RISK', 'A late-goalie strategy keeps early picks for skaters. It works best when you can follow workloads and add available starters. A thin waiver pool, tight add limits or little time to manage makes waiting riskier.'),
        ('CHECK THE COST OF EACH START', 'Weigh saves, wins and shutouts against any goals-against penalty. More starts do not automatically mean more points. Check your league\'s minimum appearances and maximum starts; those limits are not included here.')]
    for i,(title,copy) in enumerate(blocks):
        y=169+i*145;g.fit(title,36,y,365,22,'Display');g.block(copy,36,y+15,365,104,11)
    g.rect(36,623,540,65,INK)
    g.text('IN YOUR SCORING',48,643,11,'Bold',ORANGE)
    g.block(goalie_cost_note(g.result['weights']),48,652,516,30,10.5,CREAM)
    end(g,'goalies',['goalies'],saveWeight=g.result['weights']['goalie'].get('saves',0),
        goalsAgainstWeight=g.result['weights']['goalie'].get('goals_against',0))

    # 4. A compact clock routine rather than guessed round-by-round instructions.
    strategy_heading(g, 4)
    g.picture(36,150,245,172,{'name':'Connor McDavid'})
    g.rect(295,150,281,172,INK)
    g.text('KEEP THREE',310,188,31,'Display',CREAM);g.text('OPTIONS READY.',310,222,31,'Display',CREAM)
    g.block('Your preferred pick. A same-position alternative. A different roster need you could fill instead.',310,239,250,64,11,CREAM)
    routines=[
        ('BUILD THE CORE', 'Start with strong contributions you can use. Avoid making every early pick depend on a breakout, a recovery or a role change.'),
        ('DO NOT FOLLOW A RUN AUTOMATICALLY', 'If goalies or defencemen go quickly, check the remaining tier and your open slots. Join only if waiting creates a real problem. The run may leave a better skater available.'),
        ('SEPARATE PRICE FROM VALUE', 'Use your custom board for value. Use your draft room and outside ADP for timing, never as a guarantee someone will last. This kit has no live ADP feed.')]
    for i,(title,copy) in enumerate(routines):
        y=346+i*61;g.text(f'{i+1:02}',36,y+18,24,'Display',ORANGE)
        g.text(title,75,y+12,11,'Bold');g.block(copy,75,y+20,501,36,10.4)
    for i,pid in enumerate(['8478402','8480069','8476883']):photo_card(g,player(g,pid),36+i*186,546,168,100)
    end(g,'draft-room',['flexibility','formats'])

    # 5. More photographs, with explicit choices and a final practical checklist.
    strategy_heading(g, 5)
    cards=[('8477942','INJURY STASH','Check the latest recovery report, IR eligibility and replacement options. Only stash a player if your roster can cover the wait.'),
           ('8486067','ROOKIE UPSIDE','Look for a path to NHL minutes and a useful role. Draft for this season in redraft leagues; a keeper league can reward a longer wait.'),
           ('8482124','BIGGER ROLE','Target an opportunity that could turn into points: stronger linemates, power-play time or more shots. Watch whether the role actually sticks.')]
    for i,(pid,title,copy) in enumerate(cards):
        x=36+i*186;photo_card(g,player(g,pid),x,156,168,131)
        g.text(title,x,350,11,'Bold',ORANGE);g.block(copy,x,362,168,97,10.4)
    g.text('MAKE EACH LATE PICK EARN ITS SPOT',36,488,26,'Display')
    prompts=[('UPSIDE','Name what needs to change for this player to become a starter.'),
             ('EVIDENCE','Watch deployment and health updates, not just one good game.'),
             ('PATIENCE','Set a review point based on the opportunity and your roster needs.'),
             ('PIVOT','If the role never arrives, compare waiver options before holding on.')]
    for i,(label,copy) in enumerate(prompts):
        y=505+i*39;g.line(36,y+33,540);g.text(label,36,y+18,9,'Bold',MUTED)
        g.block(copy,109,y+5,467,30,10.8)
    g.text('Printed checklist or saved PDF: cross off every pick, not just your own.',36,681,10,'Semi')
    end(g,'late-picks',['rules','flexibility'])
