"""Internal draft-board links. Does not alter rankings, prose or AcroForms."""
import pymupdf as fitz

def reader_bookmarks(sections, records, players):
    """Section-first navigation, then a surname-sorted index of the actual board."""
    board={key:r['page'] for r in records if r.get('type')=='ranking' for key in r['keys']}
    toc=[[1,'Start here / Contents',2]]
    for name,page in sections:
        toc.append([1,name,page])
        if name=='All 32 team playbooks':
            toc.extend([2,r['team'],r['page']] for r in records if r.get('type')=='team')
    if board:
        toc.append([1,'Find a player / A-Z',min(board.values())])
        for p in sorted(players,key=lambda p:(p['name'].split()[-1].casefold(),p['name'].casefold(),p['key'])):
            toc.append([2,f"{p['name']} / {p['team']} / #{p['overallRank']}",board[p['key']]])
    return toc

def add_navigation(doc,records,players):
    profiles={r['key']:r['page']-1 for r in records if r.get('type')=='profile'}
    teams={r['team']:r['page']-1 for r in records if r.get('type')=='team'}
    by_key={p['key']:p for p in players}
    first_board=next((r['page']-1 for r in records if r.get('type')=='ranking'),None)
    links=[]
    for record in records:
        if record.get('type')!='ranking':continue
        source=record['page']-1
        for key,bounds in zip(record['keys'],record['rowBounds']):
            team=teams[by_key[key]['team']]
            y0,y1=bounds[1],bounds[3];middle=(y0+y1)/2
            for kind,destination,rect in [('player',profiles.get(key,team),[108,y0,296,middle]),('team',team,[108,middle,296,y1])]:
                doc[source].insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(rect),'page':destination})
                links.append(dict(kind=kind,key=key,page=source+1,destination=destination+1,rect=rect))
    for i,page in enumerate(doc):
        if i==1:continue
        page.insert_text((275,27),'CONTENTS',fontsize=6.5,color=(.35,.42,.38))
        page.insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(270,17,320,31),'page':1})
        if first_board is not None:
            page.insert_text((335,27),'BOARD',fontsize=6.5,color=(.35,.42,.38))
            page.insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(330,17,365,31),'page':first_board})
    return dict(boardLinks=links,contentsLinks=len(doc)-1,boardReturnLinks=len(doc)-1 if first_board is not None else 0)
