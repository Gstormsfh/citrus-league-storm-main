#!/usr/bin/env python3
"""Cut carlton-figure into a base and six kit layers.

The paper doll needs the kit separable from the bear. The brief asked an
artist for seven registered PNGs; the render came back as one image, so
the seven get cut out of it here, by material rather than by rectangle.

Rectangles were tried first and they are visibly wrong: a dim rect over
the sweater draws a hard-edged block across the yoke and the jaw. The
regions below are the pieces' own silhouettes, so a dim piece reads as a
ghost of the piece and the bear behind it is untouched.

    python3 carve.py           writes art/carlton-base.webp + six layers
    python3 carve.py --sheet   also writes carve_sheet.png to look at
"""
import io, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd

SRC = 'art/carlton-figure.png'
S   = 3.0                      # image px per viewBox unit (1140/380)

im  = Image.open(SRC).convert('RGBA')
a   = np.array(im).astype(int)
A   = a[...,3]; R,G,B = a[...,0], a[...,1], a[...,2]
OP  = A > 120
H,W = A.shape
Y,X = np.mgrid[0:H, 0:W]
VAL = a[...,:3].mean(2)

def win(x0,x1,y0,y1):
    return (X>=x0)&(X<x1)&(Y>=y0)&(Y<y1)

def keep_seeded(m, seeds, minpx=300):
    """largest components that contain a seed, so a rule that also matches
       a patch of sweater somewhere does not drag it in"""
    m = nd.binary_closing(m, np.ones((9,9)))
    m = nd.binary_fill_holes(m)
    lab, n = nd.label(m)
    want = {lab[y,x] for x,y in seeds if lab[y,x]}
    out = np.isin(lab, list(want)) if want else np.zeros_like(m)
    return out

# ── the six ─────────────────────────────────────────────────────────────
M = {}

# shoulder caps: light panel, neither the warm jaw nor the navy sleeve
cap = OP & (VAL>92) & (R-B<24) & (VAL<216)
M['hit'] = keep_seeded(cap & (win(252,436,462,646) | win(624,808,456,660)),
                       [(300,540),(720,540)])

# gloves: everything on the arm's end that is not the near-black pants.
# sleeve and glove are the same navy, so the cut is the silhouette's --
# each glove is its own island until it reaches the legs.
gl = OP & (VAL>26)
M['a'] = keep_seeded(gl & (win(150,360,766,960) | win(696,912,744,940)),
                     [(250,850),(800,850)])

# leg pads: between the pants and the boots there is nothing else light.
# A neutral-grey rule looked right and left a cool bluish facet of the left
# pad behind, which then sat at full brightness inside the ghost. Value
# alone is the honest rule here -- the pants are near black.
pd = OP & (VAL>52) & (R-B<22)
M['blk'] = keep_seeded(pd & win(296,772,1008,1216), [(400,1100),(640,1100)])

# skates: below the pads there is nothing else on the left of the frame
M['tk'] = keep_seeded(OP & win(290,790,1214,H), [(400,1260),(650,1260)])

# stick: the only warm wood in the frame, in two runs -- the butt above
# the right glove and the shaft-and-blade below it
wd = OP & (R-B>34) & (R>78)
M['g'] = keep_seeded(wd & win(700,1060,700,1290), [(790,737),(830,1000),(950,1230)])

# puck: its own island, and the only one
M['sog'] = keep_seeded(OP & win(940,1120,1000,1170), [(1033,1085)])

# ── disjointness, coverage ──────────────────────────────────────────────
# a pixel belongs to exactly one piece or it dims twice. The order is by
# how certain the rule is: the wood and the puck are unmistakable, the
# boot is next, and the glove's rule is the loosest so it yields.
ids = ['hit','a','blk','tk','g','sog']
for i,k in enumerate(['g','sog','tk','blk','a','hit']):
    for j in ['g','sog','tk','blk','a','hit'][i+1:]:
        M[j] = M[j] & ~M[k]
clash = []
for i,k in enumerate(ids):
    for j in ids[i+1:]:
        o = (M[k]&M[j]).sum()
        if o: clash.append((k,j,int(o)))
print('overlapping masks:', clash if clash else 'none')

# A rule that misses one facet of a piece leaves it in the base, where it
# then sits at full brightness inside the ghost. It is invisible in a mask
# preview and obvious on the page, so look for it here instead: base that
# survives well inside a piece's filled outline.
stranded = []
for k in ids:
    solid = nd.binary_fill_holes(nd.binary_closing(M[k], np.ones((21,21))))
    inner = nd.binary_erosion(solid, np.ones((7,7)))
    left  = inner & ~M[k] & OP
    lab,n = nd.label(left)
    for i in range(1, n+1):
        c = int((lab==i).sum())
        if c < 250: continue
        ys,xs = np.where(lab==i)
        stranded.append('%s: %d px at x %d-%d y %d-%d'
                        % (k, c, xs.min(), xs.max(), ys.min(), ys.max()))
