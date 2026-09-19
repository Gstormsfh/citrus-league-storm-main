"""A paginated customer edition over Citrus's unchanged forecast and editorial engines."""
import argparse, hashlib, json, re, math
from pathlib import Path
from xml.sax.saxutils import escape
import pymupdf as fitz
from PIL import Image
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from layout import Guide, ROOT, ASSETS, INK, CREAM, ORANGE, MUTED, WHITE, RULE, pdfmetrics
from scoring import calculate
from customer_data import top_players, raw_totals, clean, assessments, team_structure, verify_snapshot, require_preseason_horizon, availability_watch
from reader_value import category_shortlists,goalie_cost_note,watchlist_notes,player_spotlights,projection_drivers
from player_stories import load_library, coverage, historical_metrics, load_season_context, require_story_conclusions
from board_reads import load_board_reads, select_board_features
from editorial_quality import validate_copy, validate_editorial_bundles
from deployment import load_deployment, team_deployment, verify_editorial_review

LABELS={'goals':'G','assists':'A','shots_on_goal':'SOG','power_play_points':'PPP','hits':'HIT','blocks':'BLK','penalty_minutes':'PIM','short_handed_points':'SHP','plus_minus':'+/-','wins':'W','saves':'SV','shutouts':'SO','goals_against':'GA'}
LONG={'goals':'Goals','assists':'Assists','shots_on_goal':'Shots on goal','power_play_points':'Power-play points','hits':'Hits','blocks':'Blocks','penalty_minutes':'Penalty minutes','short_handed_points':'Short-handed points','plus_minus':'Plus/minus','wins':'Wins','saves':'Saves','shutouts':'Shutouts','goals_against':'Goals against'}
KNOWN={'Connor McDavid':'mcdavid.jpg','Zach Werenski':1,'Connor Bedard':3,'Nikita Kucherov':5,'Nathan MacKinnon':6,'Kirill Kaprizov':7,'Cale Makar':8,'Andrei Vasilevskiy':9,'Miro Heiskanen':10}
def esc(s):return escape(clean(s))
def num(n,d=1):return 'N/A' if n is None else f'{n:,.{d}f}'

def board_pages(players, size=15, features=None):
    """Separate units for reading, retaining membership and the combined rank."""
    for goalie in (False,True):
        cohort=[p for p in players if p['isGoalie']==goalie]
        if features is not None:
            chunk=[];features_on_page=0;pages=[]
            for p in cohort:
                is_feature=str(p['playerId']) in features
                # Reserve a readable row plus the entire attached card and
                # continuation header. Page breaks follow editorial choices.
                cost=(len(chunk)+1)*(400/15)+(features_on_page+is_feature)*136
                if chunk and (len(chunk)>=size or cost>547):
                    pages.append(chunk);chunk=[];features_on_page=0
                chunk.append(p);features_on_page+=is_feature
            if chunk:pages.append(chunk)
            # Avoid an orphan tail row without selecting, dropping or moving a
            # feature away from its player. Only the page boundary may move.
            if len(pages)>1 and len(pages[-1])<size/2:
                tail=pages[-2]+pages[-1]
                def fits(part):
                    return 0<len(part)<=size and len(part)*(400/15)+sum(str(p['playerId']) in features for p in part)*136<=547
                cuts=[i for i in range(1,len(tail)) if fits(tail[:i]) and fits(tail[i:])]
                if cuts:
                    cut=min(cuts,key=lambda i:abs(len(tail)-2*i))
                    pages[-2:]=[tail[:cut],tail[cut:]]
            for chunk in pages:yield goalie,chunk
            continue
        count=math.ceil(len(cohort)/size);start=0
        for page in range(count):
            length=math.ceil((len(cohort)-start)/(count-page))
            yield goalie,cohort[start:start+length];start+=length

def inline_board_layout(count, featured_index):
    """Zero or multiple preselected reads, each attached to its actual row."""
    indices=([featured_index] if isinstance(featured_index,int) else list(featured_index or []))
    if not 1 <= count <= 15 or len(set(indices))!=len(indices) or any(not 0<=i<count for i in indices):
        raise ValueError('Invalid inline ranking layout')
    overhead=len(indices)*110+sum(i<count-1 for i in indices)*26
    height=min(42,min(520,547-overhead)/count)
    if height<400/15-.001:raise ValueError('Too many editorial cards for readable ranking rows')
    cursor=175;rows=[];cards={};continuations={}
    for i in range(count):
        rows.append([36,cursor,576,cursor+height]);cursor+=height
        if i in indices:
            cards[i]=[36,cursor,576,cursor+110];cursor+=110
            if i<count-1:
                cursor+=6;continuations[i]=cursor;cursor+=20
    first=indices[0] if indices else None
    return dict(rows=rows,cards=cards,continuations=continuations,
                card=cards.get(first),continuation=continuations.get(first),bottom=cursor,rowHeight=height)

