"""Shared print primitives for the configurable Citrus draft guide."""
import io
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from PIL import Image

ROOT=Path(__file__).resolve().parent
ASSETS=ROOT/'assets'
W,H=612,792
CREAM='#F8F5EC'; INK='#10291F'; ORANGE='#FF6B1A'; MUTED='#5A6C60'; RULE='#D4DACF'; WHITE='#FFFFFF'
for name,file in [('Display','BarlowCondensed-Bold.ttf'),('Body','Barlow-Regular.ttf'),('Semi','Barlow-SemiBold.ttf'),('Bold','Barlow-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(ASSETS/file)))

class Guide:
    def __init__(self):
        self.buf=io.BytesIO();self.c=canvas.Canvas(self.buf,pagesize=(W,H));self.number=0;self.overlays=[];self.bookmarks=[];self.links=[]
        self.c.setTitle('Citrus Draft Kit 2026-27 | Premium Edition');self.c.setAuthor('Citrus Fantasy Sports')
    def rect(self,x,y,w,h,color):
        self.c.setFillColor(HexColor(color));self.c.rect(x,H-y-h,w,h,fill=1,stroke=0)
    def text(self,text,x,y,size=10,font='Body',color=INK,align='left'):
        self.c.setFillColor(HexColor(color));self.c.setFont(font,size)
        fn={'left':self.c.drawString,'right':self.c.drawRightString,'center':self.c.drawCentredString}[align]
        fn(x,H-y,text)
    def para(self,text,x,y,width,size=11,leading=None,color=INK,font='Body'):
        style=ParagraphStyle('p',fontName=font,fontSize=size,leading=leading or size*1.35,textColor=HexColor(color))
        p=Paragraph(text,style);_,h=p.wrap(width,1000);p.drawOn(self.c,x,H-y-h);return y+h
    def line(self,x,y,w,color=RULE):self.rect(x,y,w,.65,color)
    def start(self,title,section=None,dark=False):
        self.number+=1;self.rect(0,0,W,H,INK if dark else CREAM)
        self.bookmarks.append([1,title,self.number])
        if section:
            self.text('CITRUS  /  DRAFT KIT 2026-27',36,29,8,'Semi',CREAM if dark else MUTED)
            self.text(section.upper(),576,29,8,'Semi',CREAM if dark else MUTED,'right');self.line(36,40,540)
    def footer(self,section,dark=False):
        self.line(36,756,540, '#365044' if dark else RULE)
        self.text(section.upper(),36,774,7.4,'Semi',CREAM if dark else MUTED)
        self.text(f'{self.number:02}',576,776,14,'Display',ORANGE,'right')
    def end(self):self.c.showPage()
    def logo(self,x,y,width=150,light=False):
        self.overlays.append((self.number-1,'logo',1 if light else 0,(x,y,x+width,y+width*42/160)))
    def photo(self,name,x,y,w,h,cover=False):
        im=Image.open(ASSETS/name);iw,ih=im.size
        if cover:
            scale=max(w/iw,h/ih);dw,dh=iw*scale,ih*scale
            self.c.saveState();p=self.c.beginPath();p.rect(x,H-y-h,w,h);self.c.clipPath(p,stroke=0)
            self.c.drawImage(str(ASSETS/name),x+(w-dw)/2,H-y-h+(h-dh)/2,dw,dh);self.c.restoreState()
        else:self.c.drawImage(str(ASSETS/name),x,H-y-h,w,h)
