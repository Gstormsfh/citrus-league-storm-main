"""Decode the already observed public NHL highlight for offline visual review."""
import hashlib,json,subprocess
from pathlib import Path
import imageio_ffmpeg
from PIL import Image,ImageDraw

OUT=Path(__file__).resolve().parents[2]/'scripts/proof/results/passing-video-review-20260907'

def run():
    source=json.loads((OUT/'media-source.json').read_bytes())
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    video=OUT/'highlight.mp4'
    result=subprocess.run([ffmpeg,'-nostdin','-v','error','-n','-i',source['url'],
        '-t','38','-map','0:v:0','-an','-c:v','copy',str(video)],capture_output=True,timeout=90)
    if result.returncode:raise RuntimeError('Public video decode failed; no access workaround attempted')
    result=subprocess.run([ffmpeg,'-nostdin','-v','error','-n','-i',str(video),
        '-t','10','-vf','fps=2,scale=480:-1',str(OUT/'frame-%03d.png')],capture_output=True,timeout=30)
    if result.returncode:raise RuntimeError('Frame extraction failed')
    files=sorted(OUT.glob('frame-*.png'))
    sheet=Image.new('RGB',(480*4,300*((len(files)+3)//4)),color='white')
    draw=ImageDraw.Draw(sheet)
    for i,p in enumerate(files):
        im=Image.open(p).convert('RGB');x=(i%4)*480;y=(i//4)*300
        sheet.paste(im,(x,y+25));draw.text((x+8,y+5),f'Video sample {i/2:.1f}s',fill='black')
    sheet.save(OUT/'contact-sheet.jpg',quality=90)
    (OUT/'decode-receipt.json').write_text(json.dumps({'source_page':source['page'],
        'video_sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'sample_fps':2,
        'sample_times_are_ffmpeg_output_grid_not_verified_frame_alignment':True,
        'purpose':'Visual review only; no training labels automatically generated'}))
    print({'images':len(files),'contact_sheet':str(OUT/'contact-sheet.jpg')})

if __name__=='__main__':run()