class CustomerGuide(Guide):
    def __init__(self,data,result,editorial,evidence,news,editorial_root=ROOT,source_root=None):
        super().__init__();self.data=data;self.result=result;self.editorial=editorial;self.evidence=evidence;self.news=news
        editorial_root=Path(editorial_root);deployment_path=editorial_root/'deployment-research.json'
        self.editorial_root=editorial_root
        source_root=Path(source_root) if source_root is not None else ROOT/'review-inputs'
        from editorial_quality import BUNDLES
        self.editorial_files={str(editorial_root/name):hashlib.sha256((editorial_root/name).read_bytes()).hexdigest()
                              for name in (*BUNDLES,'deployment-research.json','photo-rights.json')}
        self.players=top_players(result);self.bykey={p['key']:p for p in result['players']}
        self.ranks={p['key']:p['overallRank'] for p in self.players};self.manifest=[];self.sections=[];self.page_images=[];self.issues=[]
        self.as_of=data.get('source',{}).get('asOf','undated')[:10];self.league=''
        portraits=ASSETS/'headshots/manifest.json'
        self.portraits=json.loads(portraits.read_text()) if portraits.exists() else {}
        self.watch=watchlist_notes(result['players'],editorial_root)
        self.notes={n['playerId']:n for n in self.watch['items']}
        self.spotlight_bundle=player_spotlights(result['players'],editorial_root)
        self.spotlight_notes={n['playerId']:n for n in self.spotlight_bundle['items']}
        self.stories=load_library(result['players'],editorial_root/'player-story-library.json')
        self.season_context=load_season_context(result['players'],data['canonicalRevision'],editorial_root/'player-season-context.json',deployment_path=deployment_path) if data.get('canonicalRevision') else {}
        self.board_reads=load_board_reads(result['players'],data.get('canonicalRevision'),editorial_root/'board-reads.json',deployment_path=deployment_path)
        self.deployment=load_deployment(data,deployment_path) if data.get('canonicalRevision') else None
        team_bundle=json.loads((editorial_root/'team-readings.json').read_text());verify_editorial_review(team_bundle,deployment_path)
        self.team_reads={n['team']:n for n in team_bundle['items']}
        if len(self.team_reads)!=len(team_bundle['items']) or set(self.team_reads)!=set(data['schedule']):
            raise ValueError('Authored team reads must cover each team exactly once')
        self.story_coverage=coverage(self.players,self.stories)
        from historical_corrections import verification_receipt,category_receipt
        history=json.loads((source_root/'historical-verification.json').read_text())
        self.historical_verification=verification_receipt(evidence,self.players,history)
        categories=json.loads((source_root/'category-verification.json').read_text())
        self.historical_verification['categories']=category_receipt(evidence,self.players,categories)
    def fit(self,text,x,y,width,size=12,font='Semi',color=INK):
        text=clean(text);size=min(size,width/max(pdfmetrics.stringWidth(text,font,1),1))
        self.text(text,x,y,size,font,color)
    def block(self,text,x,y,width,height,size=9.4,color=INK):
        text=esc(text)
        for candidate in (size,size-.4,size-.8,size-1.2):
            style=ParagraphStyle('fit',fontName='Body',fontSize=candidate,leading=candidate*1.28)
            h=Paragraph(text,style).wrap(width,10000)[1]
            if h<=height:return self.para(text,x,y,width,candidate,candidate*1.28,color)
        raise ValueError(f'Page {self.number}: copy exceeds reserved space: {clean(text)[:100]}')
    def heading(self,title,section,deck=''):
        self.start(title,section);self.fit(title.upper(),36,94,540,44,'Display')
        if deck:self.block(deck,36,110,540,35,9.5,MUTED)
    def finish(self,section,**record):
        self.text('PROJECTIONS AS OF '+self.as_of,36,744,6.5,'Semi',MUTED)
        self.text('CUSTOMIZED FOR YOUR LEAGUE',576,744,6.5,'Semi',MUTED,'right')
        self.footer(section);self.manifest.append(dict(page=self.number,section=section,**record));self.end()
    def picture(self,x,y,w,h,player=None):
        name=player['name'] if player and player['name'] in KNOWN else None
        asset=KNOWN.get(name,'winter-classic.jpg')
        if isinstance(asset,int):self.overlays.append((self.number-1,'photo',asset,(x,y,x+w,y+h)))
        elif asset=='mcdavid.jpg':
            iw,ih=Image.open(ASSETS/asset).size;scale=min(w/iw,h/ih)
            self.rect(x,y,w,h,INK);self.photo(asset,x+(w-iw*scale)/2,y+(h-ih*scale)/2,iw*scale,ih*scale)
        else:
            self.photo(asset,x,y,w,h,cover=True)
            self.rect(x,y+h-12,w,12,INK);self.text('2024 WINTER CLASSIC',x+4,y+h-3,5.5,'Semi',CREAM)
        self.page_images.append(dict(page=self.number,asset=asset,subject=name or '2024 Winter Classic game scene',rect=[x,y,w,h]))
        return name
    def portrait(self,p,x,y,w,h):
        pid=str(p.get('playerId',''));record=self.portraits.get(pid,{})
        path=ASSETS/'headshots'/record.get('file',f'{pid}.png')
        if record.get('status')!='downloaded' or not path.exists():
            raise ValueError('Verified ID-matched portrait unavailable: '+p['name'])
        if hashlib.sha256(path.read_bytes()).hexdigest()!=record['sha256']:
            raise ValueError('Portrait cache differs from manifest: '+p['name'])
        self.rect(x,y,w,h,'#E3E9DC')
        iw,ih=record['size'];action=record.get('kind')=='article-photo'
        scale=(max if action else min)(w/iw,h/ih);dw,dh=iw*scale,ih*scale
        self.c.saveState();clip=self.c.beginPath();clip.rect(x,792-y-h,w,h);self.c.clipPath(clip,stroke=0)
        self.c.drawImage(str(path),x+w/2-dw*record.get('focalX',.5),792-y-h+(h-dh)/2,dw,dh,mask='auto')
        self.c.restoreState()
        self.c.linkURL(record.get('sourcePage',record['url']),(x,792-y-h,x+w,792-y),relative=0,thickness=0)
        self.page_images.append(dict(page=self.number,asset=str(path),subject=p['name'],
                                     playerKey=p['key'],playerId=pid,url=record['url'],
                                     sourcePage=record.get('sourcePage'),photoType=record.get('kind','headshot'),
                                     sha256=record['sha256'],kind='player-portrait',rect=[x,y,w,h]))
    def board_callout(self,p,y,selection):
        self.rect(36,y,540,110,INK);self.portrait(p,36,y,104,110)
        self.fit('CITRUS READ / '+selection['label'],152,y+14,410,7.5,'Bold',ORANGE)
        self.fit(p['name'].upper(),152,y+35,410,23,'Display',CREAM)
        note=self.board_reads.get(str(p['playerId']))
        if note:
            self.block(note['body'],152,y+42,410,53,9.2,CREAM)
            label=note.get('source','Citrus projected team roles / Not confirmed assignments')
            if note.get('url'):
                self.para('<link href="'+escape(note['url'],{'"':'&quot;'})+'" color="#F6F3E8">'+esc(label+' / Read source')+'</link>',152,y+99,410,6.6,8)
            else:self.text(label,152,y+106,6.6,'Body',CREAM)
        else:
            self.block('An individual opportunity read is still pending for this part of the custom board. This review edition does not substitute a statistical summary for research.',152,y+44,410,52,9.2,CREAM)
        return dict(status='authored' if note else 'pending',
                    body=note['body'] if note else None,
                    sourceUrl=note.get('url') if note else None,
                    basis='Citrus canonical projected deployment; not confirmed lineups',
                    bodySha256=hashlib.sha256(note['body'].encode()).hexdigest() if note else None)
    def image_band(self,y=145,player=None,headline='HOCKEY FIRST.',caption='A sharper read on your draft.'):
        self.rect(36,y,540,89,INK)
        self.picture(36,y,150,89,player)
        self.fit(headline.upper(),200,y+31,356,24,'Display',CREAM)
        self.block(caption,200,y+44,356,35,9,CREAM)
    def statline(self,p,x,y,w=540,dark=False):
        raw=raw_totals(p);keys=['wins','saves','shutouts','goals_against'] if p['isGoalie'] else ['goals','assists','shots_on_goal','power_play_points','hits','blocks']
        cells=[('STARTS' if p['isGoalie'] else 'GP',p['games'])]+[(LABELS[k],raw.get(k)) for k in keys]
        if not p['isGoalie']:cells.insert(3,('PTS',raw['goals']+raw['assists'] if 'goals' in raw and 'assists' in raw else None))
        for i,(label,value) in enumerate(cells):
            xx=x+i*w/len(cells)
            self.text(label,xx+8,y+12,6.7,'Semi',CREAM if dark else MUTED)
            self.text(num(value,0 if label in ('GP','STARTS','SOG','HIT','BLK','SV') else 1),xx+8,y+33,18,'Display',ORANGE if dark else INK)
        return raw
    def cover(self):
        self.start('Your Citrus draft kit',dark=True);self.logo(36,30,175)
        self.text('2026-27',576,63,27,'Display',ORANGE,'right')
        self.text('HOCKEY FANS DESERVE BETTER.',36,125,12,'Semi',ORANGE)
        self.text('OWN YOUR',32,211,94,'Display',CREAM);self.text('DRAFT.',32,301,110,'Display',CREAM)
        self.picture(0,325,612,330,{'name':'Connor McDavid'})
        self.rect(36,629,540,87,INK);self.rect(36,629,5,87,ORANGE)
        self.fit(self.league,52,657,505,22,'Display',CREAM)
        self.block('Your top 300. Every NHL team. Citrus player assessments. The offseason changes that matter.',52,670,500,35,11,CREAM)
        self.text('CitrusFantasySports.com',36,764,10,'Semi',CREAM)
        self.manifest.append(dict(page=1,section='Cover'));self.end()
    def settings(self):
        self.heading('Built for your league','Scoring','Change the weights. Keep the hockey projections.')
        for group,x in [('skater',36),('goalie',318)]:
            self.text(group.upper(),x,173,24,'Display',ORANGE)
            for i,(key,value) in enumerate(self.result['weights'][group].items()):
                y=190+i*26;self.line(x,y+24,258)
                self.text(LONG.get(key,key),x,y+15,10);self.text(str(value),x+253,y+15,10,'Bold',INK,'right')
        self.block('HOW TO READ YOUR BOARD',36,454,540,25,13)
        self.block('Fantasy points use your selected weights. The raw G, A, SOG and other hockey totals do not change when a category is switched off. N/A means a forecast is missing, not zero.',36,481,540,50,10.5)
        self.block('This points-league board uses total projected fantasy points. A position group with every weight set to zero is left out. It is not ADP, category-league value or value above replacement. Ties are ordered by name. The first 300 eligible players make this edition.',36,538,540,63,10.5)
        self.image_band(627,headline='One projection. Your scoring.',caption='Rates multiplied by projected games or starts once. News and lineup commentary never silently change the numbers.')
        self.finish('Scoring',type='settings')
    def board(self):
        features=select_board_features(self.players,self.board_reads,self.result['weights'])
        for goalie,chunk in board_pages(self.players,features=features):
            y=149;featured_indices=[i for i,p in enumerate(chunk) if str(p['playerId']) in features]
            layout=inline_board_layout(len(chunk),featured_indices)
            self.heading('Top 300 / '+('Goalies' if goalie else 'Skaters'),'Draft board',
                         'Click a name for its Citrus read or team playbook. Team labels open team pages. Overall ranks retained.')
            self.text('FPTS = your league\'s fantasy points. All other columns = projected hockey totals.',36,135,8.6,'Body',MUTED)
            self.text('AVAILABILITY = a current source concern, not confirmed games missed. Recheck before drafting.',36,146,7.5,'Body',MUTED)
            widths=[34,230,44,40,58,48,36,50] if goalie else [34,250,30,36,36,45,45,64]
            assert sum(widths)==540
            headers=['RANK','PLAYER','STARTS','WINS','SAVES','GA','SO','FPTS'] if goalie else ['RANK','PLAYER','GP','G','A','PTS','SOG','FPTS']
            def table_header(yy,height=26):
                self.rect(36,yy,540,height,INK);xx=36
                for j,(h,w) in enumerate(zip(headers,widths)):
                    self.text(h,xx+6 if j<2 else xx+w-7,yy+height-9,8,'Semi',CREAM,'left' if j<2 else 'right');xx+=w
            table_header(y)
            callouts=[]
            row_height=layout['rowHeight']
            for i,q in enumerate(chunk):
                yy=layout['rows'][i][1];featured=i in featured_indices
                self.rect(36,yy,540,row_height,'#FFE2C8' if featured else WHITE if i%2==0 else '#EEEFE6')
                if featured:self.rect(36,yy,4,row_height,ORANGE);highlighted=[36,yy,576,yy+row_height]
                raw=raw_totals(q)
                stats=([num(raw.get('wins')),num(raw.get('saves'),0),num(raw.get('goals_against'),0),num(raw.get('shutouts'))]
                       if goalie else [num(raw.get('goals')),num(raw.get('assists')),
                                       num(None if raw.get('goals') is None or raw.get('assists') is None else raw['goals']+raw['assists']),num(raw.get('shots_on_goal'),0)])
                values=[str(q['overallRank']),q['name'],num(q['games'],0),*stats,num(q['fantasyPoints'])]
                xx=36
                for j,(v,w) in enumerate(zip(values,widths)):
                    if j==1:
                        self.portrait(q,xx+6,yy+2,26,row_height-4)
                        self.fit(v,xx+40,yy+row_height/2-2,w-46,10.7,'Bold' if featured else 'Semi')
                        health=availability_watch(q,self.deployment)
                        self.text(q['team']+'  /  '+q['position']+('  /  AVAILABILITY' if health else ''),xx+40,yy+row_height/2+9,8,'Body',ORANGE if health else MUTED)
                    else:self.text(v,xx+w-7,yy+row_height/2+4,11,'Bold' if j==7 or featured else 'Body',INK,'right')
                    xx+=w
                if featured:
                    selection=features[str(q['playerId'])];card=layout['cards'][i]
                    callout=self.board_callout(q,card[1],selection)
                    self.rect(36,card[1],4,110,ORANGE)
                    continuation=layout['continuations'].get(i)
                    if continuation is not None:table_header(continuation,20)
                    callouts.append(dict(featured=q['key'],highlightedKey=q['key'],featuredRowBounds=highlighted,
                                         callout=callout,calloutBounds=card,continuationHeaderY=continuation,selection=selection))
            if len(chunk)<8:
                ey=layout['bottom']+25
                self.text('THE CUTOFF IS NOT A ROSTER PLAN.',36,ey+22,27,'Display')
                cohort_count=sum(q['isGoalie']==goalie for q in self.players)
                cohort_word='goalie' if goalie else 'skater'
                self.block(f'Only {cohort_count} {cohort_word}'+('s' if cohort_count!=1 else '')+' made the combined top 300 at these weights. That is a fantasy-points cutoff, not a recommendation for how many roster spots to fill. A required position still needs to be drafted.',36,ey+36,540,67,11)
                if len(chunk)<5 and 722-(ey+112)>=130:
                    by=ey+112;bh=min(154,722-by)
                    self.rect(36,by,260,bh,WHITE);self.rect(312,by,264,bh,'#E3E9DC')
                    self.text('WHAT THE BOARD MEASURES',48,by+23,16,'Display')
                    self.block('Projected fantasy points from the categories you selected. The ordering does not include your roster requirements, positional replacement value or what other managers will pay.',48,by+40,236,bh-48,10.5)
                    self.text('WHAT TO DO ON DRAFT DAY',324,by+23,16,'Display')
                    self.block('Set your positional needs before following overall ranks. If a required position runs beyond this top 300, use the full Citrus player pool. Do not leave the slot empty just because another skater has more projected points.',324,by+40,240,bh-48,10.5)
            self.finish('Draft board',type='ranking',cohort='goalie' if goalie else 'skater',
                        headers=headers,keys=[q['key'] for q in chunk],ranks=[q['overallRank'] for q in chunk],
                        features=callouts,rowBounds=layout['rows'])
    def shortlists(self):
        cards=category_shortlists(self.players,self.result['weights'])
        if not cards:
            self.heading('Build your shortlist','Draft desk','Your current settings do not produce positive category shortlists.')
            self.image_band(160,headline='Start with the full total.',caption='Negative weights are costs. They are not used to present category volume as a reward.')
            self.finish('Draft desk',type='shortlists',cards=[]);return
        for start in range(0,len(cards),3):
            chunk=cards[start:start+3]
            self.heading('Build your shortlist','Draft desk','Category options beyond the first 50 names on your board. These are not ADP or round recommendations.')
            self.text('Contributions use unrounded forecasts. Displayed totals are rounded to one decimal.',36,135,8.2,'Body',MUTED)
            for i,card in enumerate(chunk):
                y=150+i*174;key=card['category'];label=LABELS.get(key,key)
                self.text(LONG.get(key,key).upper(),36,y+21,24,'Display',INK)
                self.text(f'{card["weight"]:g} FPTS EACH',576,y+18,10,'Bold',INK,'right')
                self.text('Top category totals outside your first 50' if card['beyond50'] else 'Top category totals on your board',36,y+37,8.5,'Body',MUTED)
                self.text('PLAYER / OVERALL RANK',36,y+56,7.7,'Bold',MUTED)
                self.text('PROJ. '+label,454,y+56,7.7,'Bold',MUTED,'right')
                self.text('FPTS FROM '+label,570,y+56,7.7,'Bold',MUTED,'right')
                for j,row in enumerate(card['rows']):
                    p=row['player'];yy=y+64+j*30;self.rect(36,yy,540,29,WHITE)
                    self.portrait(p,41,yy+1,27,27)
                    self.fit(p['name'],78,yy+13,285,11,'Semi')
                    self.text(f'#{p["overallRank"]}  /  {p["team"]}  /  {p["position"]}',78,yy+25,8,'Body',MUTED)
                    self.text(num(row['raw']),454,yy+20,13,'Display',INK,'right')
                    self.text(num(row['contribution']),570,yy+20,13,'Display',INK,'right')
            self.rect(36,689,540,37,INK)
            tip=goalie_cost_note(self.result['weights']) if start else 'Fill a category gap without ignoring the full player. Shortlists use your enabled positive weights; missing forecasts are excluded, not treated as zero.'
            self.block(tip,48,696,516,27,9,CREAM)
            self.finish('Draft desk',type='shortlists',cards=[dict(category=c['category'],weight=c['weight'],group=c['group'],beyond50=c['beyond50'],rows=[dict(key=r['player']['key'],raw=r['raw'],contribution=r['contribution']) for r in c['rows']]) for c in chunk])
    def watchlist(self):
        for start in range(0,len(self.watch['items']),4):
            chunk=self.watch['items'][start:start+4]
            self.heading('Before you draft','Draft watchlist',('Health and the crease' if start==0 else 'Rookies and new roles')+' / Selected reporting checked '+self.watch['asOf'])
            for i,n in enumerate(chunk):
                p=self.bykey['canonical:'+n['playerId']];y=150+i*143
                self.line(36,y,540);self.portrait(p,36,y+12,72,90)
                self.fit(p['name'].upper(),124,y+24,325,25,'Display')
                rank=self.ranks.get(p['key']);self.text(f'#{rank} OVERALL' if rank else 'OUTSIDE TOP 300',576,y+22,8,'Semi',MUTED,'right')
                self.fit(n['headline'],124,y+41,452,10.3,'Semi',INK)
                self.block(n['fact'],124,y+50,452,28,9.5,MUTED)
                self.block('CITRUS READ: '+n['analysis'],124,y+79,452,42,9.5)
                self.para('<link href="'+escape(n['url'],{'"':'&quot;'})+'" color="#5A6C60">'+esc(n['source']+' / '+n['date']+' / Read report')+'</link>',124,y+123,452,7.5,9)
            self.finish('Draft watchlist',type='watchlist',playerIds=[n['playerId'] for n in chunk],sourceUrls=[n['url'] for n in chunk],newsAsOf=self.watch['asOf'])
    def story_layout(self,story,context):
        if not context:
            height=274 if story.get('metrics') else (228 if len(story['body'].split())>42 else 168)
            return dict(height=height,bodyHeight=34 if height==168 else (80 if story.get('metrics') else 92),
                        sourceY=104 if height==168 else (154 if story.get('metrics') else 166),
                        metricsY=168,metricReadY=208,projectionY=height-34)
        def measured(text,width):
            style=ParagraphStyle('measure-story',fontName='Body',fontSize=10.5,leading=10.5*1.28)
            return Paragraph(esc(text),style).wrap(width,10000)[1]
        plan=dict(bodyHeight=measured(story['body'],438))
        plan['sourceY']=67+plan['bodyHeight']+4;cursor=plan['sourceY']+10
        if story.get('metrics'):
            plan['metricsY']=cursor+8;plan['metricReadY']=plan['metricsY']+43
            cursor=plan['metricReadY']+28
        # Full-width copy clears the portrait and rank even for short anecdotes.
        plan['seasonHeadlineY']=max(cursor+17,145);plan['seasonBodyY']=plan['seasonHeadlineY']+9
        plan['seasonBodyHeight']=measured(context['body'],540)
        plan['seasonSourceY']=plan['seasonBodyY']+plan['seasonBodyHeight']+4
        plan['projectionY']=plan['seasonSourceY']+18;plan['height']=plan['projectionY']+34
        return plan
    def profiles(self):
        # Review builds show only genuinely authored copy. No substituted stats
        # paragraphs. Every missing ID stays in the export's research ledger.
        selected=[p for p in self.players if str(p['playerId']) in self.stories]
        require_story_conclusions({str(p['playerId']):self.stories[str(p['playerId'])] for p in selected},self.season_context)
        pages=[];chunk=[];used=0
        for p in selected:
            story=self.stories[str(p['playerId'])]
            context=self.season_context.get(str(p['playerId']));plan=self.story_layout(story,context);height=plan['height']
            if chunk and used+height+18>568:
                pages.append(chunk);chunk=[];used=0
            chunk.append((p,story,context,plan));used+=height+(18 if len(chunk)>1 else 0)
        if chunk:pages.append(chunk)
        for entries in pages:
            self.heading('The Citrus read','Player stories','The story behind the player. The opportunity ahead. Each source keeps its own date.')
            y=150
            for index,(p,story,context,plan) in enumerate(entries):
                height=plan['height']
                photo_right=(self.number+index)%2==0
                px=488 if photo_right else 36;tx=36 if photo_right else 138;tw=438
                self.portrait(p,px,y+4,88,100)
                self.text(f'#{p["overallRank"]:03}',px,y+128,24,'Display',INK)
                self.text(story['kind'].upper(),tx,y+8,7.5,'Bold',ORANGE)
                self.fit(p['name'].upper(),tx,y+35,tw-105,27,'Display')
                self.text(p['team']+' / '+p['position'],tx+tw,y+24,8,'Semi',MUTED,'right')
                self.text(num(p['fantasyPoints'])+' FPTS',tx+tw,y+39,11,'Display',INK,'right')
                self.fit(story['headline'],tx,y+57,tw,11.2,'Bold',INK)
                self.block(story['body'],tx,y+67,tw,plan['bodyHeight']+.01,10.5)
                source_y=y+plan['sourceY']
                self.para('<link href="'+escape(story['url'],{'"':'&quot;'})+'" color="#5A6C60">'+esc(story['source']+' / '+story['date']+' / Read source')+'</link>',tx,source_y,tw,7.2,9)
                metrics=historical_metrics(story,self.evidence)
                if metrics:
                    # Compact evidence strip. NHL actuals and Citrus forecasts
                    # are deliberately separate and carry different clocks.
                    my=y+plan['metricsY'];self.rect(36,my,540,35,'#E3E9DC')
                    season=story['metricSeason']
                    self.text(f'{season}-{str(season+1)[-2:]} NHL',44,my+14,7.2,'Bold',MUTED)
                    self.text('ACTUALS',44,my+26,7.2,'Bold',MUTED)
                    for j,row in enumerate(metrics):
                        x=138+j*108
                        self.text(row['label'],x,my+12,6.8,'Semi',MUTED)
                        self.text(row['display'],x,my+29,16,'Display',INK)
                    self.block(story['metricRead'],36,y+plan['metricReadY'],540,28,9.4)
                if context:
                    self.fit('2026-27 / '+context['headline'].upper(),36,y+plan['seasonHeadlineY'],540,12,'Display',ORANGE)
                    self.block(context['body'],36,y+plan['seasonBodyY'],540,plan['seasonBodyHeight']+.01,10.5)
                    links=[]
                    for source in context['sources']:
                        label=esc(source['label']+' / '+source['date'])
                        links.append('<link href="'+escape(source['url'],{'"':'&quot;'})+'" color="#5A6C60">'+label+'</link>' if source.get('url') else label)
                    self.para(' | '.join(links),36,y+plan['seasonSourceY'],540,6.8,9,MUTED)
                py=y+plan['projectionY'];self.rect(36,py,540,34,INK)
                raw=raw_totals(p)
                order=['wins','saves','goals_against','shutouts'] if p['isGoalie'] else ['goals','assists','shots_on_goal','power_play_points','hits','blocks']
                self.text('2026-27',44,py+13,6.8,'Bold',CREAM)
                self.text('PROJECTED',44,py+25,6.8,'Bold',CREAM)
                cells=[('STARTS' if p['isGoalie'] else 'GP',p['games'])]+[(LABELS[k],raw.get(k)) for k in order]
                for j,(label,value) in enumerate(cells):
                    x=118+j*(450/len(cells))
                    self.text(label,x,py+11,6.8,'Semi',CREAM)
                    self.text(num(value,0 if label in ('GP','STARTS','SOG','SV','HIT','BLK','GA') else 1),x,py+28,13,'Display',CREAM)
                self.manifest.append(dict(page=self.number,type='profile',key=p['key'],playerId=story['playerId'],copySource='Citrus individually authored research',sourceUrl=story['url'],sourceDate=story['date'],storyKind=story['kind'],copyWords=len(story['body'].split()),historicalMetrics=metrics,bodySha256=hashlib.sha256(story['body'].encode()).hexdigest(),seasonContext=context))
                y+=height+18
            self.finish('Player stories',type='profiles',keys=[p['key'] for p,_,_,_ in entries])
    def spotlights(self):
        items=self.spotlight_bundle['items']
        for start in range(0,len(items),2):
            self.heading('The picks worth a closer look','Player spotlights','Original Citrus draft commentary / Reporting checked '+self.spotlight_bundle['asOf'])
            for i,n in enumerate(items[start:start+2]):
                p=self.bykey['canonical:'+n['playerId']];y=148+i*289
                photo_x=36 if i==0 else 492;text_x=134 if i==0 else 36
                self.portrait(p,photo_x,y,84,84)
                self.text(n['theme'],text_x,y+12,8,'Bold',ORANGE)
                self.fit(p['name'].upper(),text_x,y+40,345,28,'Display')
                rank=self.ranks.get(p['key']);rank_text=f'#{rank} IN YOUR TOP 300' if rank else 'OUTSIDE YOUR TOP 300'
                self.text(p['team']+' / '+p['position']+' / '+rank_text,text_x,y+56,8,'Semi',MUTED)
                self.fit(n['headline'],text_x,y+76,345,11,'Bold')
                self.block('REPORTED: '+n['fact'],36,y+94,540,30,9.4,MUTED)
                self.block(n['read'],36,y+131,540,62,10.4)
                self.rect(36,y+196,540,35,'#EEEFE6')
                self.block('THE RISK: '+n['risk'],46,y+202,520,25,9.4)
                self.block('WATCH: '+n['watch'],36,y+237,540,27,9.4)
                self.para('<link href="'+escape(n['url'],{'"':'&quot;'})+'" color="#5A6C60">'+esc(n['source']+' / '+n['date']+' / Read reporting')+'</link>',36,y+266,540,7.5,9)
                self.manifest.append(dict(page=self.number,type='spotlight',key=p['key'],playerId=n['playerId'],sourceUrl=n['url'],sourceDate=n['date'],copyWords=sum(len(n[k].split()) for k in ('read','risk','watch'))))
            self.finish('Player spotlights',type='spotlights')
    def slot(self,p,x,y,w,label):
        self.rect(x,y,w,40,WHITE);self.text(label,x+7,y+11,6.7,'Semi',MUTED)
        if p:
            self.fit(p['name'],x+7,y+26,w-14,10,'Semi')
            rank=self.ranks.get(p['key']);s=f'#{rank}' if rank else ('Forecast pending' if p.get('forecastStatus')!='projected' else 'Outside top 300')
            self.text(s,x+7,y+37,6.7,'Body',MUTED)
        else:self.text('Open competition',x+7,y+28,9,'Semi',MUTED)
    def team_page(self,t):
        st=team_deployment(t['team'],self.result['players'],self.deployment) if self.deployment else team_structure(t,self.result['players'])
        self.issues.extend(dict(team=t['team'],**i) for i in st['issues'])
        title=re.sub(r'\s*\([A-Z]+\)\s*$','',t['title'])
        self.heading(title,'Team playbook',f'{t["team"]}  /  Editorial projection, not a confirmed opening-night lineup')
        tp=[p for p in self.players if p['team']==t['team']]
        feature=tp[0] if tp else None
        if feature:self.portrait(feature,470,147,86,86)
        else:self.picture(446,147,130,86)
        read=self.team_reads[t['team']]
        self.fit(read['headline'],36,158,410,10,'Bold',ORANGE)
        self.block(read['body'],36,170,410,52,9.5)
        if self.deployment:
            source=self.deployment['teams'][t['team']]
            self.para('<link href="'+escape(source['url'],{'"':'&quot;'})+'" color="#5A6C60">Deployment source: '+source['updated']+' / checked '+source['checkedAt']+'</link>',36,226,540,7,9)
            corrections={a['url']:a['date'] for a in source.get('adjustments',[])}
            if corrections:
                links=['<link href="'+escape(url,{'"':'&quot;'})+'" color="#5A6C60">'+day+'</link>' for url,day in corrections.items()]
                self.para('Later deployment reporting: '+' / '.join(links),36,238,540,7,9)
        self.text('FORWARD LINES',36,265,18,'Display');self.text('POWER PLAY',414,265,18,'Display')
        for i,(label,line) in enumerate(st['lines'].items()):
            yy=275+i*43
            for j,pos in enumerate(('LW','C','RW')):self.slot(line.get(pos),36+j*120,yy,114,label+' / '+pos)
        # Use only explicit source assignments. Match names to this team before display.
        team_names={p['name'].casefold():p for p in self.result['players'] if p['team']==t['team']}
        for i,unit in enumerate(('PP1','PP2')):
            y=282+i*90;self.text(unit,414,y,10,'Bold',ORANGE)
            if self.deployment:
                names=[p['name'] if p else 'Open spot (unavailable)' for p in st['powerPlay'][unit]]
                self.block(' / '.join(names),414,y+9,162,68,9)
                continue
            matches=[u for u in t.get('specialTeams',[]) if u.get('unit')==unit]
            source=matches[0].get('imported_text','') if matches else ''
            names=[]
            for token in source.split(','):
                token=token.strip();candidates=[p for name,p in team_names.items() if name==token.casefold() or name.endswith(' '+token.casefold())]
                if len(candidates)==1:names.append(candidates[0]['name'])
            self.block(' / '.join(names) if names else 'Unit not established in the source.',414,y+9,162,68,9)
        self.text('DEFENCE PAIRS',36,472,18,'Display')
        for i,(label,pair) in enumerate(st['pairs'].items()):
            for j,pos in enumerate(('LD','RD')):self.slot(pair.get(pos),36+j*180,482+i*47,174,label+' / '+pos)
        self.text('THE CREASE',414,470,18,'Display')
        for i,p in enumerate(st['crease'][:3]):
            y=489+i*33;self.fit(p['name'],414,y,162,10,'Semi')
            self.text(num(p['games'],0)+' projected starts' if p['games'] is not None else 'Forecast pending / depth addition',414,y+13,8,'Body',MUTED)
        relevant=sorted([n for n in self.news.get('items',[]) if t['team'] in n.get('teams',[])],key=lambda n:n['date'],reverse=True)
        if read.get('sourceUrl'):
            # The curated camp note needs its own supporting source, even if
            # an unrelated trade story has a later publication date.
            relevant=[dict(name=read['sourceName'],date=read['sourceDate'],url=read['sourceUrl'])]+relevant
        if relevant:
            n=relevant[0];self.text('NEWS TO CHECK',414,594,8,'Bold',ORANGE)
            self.block(n['name']+' / '+n['date'],414,600,162,25,8.6)
            self.para('<link href="'+escape(n['url'],{'"':'&quot;'})+'" color="#5A6C60">Read the source report</link>',414,620,162,7,9)
        self.rect(36,633,540,89,INK);self.text('ROOKIES / AVAILABILITY / CAMP WATCH',48,652,13,'Display',ORANGE)
        rookies={r.get('key'):r for r in self.data.get('rookies',[]) if r.get('key')}
        candidates=[p for p in self.result['players'] if p['team']==t['team'] and p['key'] in rookies]
        candidates=st['watch']+candidates;candidates=list({p['key']:p for p in candidates}.values())
        snippets=[read['campNote']] if read.get('campNote') else []
        for p in candidates[:2 if snippets else 3]:
            selected=p['key'] in st['startingKeys']
            unavailable=self.deployment and self.deployment['roles'].get(str(p['playerId']),{}).get('sourceListedUnavailable')
            snippets.append(p['name']+(': listed unavailable; check return status.' if unavailable else ': projected in; camp will test the fit.' if selected else ': outside this lineup projection; watch camp.'))
        if not snippets:snippets=['No separate rookie or bubble designation is supported for this page. Open slots remain open competition.']
        self.block(' '.join(snippets),48,662,514,46,9.4,CREAM)
        self.finish(t['team'],type='team',team=t['team'],keys=st['startingKeys'],issues=st['issues'],teamRead=read['body'],campNote=read.get('campNote'),campSource=read.get('sourceUrl'),deploymentSource=self.deployment['teams'][t['team']]['url'] if self.deployment else None)
    def offseason(self):
        items=self.news.get('items',[])
        for start in range(0,len(items),4):
            self.heading('Offseason moves','Offseason movers','Trades, signings and availability updates, with dated sources.')
            self.image_band(146,headline='Who moved where?',caption='Check the new combinations against each team page. Reporting does not automatically change these projections.')
            for i,item in enumerate(items[start:start+4]):
                y=253+i*116;self.line(36,y,540)
                self.fit(item['name'].upper(),36,y+23,390,23,'Display')
                self.text(item['date'],576,y+20,8,'Semi',MUTED,'right')
                self.block(item['fact'],36,y+34,540,30,10,'#10291F')
                self.block('CITRUS READ: '+item['analysis'],36,y+66,540,34,9.6)
                self.para('<link href="'+escape(item['url'],{'"':'&quot;'})+'" color="#5A6C60">Source: '+esc(item['source'])+'</link>',36,y+102,540,7,9)
            self.finish('Offseason movers',type='movers',sourceUrls=[i['url'] for i in items[start:start+4]])
    def credits(self):
        self.heading('Know your edition','Edition notes','What the numbers mean, when the reporting was checked and how to use this guide.')
        self.image_band(150,headline='Built from Citrus.',caption='Your fantasy weights change the board. The underlying hockey forecasts remain the identified Citrus edition.')
        paras=[
            ('THE NUMBERS',f'Projection snapshot: {self.as_of}. Raw category totals equal Citrus category rates multiplied by projected games or starts once. Roster probability does not apply a second reduction. Fantasy points use the weights printed in this PDF.'),
            ('THE READS',f'This edition includes {self.story_coverage["authored"]} individually researched player reads alongside all 300 rankings. A ranking does not imply a separate essay. Each story links to dated reporting; its fantasy conclusion is Citrus analysis, not a guaranteed outcome.'),
            ('HISTORICAL STATS',f'Checked against official 2025-26 NHL records: {self.historical_verification["fieldsChecked"]+self.historical_verification["categories"]["fieldsChecked"]:,} historical fields across {self.historical_verification["verifiedPlayers"]} players on this board. Checks include scoring and goalie totals, hits, blocks, power-play and shorthanded points. Missing historical seasons are not filled with zeroes. Forecasts are estimates, not verified future results.'),
            ('TEAM DEPLOYMENT',f'Editorial review: {self.deployment["asOf"] if self.deployment else self.as_of}. Individual source and check dates appear on team pages. Offseason lines are scenarios, not confirmed assignments. Listed absences may leave open spots. Editorial roles are separate from the source-hashed roster scenarios used by the matchup model; editing a team page does not change any forecast.'),
            ('PHOTOGRAPHY','McDavid: Brian Murphy / All-Pro Reels. Winter Classic: Jenn G / Jennthulhu Photos. CC BY-SA 2.0; resized/cropped for this guide. These photo adaptations retain CC BY-SA 2.0. Portrait sources link from each image; uniforms may predate moves. No endorsement implied.'),
            ('DRAFT VALUE','These rankings use your fantasy-point weights. They are not average draft position, auction prices or category-league replacement values. Use the board with your roster requirements, the dated availability notes and the players still available in your draft.')]
        y=261
        for title,body in paras:
            self.text(title,36,y,11,'Bold',ORANGE);y=self.block(body,36,y+10,540,79,10)+26
        for label,url in [('NHL 2025-26 season-review tables',self.historical_verification['sourceUrl']),('NHL category statistics','https://www.nhl.com/stats/skaters'),('McDavid photo','https://commons.wikimedia.org/wiki/File:Connor_McDavid_of_the_Edmonton_Oilers.jpg'),('Winter Classic photo','https://www.flickr.com/photos/jennthulhu_photog/53440834756/'),('CC BY-SA 2.0','https://creativecommons.org/licenses/by-sa/2.0/')]:
            self.para('<link href="'+url+'" color="#5A6C60">'+label+'</link>',36,y,540,8,10);y+=10
        self.finish('Edition notes',type='credits')
    def save(self,path):
        for name,digest in self.editorial_files.items():
            if hashlib.sha256(Path(name).read_bytes()).hexdigest()!=digest:
                raise ValueError('Editorial bundle changed during generation: '+name)
        self.c.save();doc=fitz.open(stream=self.buf.getvalue(),filetype='pdf')
        from draft_tracker import tracker_bytes, verify_forms
        payload,tracker_records=tracker_bytes(self.players,self.league,self.as_of)
        offset=len(doc)
        with fitz.open(stream=payload,filetype='pdf') as tracker:
            doc.insert_pdf(tracker,widgets=True)
        self.sections.append(('Your draft-day checklist',offset+1))
        self.bookmarks.append([1,'Your draft-day checklist',offset+1])
        self.manifest.extend(dict(r,page=r['page']+offset) for r in tracker_records)
        sources={'logo':fitz.open(ASSETS/'original-logos.pdf'),'photo':fitz.open(ASSETS/'player-photos.pdf')}
        for page,kind,index,rect in self.overlays:doc[page].show_pdf_page(fitz.Rect(rect),sources[kind],index)
        nav=Guide();nav.number=1;nav.start('Find your edge','Contents');nav.text('YOUR DRAFT PLAYBOOK.',36,104,48,'Display')
        for i,(name,page) in enumerate(self.sections):
            y=135+i*36;nav.text(f'{i+1:02}',36,y+25,29,'Display',ORANGE);nav.text(name,86,y+23,21,'Display');nav.text(str(page),576,y+24,22,'Display',INK,'right');nav.line(86,y+32,490)
        nav.photo('winter-classic.jpg',36,553,540,125,cover=True);nav.para('Drafting now? Open the checklist. Find any ranked player in the A-Z bookmarks. Click a board name for its read or team page; BOARD brings you back. Save the checklist in your PDF reader to keep your ticks.',36,692,540,10.5,13);nav.footer('Contents');nav.end();nav.c.save()
        n=fitz.open(stream=nav.buf.getvalue(),filetype='pdf');doc[1].show_pdf_page(doc[1].rect,n,0)
        for i,(_,page) in enumerate(self.sections):doc[1].insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(36,135+i*36,576,169+i*36),'page':page-1})
        self.page_images.append(dict(page=2,asset='winter-classic.jpg',subject='2024 Winter Classic arena'))
        from pdf_navigation import add_navigation, reader_bookmarks
        navigation=add_navigation(doc,self.manifest,self.players)
        doc.set_toc(reader_bookmarks(self.sections,self.manifest,self.players),collapse=1);doc.set_metadata(dict(title='Citrus Draft Kit 2026-27 | '+self.league,author='Citrus Fantasy Sports'))
        # Check the actual export too, including generated team summaries and
        # PDF overlays. Authored punctuation must be edited, not silently hidden.
        for number,page in enumerate(doc,1):
            validate_copy(page.get_text(),f'PDF page {number}')
        from photo_rights import photo_receipt
        photo_rights=photo_receipt(self.page_images,registry=json.loads((self.editorial_root/'photo-rights.json').read_text()),assets=ASSETS)
        # Recompress PDF image streams only. Source assets remain untouched.
        doc.rewrite_images(quality=88)
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);doc.save(path,garbage=4,deflate=True)
        verify_forms(path,self.players)
        manifest=dict(pages=len(doc),source=self.data['source'],canonicalRevision=self.data.get('canonicalRevision'),league=self.league,weights=self.result['weights'],scoringSha256=hashlib.sha256(json.dumps(self.result['weights'],sort_keys=True).encode()).hexdigest(),content=self.manifest,images=self.page_images,top300Keys=[p['key'] for p in self.players],lineupIssues=self.issues,featured=[p['subject'] for p in self.page_images],publicationReady=False)
        manifest['storyCoverage']=self.story_coverage
        manifest['edition']=self.data.get('edition')
        manifest['publication']=self.data.get('publication')
        manifest['editorialFilesSha256']=self.editorial_files
        manifest['historicalVerification']=self.historical_verification
        manifest['photoRights']={k:v for k,v in photo_rights.items() if k!='assets'}
        path.with_suffix('.photo-rights.json').write_text(json.dumps(photo_rights,indent=2)+'\n')
        manifest['navigation']=navigation
        if self.deployment:
            manifest['editorialDeployment']=dict(asOf=self.deployment['asOf'],sha256=self.deployment['sha256'],teamCount=len(self.deployment['teams']),changes=self.deployment['changes'],numericProjectionMutations=0)
            path.with_suffix('.deployment-audit.json').write_text(json.dumps(self.deployment,indent=2))
        path.with_suffix('.research-coverage.json').write_text(json.dumps(self.story_coverage,indent=2))
        path.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2));return manifest

