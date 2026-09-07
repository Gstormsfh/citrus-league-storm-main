import check_followup_report_clocks as m


def test_actor_period_clock_matching_and_ambiguity_retained():
    p={'typeCode':506,'periodDescriptor':{'number':1},'timeInPeriod':'01:02',
       'details':{'eventOwnerTeamId':1,'shootingPlayerId':2}}
    game={'homeTeam':{'id':1,'abbrev':'ABC'},'awayTeam':{'id':3,'abbrev':'DEF'},
          'rosterSpots':[{'playerId':2,'teamId':1,'sweaterNumber':7}]}
    def body(n):return f'<tr id="PL-{n}"><td>{n}</td><td>1</td><td>EV</td><td>1:02<br>18:58</td><td>SHOT</td><td>ABC ONGOAL - #7 TEST, Wrist</td>'.encode()
    r=m.module('review_goal_sog_evidence')
    assert len(m.matches(body(1),p,game,r))==1
    assert len(m.matches(body(1)+body(2),p,game,r))==2
    assert m.matches(body(1).replace(b'1:02',b'1:03'),p,game,r)==[]
    assert m.matches(body(1).replace(b'#7 ',b'#8 '),p,game,r)==[]
