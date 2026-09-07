"""Freeze located NHL explanations; collection is not statistical approval."""
from pathlib import Path
import argparse
import requests
from collect_development_sog_reports import module
from run_calibration_transfer import ROOT,file_sha

SOURCES={
2022020276:'https://www.nhl.com/news/buffalo-sabres-toronto-maple-leafs-game-recap-337629748',
2022020489:'https://www.nhl.com/news/new-york-rangers-philadelphia-flyers-game-recap-338784058',
2022020650:'https://www.nhl.com/news/new-jersey-devils-carolina-hurricanes-game-recap-339528278',
2022020673:'https://www.nhl.com/news/florida-panthers-vegas-golden-knights-game-recap-339531474',
2022020714:'https://www.nhl.com/news/colorado-avalanche-calgary-flames-game-recap-339812840',
2022020779:'https://www.nhl.com/news/st-louis-blues-arizona-coyotes-game-recap-340323624',
2022020887:'https://www.nhl.com/news/columbus-blue-jackets-dallas-stars-game-recap-341017496',
2023020483:'https://www.nhl.com/news/florida-panthers-calgary-flames-game-recap-december-18',
2023020799:'https://www.nhl.com/hurricanes/news/necas-first-nhl-hat-trick-guides-canes-past-avalanche',
}


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);collector=module('collect_goal_sog_evidence');reviewer=module('review_goal_sog_evidence');rows=[]
    for gid,url in SOURCES.items():
        meta=collector.freeze_response(url,output,str(gid),requests.get)
        rows.append({'game_id':gid,'source':meta,'adjudicated':False})
        if meta['status']=='retrieved_requires_review':
            paragraphs=reviewer.paragraphs((output/meta['body_file']).read_bytes())
            matches=[{'index':i,'paragraph_sha256':reviewer.digest(p.encode()),'text':p} for i,p in enumerate(paragraphs)
                     if any(s in p.lower() for s in ('awarded','moorings','dislodg','displaced','empty-net','empty net'))]
            collector.write_new(output/f'{gid}-locators.json',matches)
            print({'game_id':gid,'status':meta['status'],'candidate_paragraphs':[{'index':m['index'],'text':m['text']} for m in matches]},flush=True)
    collector.write_new(output/'sources.json',{'sources':rows,'publishable':False,'production_changed':False,
        'code_sha256':{str(Path(__file__).relative_to(ROOT)):file_sha(Path(__file__))}})
    collector.write_new(output/'health.json',{'status':'complete-narrative-collection-not-adjudication','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