def generate_customer(data,weights,name,path,evidence_path=None,news_path=None,*,source_root=None,editorial_root=ROOT):
    require_preseason_horizon(data)
    editorial_root=Path(editorial_root)
    evidence_root=Path(source_root) if source_root is not None else ROOT/'review-inputs'
    evidence_path=Path(evidence_path or evidence_root/'editorial-evidence.json')
    news_path=Path(news_path or editorial_root/'offseason-editorial.json')
    if not data.get('canonicalRevision'):raise ValueError('Select a verified canonical guide snapshot for the customer edition.')
    verify_snapshot(data,source_root=source_root)
    validate_editorial_bundles(editorial_root)
    evidence=json.loads(evidence_path.read_text());news=json.loads(news_path.read_text())
    from historical_corrections import reviewed_evidence
    evidence=reviewed_evidence(evidence)
    result=calculate(data,weights);players=top_players(result)
    if len(players)<300:raise ValueError('Fewer than 300 scorable players. Review unsupported enabled categories before exporting.')
    from player_portraits import prepare_portraits
    from draft_strategy import render_strategy, PHOTO_IDS
    note_ids={n['playerId'] for n in player_spotlights(result['players'],editorial_root)['items']}|set(PHOTO_IDS)
    prepare_portraits(list({p['key']:p for p in players+[p for p in result['players'] if str(p['playerId']) in note_ids]}.values()),evidence['directory'])
    editorial=assessments(evidence,players,weights)
    g=CustomerGuide(data,result,editorial,evidence,news,editorial_root,source_root);g.league=clean(name)
    g.cover();g.start('Contents');g.end()
    for title,fn in [('Draft strategy: five practical plays',lambda:render_strategy(g)),('Your scoring',g.settings),('Your league shortlists',g.shortlists),('The draft-day watchlist',g.watchlist),('Your top 300',g.board),('The Citrus player reads',g.profiles),('Player spotlights',g.spotlights),('All 32 team playbooks',lambda:[g.team_page(t) for t in data['teams']]),('Offseason movers',g.offseason),('Sources & edition notes',g.credits)]:
        g.sections.append((title,g.number+1));fn()
    return g.save(path)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--settings',type=Path);p.add_argument('--league',default='Citrus points league');p.add_argument('--output',type=Path,required=True);p.add_argument('--source-root',type=Path);p.add_argument('--editorial-root',type=Path,default=ROOT);a=p.parse_args()
    d=json.loads(a.data.read_text());w=json.loads(a.settings.read_text()) if a.settings else d['weights'];w=w.get('weights',w)
    m=generate_customer(d,w,a.league,a.output,source_root=a.source_root,editorial_root=a.editorial_root);print(f'Built {m["pages"]} pages; {len(m["top300Keys"])} players; {len(m["lineupIssues"])} lineup issues retained in audit.')
