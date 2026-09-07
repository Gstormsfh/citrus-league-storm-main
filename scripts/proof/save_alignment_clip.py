"""Save observed clear public media and original-PTS frames for local review."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse
import imageio_ffmpeg
from PIL import Image, ImageDraw


def run():
    parser=argparse.ArgumentParser()
    parser.add_argument('url');parser.add_argument('page');parser.add_argument('output',type=Path)
    args=parser.parse_args()
    parsed=urlparse(args.url)
    if parsed.scheme!='https' or parsed.hostname!='manifest.prod.boltdns.net' or '/clear/' not in parsed.path:
        raise ValueError('Expected an observed clear public NHL media URL')
    out=args.output;out.mkdir()
    (out/'media-source.json').write_text(json.dumps(dict(url=args.url,page=args.page)))
    exe=imageio_ffmpeg.get_ffmpeg_exe();video=out/'highlight.mp4'
    r=subprocess.run([exe,'-nostdin','-v','error','-n','-i',args.url,'-t','20','-map','0:v:0','-an','-c:v','copy',str(video)],capture_output=True,timeout=90)
    if r.returncode: raise RuntimeError('Public media could not be saved; no access workaround attempted')
    r=subprocess.run([exe,'-nostdin','-hide_banner','-n','-i',str(video),
        '-vf',"select='lt(t,11)*not(mod(n,30))',showinfo,scale=640:-1",'-fps_mode','vfr',str(out/'frame-%03d.png')],capture_output=True,text=True,timeout=30)
    if r.returncode: raise RuntimeError('Frame decode failed')
    pts=[float(v) for v in re.findall(r'\bn:\s*\d+.*?pts_time:([\d.]+)',r.stderr)]
    files=sorted(out.glob('frame-*.png'))
    if len(files)!=len(pts): raise ValueError('PTS/image mismatch')
    sheet=Image.new('RGB',(1280,390*((len(files)+1)//2)),'white');draw=ImageDraw.Draw(sheet)
    records=[]
    for i,(path,t) in enumerate(zip(files,pts)):
        x=i%2*640;y=i//2*390
        sheet.paste(Image.open(path).convert('RGB'),(x,y+25));draw.text((x+8,y+5),f'Original PTS {t:.6f}s',fill='black')
        records.append(dict(file=path.name,video_pts_seconds=t,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    sheet.save(out/'contact-sheet.jpg',quality=92)
    (out/'index.json').write_text(json.dumps(dict(video_sha256=hashlib.sha256(video.read_bytes()).hexdigest(),frames=records,
        source_page=args.page,video_trim_seconds=20,alignment_verified=False,production_eligible=False),indent=2))
    print(out)


if __name__=='__main__':run()
