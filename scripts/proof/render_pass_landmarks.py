"""Preserve original video PTS for local landmark review; no inferred labels."""
import hashlib,json,re,subprocess
from pathlib import Path
import imageio_ffmpeg
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'scripts/proof/results/passing-video-review-20260907'
OUT=ROOT/'scripts/proof/results/passing-landmarks-20260907'

def run():
    OUT.mkdir()
    video=SOURCE/'highlight.mp4'
    receipt=json.loads((SOURCE/'decode-receipt.json').read_bytes())
    assert hashlib.sha256(video.read_bytes()).hexdigest()==receipt['video_sha256']
    records=[]
    for name,start,end in [('transfer',5,7),('shot',8,9.6)]:
        directory=OUT/name;directory.mkdir()
        cmd=[imageio_ffmpeg.get_ffmpeg_exe(),'-nostdin','-hide_banner','-n','-i',str(video),
             '-vf',f"select='between(t,{start},{end})*not(mod(n,4))',showinfo,scale=640:-1",
             '-fps_mode','vfr',str(directory/'frame-%03d.png')]
        r=subprocess.run(cmd,capture_output=True,text=True,timeout=30)
        if r.returncode:raise RuntimeError('Local frame decode failed')
        stamps=[float(v) for v in re.findall(r'\bn:\s*\d+.*?pts_time:([\d.]+)',r.stderr)]
        paths=sorted(directory.glob('frame-*.png'));assert len(paths)==len(stamps)
        sheet=Image.new('RGB',(640*3,390*((len(paths)+2)//3)),color='white');draw=ImageDraw.Draw(sheet)
        for i,(p,t) in enumerate(zip(paths,stamps)):
            x=i%3*640;y=i//3*390
            sheet.paste(Image.open(p).convert('RGB'),(x,y+25))
            draw.text((x+8,y+5),f'Original decoded video PTS {t:.6f}s',fill='black')
            records.append({'file':str(p.relative_to(OUT)),'video_pts_seconds':t,
                            'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        sheet.save(OUT/f'{name}-sheet.jpg',quality=92)
    with (OUT/'index.json').open('x') as f:json.dump({'video_sha256':receipt['video_sha256'],
        'frames':records,'timing':'Original decoded PTS, selected every fourth source frame; no fps-grid relabeling'},f)
    print({'selected_frames':len(records)})

if __name__=='__main__':run()
