import pytest
from projections.review_report_terminals import review_terminal


def body(types=('PEND','GEND','GOFF'), clocks=None):
    clocks=clocks or ['20:00']*len(types)
    header='Wednesday, October 4, 2017 Game 0003 Final Play By Play CGY On Ice EDM On Ice'
    rows=''.join('<tr class="evenColor">'+''.join(f'<td>{c}</td>' for c in
        [i+1,3,'',clocks[i],kind,'description'])+'</tr>' for i,kind in enumerate(types))
    return ('<html>'+header+'<table>'+rows+'</table></html>').encode()


def review(raw):
    return review_terminal(raw,game_id=2017020003,game_date='2017-10-04',away_abbrev='CGY',home_abbrev='EDM')


def test_gend_goff_is_review_only_and_retains_every_raw_row():
    got=review(body())
    assert got['status']=='eligible_terminal_v2_review'
    assert [r[4] for r in got['raw_report_rows']]==['PEND','GEND','GOFF']
    assert not got['activated'] and not got['raw_pbp_modified']
    assert review(body(('PEND','GEND')))['status']=='passes_existing_v1'


@pytest.mark.parametrize('raw', [body(('PEND','GOFF')),body(('PEND','GEND','GOFF','GOFF')),
    body(('GEND','PEND','GEND','GOFF')),body(('PEND','GEND','SHOT','GOFF')),
    body(clocks=['19:59','20:00','20:00']),body(clocks=['20:00','19:59','20:00']),
    body().replace(b'CGY On Ice',b'OTHER On Ice'),body().replace(b'<td>2</td>',b'<td>8</td>')])
def test_terminal_extension_does_not_bypass_other_gates(raw):
    assert review(raw)['status']=='unresolved'