print('stranded inside a piece:', stranded if stranded else 'none')
for k in ids:
    print('  %-4s %7d px   img box x %d-%d y %d-%d'
          % (k, M[k].sum(), *[int(v) for v in
             (np.where(M[k])[1].min(), np.where(M[k])[1].max(),
              np.where(M[k])[0].min(), np.where(M[k])[0].max())]))

# ── write the layers ────────────────────────────────────────────────────
def feather(m):
    """A piece is its own hard mask plus a one-pixel soft skirt.

    Feathering BOTH sides of the cut leaves a hole: at the seam the base
    contributes half and the ghosted piece a quarter of a half, so the page
    shows through and every piece wears a dark navy outline. The base is cut
    hard and the piece overlaps it by a pixel instead -- an overlap of two
    crops of the same render is invisible when the piece is lit and closes
    the seam when it is not."""
    d = nd.binary_dilation(m, np.ones((3,3)))
    f = Image.fromarray((d*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    al = np.array(f).astype(float)/255.0
    return np.maximum(al, m.astype(float))

union = np.zeros((H,W), bool)
for k in ids: union |= M[k]

rects = {}
for k in ids:
    al = feather(M[k])
    lay = a.copy().astype(float)
    lay[...,3] = np.minimum(lay[...,3], al*255)
    ys,xs = np.where(al > 0.004)
    x0,x1,y0,y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    crop = Image.fromarray(lay[y0:y1, x0:x1].round().clip(0,255).astype(np.uint8), 'RGBA')
    crop.save('art/carlton-%s.webp'%k, 'WEBP', quality=92, method=6, exact=True)
    rects[k] = [round(x0/S,1), round(y0/S,1), round((x1-x0)/S,1), round((y1-y0)/S,1)]
    print('  wrote carlton-%s.webp  %dx%d  ->  vb %s'%(k, x1-x0, y1-y0, rects[k]))

base = a.copy().astype(float)
base[...,3] = np.minimum(base[...,3], (~union)*255.0)
Image.fromarray(base.round().clip(0,255).astype(np.uint8),'RGBA')\
     .save('art/carlton-base.webp','WEBP',quality=92,method=6,exact=True)
print('  wrote carlton-base.webp  %dx%d'%(W,H))
print()

# ── write the placement straight into app.js ────────────────────────────
# The crops are trimmed to their own alpha, so their offsets move by a
# pixel whenever a mask rule changes. Left as a number to copy across by
# hand it drifts silently and the figure goes soft at the seams, so the
# script that cuts them is the script that places them.
def fmt(v):
    return str(int(v)) if float(v) == int(v) else ('%.1f' % v)
line = ('const CARL_LAY = {\n'
        '  hit:[%s],  a:[%s],\n'
        '  blk:[%s],   tk:[%s],\n'
        '  g:[%s],   sog:[%s]\n'
        '};') % tuple(','.join(fmt(v) for v in rects[k])
                      for k in ['hit','a','blk','tk','g','sog'])
try:
    src = io.open('app.js', encoding='utf-8').read()
    i = src.index('const CARL_LAY = {'); j = src.index('};', i) + 2
    if src[i:j] == line:
        print('app.js CARL_LAY already matches')
    else:
        io.open('app.js','w',encoding='utf-8').write(src[:i] + line + src[j:])
        print('app.js CARL_LAY updated')
except (IOError, ValueError) as e:
    print('could not patch app.js (%s). Paste this in yourself:' % e)
    print(line)

if '--sheet' in sys.argv:
    NAVY=(0,32,91)
    def flat(arr):
        img=Image.fromarray(arr.round().clip(0,255).astype(np.uint8),'RGBA')
        bg=Image.new('RGBA',img.size,NAVY+(255,)); bg.alpha_composite(img); return bg.convert('RGB')
    cells=[flat(base)]
    for k in ids:
        al=feather(M[k]); lay=a.copy().astype(float); lay[...,3]=np.minimum(lay[...,3],al*255)
        cells.append(flat(lay))
    cw,ch=cells[0].size
    sh=Image.new('RGB',(cw*4+50,ch*2+30),(10,10,10))
    for i,c in enumerate(cells): sh.paste(c,((i%4)*(cw+10)+10,(i//4)*(ch+10)+10))
    sh.thumbnail((1900,1900),Image.LANCZOS); sh.save('carve_sheet.png')
    print('  wrote carve_sheet.png', sh.size)
