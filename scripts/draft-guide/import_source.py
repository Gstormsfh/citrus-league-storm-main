"""Capture the supplied edition without substituting live or newly calculated data."""
import argparse, hashlib, json
from pathlib import Path
import pymupdf as fitz

ROOT = Path(__file__).resolve().parent

def cropped_page(source, index, box, target):
    # Remove out-of-crop text before embedding; otherwise invisible source text
    # can leak into PDF search / copy-and-paste despite a visible clipping path.
    temp = fitz.open()
    temp.insert_pdf(source, from_page=index, to_page=index)
    p = temp[0]
    x0,y0,x1,y1 = box
    for rect in [(0,0,612,y0),(0,y1,612,792),(0,y0,x0,y1),(x1,y0,612,y1)]:
        if rect[2]>rect[0] and rect[3]>rect[1]: p.add_redact_annot(rect, fill=False)
    p.apply_redactions(images=0, graphics=0)
    page = target.new_page(width=x1-x0, height=y1-y0)
    page.show_pdf_page(page.rect, temp, 0, clip=fitz.Rect(box))
    temp.close()

def logo_page(source, index, target):
    p=source[index]; box=fitz.Rect(42,42 if index==0 else 39,202,84 if index==0 else 81)
    tmp=fitz.open(); out=tmp.new_page(width=612,height=792)
    for d in p.get_drawings():
        if not box.contains(d['rect']): continue
        shape=out.new_shape()
        for item in d['items']:
            if item[0]=='l':shape.draw_line(item[1],item[2])
            elif item[0]=='c':shape.draw_bezier(*item[1:])
            elif item[0]=='re':shape.draw_rect(item[1])
            elif item[0]=='qu':shape.draw_quad(item[1])
            else:raise ValueError(item[0])
        shape.finish(color=d['color'],fill=d['fill'],width=d['width'] or 1,
                     closePath=d['closePath'],fill_opacity=d.get('fill_opacity') or 1,
                     stroke_opacity=d.get('stroke_opacity') or 1,even_odd=d.get('even_odd',False))
        shape.commit()
    font=next(f for f in p.get_fonts() if 'Calistoga' in f[3])
    out.insert_font(fontname='CitrusOriginal',fontbuffer=source.extract_font(font[0])[3])
    for block in p.get_text('dict')['blocks']:
        for line in block.get('lines',[]):
            for span in line['spans']:
                if span['text']=='Citrus':
                    rgb=fitz.sRGB_to_pdf(span['color'])
                    out.insert_text(span['origin'],'Citrus',fontname='CitrusOriginal',fontsize=span['size'],color=rgb)
    page=target.new_page(width=160,height=42)
    page.show_pdf_page(page.rect,tmp,0,clip=box)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('pdf',type=Path);args=parser.parse_args()
    source=fitz.open(args.pdf)
    assert len(source)==17, 'This importer is for the supplied 17-page edition.'
    assets=ROOT/'assets';assets.mkdir(exist_ok=True)
    panels=fitz.open(); logos=fitz.open(); data=[]
    logo_page(source,0,logos)
    logo_page(source,1,logos)
    logos.save(assets/'original-logos.pdf',garbage=4,deflate=True)
    for i in range(2,17):
        p=source[i]; blocks=p.get_text('blocks')
        label=next(b for b in blocks if b[4].startswith('PLAYER CALL-OUT'))
        rows=[]
        for b in blocks:
            cells=b[4].strip().split('\n')
            if len(cells)==9 and (cells[0].isdigit() or cells[0]=='—') and 140<b[1]<500:
                highlighted=any(d['fill'] and d['fill'][0]>.95 and .35<d['fill'][1]<.5 and d['rect'].contains(fitz.Point(50,b[1]+6)) for d in p.get_drawings())
                rows.append({'cells':cells,'highlight':highlighted})
        assert 8<=len(rows)<=14,(i,len(rows))
        heading=blocks[0][4].strip().split('\n')
        callout_bottom=max(b[3] for b in blocks if label[1]<=b[1]<735)+7
        cropped_page(source,i,(36,label[1]-3,576,callout_bottom),panels)
        headers=next(b[4].strip().split('\n') for b in blocks if b[4].startswith('#\n'))
        if 7<=i<=10: headers=headers[:7]+['PTS / W','SOG / SV%']
        assert len(headers)==9, (i, headers)
        footer=' '.join(b[4].split('CITRUS 2026-')[0].strip().replace('\n',' ') for b in blocks if b[1]>740 and not b[4].startswith('CITRUS'))
        data.append({'source_page':i+1,'eyebrow':heading[0],'title':' '.join(heading[1:]),'metric':blocks[1][4].strip().split('\n'),'intro':blocks[2][4].strip().replace('\n',' '),'headers':headers,'rows':rows,'footer':footer,'panel_height':panels[-1].rect.height,'source_text':p.get_text()})
    panels.save(assets/'original-callouts.pdf',garbage=4,deflate=True)
    result={'source_name':args.pdf.name,'source_sha256':hashlib.sha256(args.pdf.read_bytes()).hexdigest(),'pages':data,'reading_blocks':[b[4].strip() for b in source[1].get_text('blocks')],'cover_text':source[0].get_text()}
    (ROOT/'edition.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(f'Captured {len(data)} tables / {sum(len(d["rows"]) for d in data)} rows / {len(panels)} original callouts.')

if __name__=='__main__':main()
