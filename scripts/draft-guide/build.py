"""Generate a complete league-specific guide from the authoritative workbook snapshot."""
import argparse,json,hashlib
from pathlib import Path
from xml.sax.saxutils import escape
import pymupdf as fitz
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from layout import Guide,ROOT,ASSETS,INK,CREAM,ORANGE,MUTED,WHITE,RULE,pdfmetrics
from scoring import calculate

LABELS={'goals':'Goals','assists':'Assists','power_play_points':'Power-play points','short_handed_points':'Short-handed points','shots_on_goal':'Shots on goal','blocks':'Blocks','hits':'Hits','penalty_minutes':'Penalty minutes','wins':'Wins','saves':'Saves','shutouts':'Shutouts','goals_against':'Goals against'}
def fmt(v,d=1):return '-' if v is None else f'{v:,.{d}f}'
def safe(s):return escape(str(s or '')).replace('\n','<br/>')

class LeagueGuide(Guide):
 def __init__(self,data,result,name):
  super().__init__();self.data=data;self.result=result;self.name=name;self.byname={p['name']:p for p in result['players']};self.bykey={p['key']:p for p in result['players']};self.photos=json.loads((ASSETS/'player-photos.json').read_text());self.featured=set();self.manifest=[]
 def end(self):
  if self.data.get('canonicalRevision'):
   self.text('DRAFT / CANONICAL '+self.data['canonicalRevision'][:16]+' / LOCAL SCORING PREVIEW',306,749,6,'Semi',ORANGE,'center')
  super().end()
 def heading(self,title,section,sub=''):
  self.start(title,section);size=min(49,540/pdfmetrics.stringWidth(title.upper(),'Display',1));self.text(title.upper(),36,107,size,'Display')
  if sub:self.para(safe(sub),36,128,540,9.5,12.5,MUTED)
 def table(self,headers,rows,y,widths=None,size=9,row_height=18,featured=None,keys=None):
  widths=widths or [28,157,35,40,36,46,54,58,42,44];assert sum(widths)==540
  self.rect(36,y,540,24,INK);x=36
  for j,(label,w) in enumerate(zip(headers,widths)):
   self.text(label,x+5 if j==1 else x+w-5,y+15,7.1,'Semi',CREAM,'left' if j==1 else 'right');x+=w
  y+=24
  for index,row in enumerate(rows):
   hi=keys is not None and keys[index]==featured
   self.rect(36,y,540,row_height,ORANGE if hi else WHITE if index%2==0 else '#EFEEE5');x=36
   for j,(value,w) in enumerate(zip(row,widths)):
    value=str(value);font='Bold' if hi or j==1 else 'Body';sz=min(size,(w-10)/max(pdfmetrics.stringWidth(value,font,1),1))
    self.text(value,x+5 if j==1 else x+w-5,y+row_height*.70,sz,font,INK if hi or j in [1,6] else MUTED,'left' if j==1 else 'right');x+=w
   self.line(36,y+row_height,540);y+=row_height
  return y
 def card(self,p,y=541):
  assert p['name'] not in self.featured;pname=p['name'];self.featured.add(pname)
  self.rect(36,y,540,199,INK);self.rect(36,y,540,3,ORANGE)
  self.overlays.append((self.number-1,'photo',self.photos[pname],(36,y+4,183,y+156)))
  self.rect(36,y+156,147,43,INK)
  self.text(pname.upper(),45,y+182,min(18,130/pdfmetrics.stringWidth(pname.upper(),'Display',1)),'Display',CREAM)
  self.text('PLAYER CALL-OUT / '+str(p['source']),198,y+22,8,'Bold',ORANGE)
  self.text(f'{p["team"]} / {p["position"]}{p["positionRank"]}',564,y+22,8,'Semi',CREAM,'right')
  for x,label,value in [(198,'FPTS',fmt(p['fantasyPoints'])),(313,'FP/START' if p['isGoalie'] else 'FP/GP',fmt(p['pointsPerGame'],2)),(422,'STARTS' if p['isGoalie'] else 'GP USED',fmt(p['games'],0))]:
   self.text(label,x,y+44,7,'Semi',CREAM);self.text(value,x,y+68,24,'Display',ORANGE)
  contrib=sorted(p['contributions'],key=lambda q:abs(q['points']),reverse=True);scale=max([abs(c['points']) for c in contrib]+[1]);bar_y=y+86
  for c in contrib:
   self.text(LABELS[c['key']].upper(),198,bar_y+8,6.5,'Semi',CREAM)
   self.rect(318,bar_y,185,6,'#294237');self.rect(318,bar_y,185*abs(c['points'])/scale,6,ORANGE if c['points']>=0 else '#E3AEB8')
   self.text(fmt(c['points']),563,bar_y+8,8,'Semi',CREAM,'right');bar_y+=12
  self.text('CATEGORY POINTS RECALCULATED FOR YOUR LEAGUE',198,y+188,6.2,'Semi',CREAM)
 def board(self,players,title,section,allow_features=False,goalie=False):
  start=0
  while start<len(players):
   candidate=next((p for p in players[start:start+16] if p['name'] in self.photos and p['name'] not in self.featured),None) if allow_features else None
   chunk=players[start:start+(16 if candidate else 29)]
   self.heading(title,section,f'{self.name} / {start+1}-{start+len(chunk)} of {len(players)} / Rankings use your selected league weights.')
   rows=[]
   for p in chunk:
    s={key:(value/p['baseGames']*p['games'] if p['baseGames'] else 0) for key,value in p['stats'].items()};rows.append([str(p['rank']),p['name'],p['team'],p['position']+str(p['positionRank']),fmt(p['games'],0),fmt(p['pointsPerGame'],2),fmt(p['fantasyPoints']),fmt(s.get('wins') if goalie else s.get('goals',0)+s.get('assists',0)),fmt(s.get('saves') if goalie else s.get('shots_on_goal'),0),fmt(s.get('goals_against') if goalie else s.get('blocks'),0),p['source'] or '-'])
   self.table(['#','PLAYER','TEAM','POS','ST' if goalie else 'GP','FP/ST' if goalie else 'FP/GP','FPTS','W' if goalie else 'PTS','SV' if goalie else 'SOG','GA' if goalie else 'BLK','SOURCE'],rows,172,[24,139,28,37,31,43,51,49,39,39,60],row_height=18,featured=candidate['key'] if candidate else None,keys=[p['key'] for p in chunk])
   if candidate:self.card(candidate)
   else:self.para('Category totals reflect projected GP or starts: source categories / source games × projected games. SOURCE records projection provenance. Raw rates and volume stay separate; ties share rank.',36,730,540,8,10,MUTED)
   self.manifest.append({'page':self.number,'type':'ranking','keys':[p['key'] for p in chunk],'featured':candidate['key'] if candidate else None,'title':title})
   self.footer(section);self.end();start+=len(chunk)
 def notes(self,title,section,paragraphs):
  style=ParagraphStyle('measure',fontName='Body',fontSize=10.5,leading=14)
  items=[str(text) for text in paragraphs if text];blocks=[];i=0
  while i<len(items):
   texts=[items[i]];i+=1
   if texts[0]=='SPECIAL TEAMS':
    while i<len(items) and items[i].startswith(('PP1','PP2','PK1','PK2')):texts.append(items[i]);i+=1
   elif len(texts[0])<65 and texts[0].isupper() and i<len(items):
    texts.append(items[i]);i+=1
   height=sum(Paragraph(safe(text),style).wrap(540,10000)[1]+17 for text in texts)
   if height>591:raise ValueError(f'Paragraph group too long for a page: {title}')
   blocks.append((texts,height))
  pages=[];page=[];used=0
  for block in blocks:
   if page and used+block[1]>591:pages.append(page);page=[];used=0
   page.append(block);used+=block[1]
  if page:pages.append(page)
  # Move whole paragraphs to avoid a final page containing only a short fragment.
  if len(pages)>1:
   while sum(b[1] for b in pages[-1])<200 and len(pages[-2])>1:
    candidate=pages[-2][-1]
    if sum(b[1] for b in pages[-2])-candidate[1]<200 or sum(b[1] for b in pages[-1])+candidate[1]>591:break
    pages[-1].insert(0,pages[-2].pop())
  for page in pages:
   self.heading(title,section);y=144
   for texts,_ in page:
    for text in texts:y=self.para(safe(text),36,y,540,10.5,14)+17
   self.footer(section);self.end()
 def rookie_profiles(self):
  rookies=self.data['rookies'];y=0;tier=None
  for r in rookies:
   p=(self.bykey.get(r.get('key')) if self.data.get('canonicalRevision') else self.byname.get(r['name'])) or {'key':'rookie:'+str(r['sourceRow']),'rank':None,'isGoalie':r['position']=='G','fantasyPoints':None,'rosterProbability':None,'adjustedPoints':None}
   h=Paragraph(safe(r['support']),ParagraphStyle('m',fontName='Body',fontSize=10.5,leading=14)).wrap(512,10000)[1]+99
   if not y or y+h>731 or r['tier']!=tier:
    if y:self.footer('Rookies');self.end()
    tier=r['tier'];self.heading(tier.split('  -')[0],'Rookies',tier.split('  -')[-1] if '  -' in tier else '');y=176
   self.rect(36,y,540,h,WHITE);self.rect(36,y,3,h,ORANGE)
   self.text(r['name'].upper(),50,y+26,25,'Display');self.text(f'{r["team"]} / {r["position"]}',561,y+24,10,'Semi',MUTED,'right')
   values=f'#{p["rank"]} {"goalie" if p["isGoalie"] else "skater"}  /  {fmt(p["fantasyPoints"])} FPTS  /  Roster {fmt(p["rosterProbability"]*100,0)+"%" if p["rosterProbability"] is not None else "not supplied"}  /  Adj FPTS {fmt(p["adjustedPoints"])}'
   if p['rank'] is None: values='Projection not supplied in the main board / Ranking and FPTS unavailable'
   self.text(values,50,y+47,9,'Semi');self.text(f'NHL GP {r["nhlGames"]}  /  Draft {r["draft"]}',50,y+64,9,'Body',MUTED)
   self.para(safe(r['support']),50,y+75,512,10.5,14);y+=h+15
   self.manifest.append({'page':self.number,'type':'rookie','key':p['key']})
  if y:self.footer('Rookies');self.end()
 def team(self,t):
  roster=[];notes=[]
  for r in t['rawRows'][3:]:
   if len(r)>2 and r[1] in ['C','LW','RW','D','LD','RD','G']:
    p=self.byname.get(r[2]) or {'key':'missing:'+str(r[2]),'name':r[2],'position':r[1],'rank':'-','isGoalie':r[1]=='G','games':None,'fantasyPoints':None,'source':'MISSING','line':None,'powerPlay':None};roster.append((str(r[0] or ''),dict(p,slotPosition=r[1])))
    if len(r)>17 and r[17]:notes.append(str(r[2])+': '+str(r[17]))
   elif r[0] and str(r[0]) not in ['Line','Pair','Depth','Status','Player','FORWARD LINES','DEFENCE PAIRS','WATCH ITEMS'] and not str(r[0]).startswith(('INJURED / UNAVAILABLE','CREASE   ','Goalie rows show')):
    cells=[str(v) for v in r[:3] if v is not None]
    if cells:notes.append(' / '.join(cells))
  if self.data.get('canonicalRevision'):
   roster=[]
   for slot in t['lineupSlots']:
    p=self.bykey.get(slot.get('key')) or {'key':'missing:'+str(slot.get('imported_name')),'name':slot['name'],'position':slot['position'],'rank':None,'isGoalie':slot['position']=='G','games':None,'fantasyPoints':None,'source':'UNRESOLVED','line':None,'powerPlay':None}
    roster.append((slot.get('slot') or '',dict(p,slotPosition=slot['position'])))
   notes.extend(n['text'] for n in t['canonicalNotes'] if n.get('text') and not n.get('row'))
   if t.get('specialTeams'):
    notes.append('CANONICAL SPECIAL TEAMS / REVIEW STATUS')
    notes.extend(f"{unit.get('unit','Unit')}: {unit.get('imported_text') or 'unresolved'} / {unit.get('snapshot_status','unknown')}" for unit in t['specialTeams'])
   notes.append('AVAILABILITY / DATED SOURCE SCENARIOS')
   notes.append('Unknown availability is not a healthy designation. Forecast coverage and availability are separate. No extra absence multiplier is applied.')
   for p in self.result['players']:
    a=p.get('availability',{})
    if p['team']==t['team'] and a.get('status','unknown')!='unknown':notes.append(f"{p['name']}: {a['status']} / {a.get('authority','unknown')} / as of {a.get('as_of') or 'unknown'}. {a.get('reason') or ''} Source: {a.get('source') or 'not supplied'}")
  for start in range(0,len(roster),29):
   chunk=roster[start:start+29];self.heading(t['title'],'Team guide',str(t['intro']))
   rows=[[slot,p['name'],p.get('slotPosition',p['position']),('-' if p['rank'] is None else str(p['rank']))+(' G' if p['isGoalie'] else ''),fmt(p['games'],0),fmt(p['fantasyPoints']),p['source'] or '-',p['line'] or '-',p['powerPlay'] or '-'] for slot,p in chunk]
   self.table(['SLOT','PLAYER','POS','#','GP/ST','FPTS','SOURCE','LINE','PP'],rows,186,[51,161,31,37,35,63,62,50,50],size=9,row_height=17)
   self.para(('Ranks and fantasy points follow the selected scoring settings. G marks a goalie rank. Lineup assignments and notes retain canonical review status.' if self.data.get('canonicalRevision') else 'Ranks and fantasy points follow your scoring settings. G marks a goalie rank. Source lineup assignments and commentary remain the workbook author’s projections.'),36,718,540,8.5,11,MUTED)
   self.manifest.append({'page':self.number,'type':'team','team':t['team'],'keys':[p['key'] for _,p in chunk]});self.footer(t['team']);self.end()
  self.notes(t['team']+' / Team notes','Team guide',notes)
 def cover_new(self):
  self.start('Cover',dark=True);self.logo(36,28,176);self.text('2026-27',576,60,23,'Display',ORANGE,'right')
  self.text('YOUR LEAGUE. YOUR BOARD.',36,121,13,'Semi',ORANGE);self.text('DRAFT KIT',32,213,108,'Display',CREAM)
  self.photo('mcdavid.jpg',0,236,612,408);self.rect(36,621,270,31,ORANGE);self.text(self.name[:48],47,641,11,'Bold')
  self.text('CANONICAL SOURCE / REVIEW DRAFT' if self.data.get('canonicalRevision') else 'THE COMPLETE WORKBOOK EDITION',36,686,20,'Display',CREAM)
  count=len([p for p in self.data['players'] if not p['isGoalie']]);goalies=len(self.data['players'])-count
  self.para(f'{count} skaters / {goalies} goalies / 32 team guides / The rookie class',36,705,540,12,16,CREAM)
  self.text('CITRUSFANTASYSPORTS.COM',36,764,8,'Semi',CREAM);self.end()
 def settings(self):
  self.heading('YOUR LEAGUE SETTINGS','Scoring',self.name)
  y=171
  for group in ['skater','goalie']:
   self.text(group.upper(),36,y,20,'Display');y+=14
   for key,value in self.result['weights'][group].items():
    self.line(36,y+20,540);self.text(LABELS[key],36,y+15,10.5);self.text(str(value),576,y+15,11,'Bold',INK,'right');y+=24
   y+=30
  self.para('Points leagues: FPTS = weighted model categories / model games × GP Used (skaters) or projected starts (goalies). Raw hockey projections do not change when you change fantasy weights. Fantasy totals, ranks, position ranks, rookie FPTS and category contributions do.',36,612,540,10.5,14)
  self.para(('Canonical rates are scored using the explicit league weights above. Roster probability is metadata; adjusted fantasy points are not calculated. Plus/minus is not scored by this guide. ' if self.data.get('canonicalRevision') else '')+('This PDF records the selected scoring settings at generation time. Lineups and editorial rookie tiers retain their source meaning.' if self.data.get('canonicalRevision') else 'Open the Citrus guide configurator, change the weights and choose Generate PDF. This PDF records those settings at generation time. Plus/minus is unavailable because the supplied projections do not contain it. Tiers, roster probabilities, lineups and editorial rookie tiers retain their source meaning.'),36,679,540,10,13)
  self.footer('Scoring');self.end()
 def colophon(self):
  if self.data.get('canonicalRevision'):
   self.notes('CANONICAL REVISION','Source review',[
    'DRAFT — LOCAL SCORING PREVIEW. Canonical revision: '+self.data['canonicalRevision'],
    'Per-game or per-start rates are multiplied by exposure exactly once. Roster probability and availability labels are metadata; neither applies another absence multiplier. Unallocated and unresolved forecasts have no fantasy score or rank.',
    'Availability is separate from forecast coverage. Unknown availability does not mean healthy. Team roles remain scenarios unless explicitly reviewed. Publication and application require the canonical owner workflow; exporting this guide does not activate a run.',
    'This artifact includes every canonical player. Workbook editorial rookie material is retained as separately sourced commentary. Source evidence and complete availability records remain in the canonical JSON and its review interface.'
   ])
  self.notes('EDITION & PHOTOGRAPHY','Credits',[
   (f'Canonical input: {self.data["source"]["name"]}. All canonical players and teams are included. Rates and exposure come only from this revision; editorial rookie commentary retains its separate workbook source. Revision: {self.data["canonicalRevision"]}.' if self.data.get('canonicalRevision') else f'Authoritative source: {self.data["source"]["name"]}. This edition imports every Draft Board and Goalies row, all 32 team tabs, the rookie profiles and rookie commentary. Fantasy scores are regenerated using the selected settings and the workbook’s games-scaling formulas. Source SHA-256: {self.data["source"]["sha256"]}.'),
   'Orange rows identify the single player featured directly below that table. Each original player photo is featured only once in the guide. All panel statistics and category bars are recalculated. Unhighlighted tables have no callout.',
   ('Canonical provenance is retained for every player. Unreviewed roles, unavailable forecasts and publication blockers remain explicit in the canonical source. This local review draft is not an activated production projection run.' if self.data.get('canonicalRevision') else 'The workbook contains MODEL, MANUAL and DEFAULT projections. DEFAULT marks a supplied rookie cohort prior, not an individual player forecast; its games already include cohort availability assumptions. Team assignments, player notes, rookie eligibility and source tiers are supplied editorial data, not newly verified facts. The original PDF and workbook disagree in coverage and some totals; this edition uses the workbook. Internal ADP/value columns are omitted because the workbook labels them INTERNAL.'),
   'Cover: Connor McDavid, Edmonton at Washington, 2 February 2022. Brian Murphy / All-Pro Reels. Source: https://commons.wikimedia.org/wiki/File:Connor_McDavid_of_the_Edmonton_Oilers.jpg',
   'Contents: Vegas at Seattle, 2024 Winter Classic. Jenn G / Jennthulhu Photos. Source: https://www.flickr.com/photos/jennthulhu_photog/53440834756/',
   'Both added action photos: CC BY-SA 2.0, https://creativecommons.org/licenses/by-sa/2.0/. Cover resized; contents photograph resized and cropped. Photographic adaptations are offered under the same license. No endorsement is implied.',
   'Player photographs and team/Citrus logos are retained from the supplied original PDF. Their underlying commercial permissions were not supplied; confirm those rights before selling the guide. Original photographic labels have been replaced by current league-specific labels.',
   'Typography: Barlow and Barlow Condensed, SIL Open Font License. Citrus lettering and original brand vectors are retained.'
  ])
 def save_new(self,path,sections):
  self.c.save();doc=fitz.open(stream=self.buf.getvalue(),filetype='pdf');assets={'logo':fitz.open(ASSETS/'original-logos.pdf'),'photo':fitz.open(ASSETS/'player-photos.pdf')}
  for page,kind,index,rect in self.overlays:doc[page].show_pdf_page(fitz.Rect(rect),assets[kind],index)
  # Replace reserved contents page with a freshly rendered navigation page.
  nav=Guide();nav.start('Contents','The complete guide');nav.text('EVERY ANGLE.',36,110,57,'Display');y=156
  for i,(title,pg) in enumerate(sections):
   nav.text(f'{i+1:02}',36,y+24,26,'Display',ORANGE);nav.text(title.upper(),81,y+21,20,'Display');nav.text(str(pg),576,y+22,20,'Display',INK,'right');nav.line(81,y+39,495);y+=53
   doc[1].insert_link({'kind':fitz.LINK_GOTO,'from':fitz.Rect(36,y-53,576,y-7),'page':pg-1})
  nav.photo('winter-classic.jpg',36,600,260,137,cover=True);nav.para('Configure your league, regenerate your rankings and take the whole board to draft night. Orange always points to the featured player on the same page.',319,618,245,11,15);nav.end();nav.c.save();n=fitz.open(stream=nav.buf.getvalue(),filetype='pdf');doc[1].show_pdf_page(doc[1].rect,n,0)
  doc.set_toc(self.bookmarks);doc.set_metadata({'title':f'Citrus Draft Kit 2026-27 — {self.name}','author':'Citrus Fantasy Sports'})
  if self.data.get('canonicalRevision'):
   for page in doc:
    if page.number==1 or 'DRAFT / CANONICAL' not in page.get_text():page.insert_text((185,749),'DRAFT / CANONICAL '+self.data['canonicalRevision'][:16]+' / LOCAL SCORING PREVIEW',fontsize=6,color=(1,.42,.1))
  path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);doc.save(path,garbage=4,deflate=True)
  scoring_revision=hashlib.sha256(json.dumps(self.result['weights'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
  manifest={'scoringIdentity':{'label':self.name,'weightsSha256':scoring_revision,'kind':'explicit_local_preview'},'canonicalRevision':self.data.get('canonicalRevision'),'publication':self.data.get('publication'),'pages':len(doc),'source':self.data['source'],'weights':self.result['weights'],'league':self.name,'featured':sorted(self.featured),'content':self.manifest,'sections':sections}
  path.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2));return manifest

def generate(data,weights,name,path):
 result=calculate(data,weights);g=LeagueGuide(data,result,name);g.cover_new();g.start('Contents');g.end();sections=[('League settings',3)];g.settings()
 sk=[p for p in result['players'] if not p['isGoalie'] and p['rank'] is not None];go=[p for p in result['players'] if p['isGoalie'] and p['rank'] is not None]
 sections.append(('Complete skater board',g.number+1));g.board(sk,'THE SKATER BOARD','Overall rankings',True)
 sections.append(('Complete goalie board',g.number+1));g.board(go,'GOALTENDERS','Goalie rankings',True,True)
 sections.append(('Position boards',g.number+1))
 for pos,title in [('C','CENTRES'),('LW','LEFT WINGS'),('RW','RIGHT WINGS'),('D','DEFENCE')]:g.board([p for p in sk if p['position']==pos],title,'Position rankings',True)
 unavailable=[p for p in result['players'] if p['rank'] is None]
 if unavailable:
  g.notes('FORECASTS TO REVIEW','Coverage',[f"{p['name']} / {p['team']} / {p['position']} — {p.get('forecastStatus','unavailable')}. Exposure: {fmt(p['games'])}. FPTS and rank unavailable. Availability: {p.get('availability',{}).get('status','unknown')}." for p in unavailable])
 sections.append(('The rookie class',g.number+1));intro=[' '.join(r['cells']) for r in data['rookieNarrative'] if r['row']<=8];g.notes('THE ROOKIE CLASS','Rookies',intro);g.rookie_profiles();g.notes('ROOKIE FIELD NOTES','Rookies',[' '.join(r['cells']) for r in data['rookieNarrative'] if r['row']>=46])
 sections.append(('All 32 team guides',g.number+1))
 for t in data['teams']:g.team(t)
 remaining=[p for p in result['players'] if p['rank'] is not None and p['name'] in g.photos and p['name'] not in g.featured]
 for p in remaining:
  g.heading(p['name'],'Player focus',name+' / A closer look at the categories behind the ranking.')
  rows=[[str(p['rank']),p['name'],p['team'],p['position']+str(p['positionRank']),fmt(p['games'],0),fmt(p['pointsPerGame'],2),fmt(p['fantasyPoints']),p['source'] or '-']]
  g.table(['#','PLAYER','TEAM','POS','GP','FP/GP','FPTS','SOURCE'],rows,178,[28,180,40,47,45,55,70,75],featured=p['key'],keys=[p['key']])
  g.card(p,298)
  g.para(safe(p['note'] or 'The fantasy-point breakdown uses the selected league weights, the source model or manual category rates, and the workbook games projection. Underlying hockey rates and availability are kept separate.'),36,522,540,11,15)
  g.manifest.append({'page':g.number,'type':'focus','keys':[p['key']],'featured':p['key']});g.footer('Player focus');g.end()
 sections.append(('Credits & edition notes',g.number+1));g.colophon();return g.save_new(path,sections)

def main():
 p=argparse.ArgumentParser();p.add_argument('--data',type=Path,default=ROOT/'workbook-data.json');p.add_argument('--settings',type=Path);p.add_argument('--league');p.add_argument('--output',type=Path);a=p.parse_args();data=json.loads(a.data.read_text());settings=json.loads(a.settings.read_text()) if a.settings else {};weights=settings.get('weights',settings) if settings else data['weights'];name=a.league or settings.get('league','Citrus default scoring');output=a.output or ROOT.parent.parent/'output/pdf'/('Citrus-Canonical-Review-DRAFT.pdf' if data.get('canonicalRevision') else 'Citrus-Draft-Kit-2026-27-Complete.pdf');m=generate(data,weights,name,output);print(f'Built {m["pages"]} pages / {len(m["featured"])} unique callouts: {output}')
if __name__=='__main__':main()
