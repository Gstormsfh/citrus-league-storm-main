#!/usr/bin/env python3
"""
Drop renders into art/ and run this. Nothing else.

    python3 bake_art.py && python3 build.py

Every file below is optional. A key with no file on disk is simply not
written, and the build falls back to what it draws today — so a partial
delivery is a partial upgrade and never a broken page.

The block this writes is delimited, so running it again replaces the block
rather than stacking a second copy.
"""
import base64, io, os, sys, re


# every path below is relative to this file, not to wherever you ran it
import os as _os, sys as _sys
_os.chdir(_os.path.dirname(_os.path.abspath(__file__)))

ART_DIR = 'art'
JS      = 'app.js'

# Where to look for a file, in order. The demo keeps its own art/ directory,
# but the renders actually live in the app's public folder under a -tor
# suffix, and the README's "copy them into demo/src/art/ first" was a manual
# step that nobody was ever going to remember. Look in both, and try the
# suffix, so the copy step is not load-bearing.
ART_DIRS = [
    ART_DIR,
    os.path.join('..', '..', 'apps', 'web', 'public', 'mascots'),   # from demo/src
    os.path.join('apps', 'web', 'public', 'mascots'),               # from repo root
]


def find_art(fname):
    """art/eq-stick.webp, else .../mascots/eq-stick.webp, else -tor.

    A key may name more than one acceptable file: the club crest arrives as
    an SVG about as often as a PNG, and there is no reason to make somebody
    rasterise it first when the page inlines either one just as happily."""
    names = (fname,) if isinstance(fname, str) else tuple(fname)
    for want in names:
        stem, ext = os.path.splitext(want)
        for d in ART_DIRS:
            for cand in (want, stem + '-tor' + ext):
                path = os.path.join(d, cand)
                if os.path.exists(path):
                    return path
    return None


def baked_keys(src):
    """The keys currently inlined, so this script can refuse to lose them."""
    if BEGIN not in src or END not in src:
        return set()
    blk = src[src.index(BEGIN):src.index(END)]
    return set(re.findall(r"[\n{,]\s*([A-Za-z0-9_]+)\s*:\s*\{src:", blk))
BEGIN   = '/* ==== BAKED ART: written by bake_art.py, do not edit by hand ==== */'
END     = '/* ==== END BAKED ART ==== */'

# key in the build            filename that has to appear in art/
FILES = {
    # --- the club crest. Drop the real asset in as art/crest.png (or .svg
    #     converted to png) and it replaces every drawn leaf in the build. ---
    'crest':         ('crest.png', 'crest.svg'),
    # --- CITRUS CARLTON, the paper doll on Game 01. Seven transparent
    #     layers on ONE canvas so they stack: the bear in his sweater,
    #     then one layer per piece of kit. All seven or none, because a
    #     rendered bear wearing six drawn pieces would be worse than the
    #     vector he replaces. See CARLTON-BRIEF.md.
    #
    #     The seven are CUT, not drawn: carlton-figure.png is one render of
    #     the dressed bear, and carve.py separates it by material. Rectangles
    #     over the render were tried first and a dim rectangle draws a hard
    #     block across the yoke and the jaw -- the piece has to be its own
    #     silhouette or the ghost state is unusable. Re-run carve.py after
    #     any new figure lands; do not hand-edit these seven. ---
    'carl_base':     'carlton-base.webp',
    'carl_hit':      'carlton-hit.webp',
    'carl_a':        'carlton-a.webp',
    'carl_blk':      'carlton-blk.webp',
    'carl_tk':       'carlton-tk.webp',
    'carl_g':        'carlton-g.webp',
    'carl_sog':      'carlton-sog.webp',
    # --- the kit: six props, Game 01. Highest impact, do these first. ---
    'eq_g':          'eq-stick.webp',
    'eq_a':          'eq-gloves.webp',
    'eq_sog':        'eq-puck.webp',
    'eq_hit':        'eq-shoulders.webp',
    'eq_blk':        'eq-shins.webp',
    'eq_tk':         'eq-skate.webp',
    # --- The five character cut-outs are NOT baked any more. The page
    #     headers they sat in were replaced by the club mark, so they were
    #     0.57 MB of a 4 MB file that nothing pointed at, on a build whose
    #     whole point is opening at a rink with the wifi off. The renders are
    #     still in apps/web/public/mascots/; put these five lines back and
    #     they return.
    # 'cut_ult':       'mascot-lemon-tor-cut.webp',
    # 'cut_lemon':     'mascot-lemon-tor-cut.webp',
    # 'cut_kiwi':      'mascot-kiwi-tor-cut.webp',
    # 'cut_pineapple': 'mascot-pineapple-tor-cut.webp',
    # 'cut_stormy':    'mascot-stormy-tor-cut.webp',
    # --- ONE render per page: character already in the scene, lit by it.
    #     Supersedes the band + cut-out pair entirely wherever it lands. ---
    'hero_ult':      'hero-locker.webp',
    'hero_stormy':   'hero-bench.webp',
    'hero_hl':       'hero-clock.webp',
    'hero_guess':    'hero-tunnel.webp',
    'hero_luck':     'hero-ice.webp',
    'hero_rank':     'hero-podium.webp',
    'hero_fx':       'hero-card.webp',
    'hero_bz':       'hero-crease.webp',
    'hero_grid':     'hero-grid.webp',
    'hero_lb':       'hero-board.webp',
    # --- THE TEN PAGE BANDS ARE GONE. They were still being inlined, 1.18 MB
    #     of a 3.7 MB file, and nothing rendered them: the .ghero elements
    #     they attached to were removed when the page headers were rebuilt.
    #     Measured in the running build -- 0 band images on the page, 0
    #     .ghero, 0 [data-art]. Put these back only alongside something that
    #     actually draws them.
    #
    # --- the four characters, where they have a job ---
    #     Stormy is the AI GM you play in Game 02, so his face belongs on his
    #     own lineup card and on the card that tells you who won. The other
    #     three carry the locker room list, where twelve identical club marks
    #     told a fan nothing about which game was which.
    'cut_stormy':    'mascot-stormy-tor-cut.webp',
    'cut_lemon':     'mascot-lemon-tor-cut.webp',
    'cut_kiwi':      'mascot-kiwi-tor-cut.webp',
    'cut_pineapple': 'mascot-pineapple-tor-cut.webp',
    #     Stormy reacting. -win is Stormy winning, so it shows when he beats
    #     you; -loss shows when you beat him. Named from his side, not yours.
    #     MUST be the -cut files: mascot-stormy-tor-win.webp is RGB with a
    #     solid dark-green plate baked in, and it rendered as a green box
    #     sitting on the navy card. Only the -cut variants carry alpha.
    'stormy_win':    'mascot-stormy-tor-win-cut.webp',
    'stormy_loss':   'mascot-stormy-tor-loss-cut.webp',
    # --- leaderboard hardware ---
    'badge_1':       'badge-first.webp',
    'badge_2':       'badge-second.webp',
    'badge_3':       'badge-third.webp',
    'badge_perfect': 'badge-perfect.webp',
    'badge_streak':  'badge-streak.webp',
    # --- surfaces ---
    # 'tex_ice':       'tex-ice.webp',   # wired to nothing
    # 'tex_board':     'tex-board.webp',   # wired to nothing
    # 'tex_weave':     'tex-weave.webp',   # wired to nothing
    # --- empty states ---
    'state_empty':   'state-empty.webp',
    'state_locked':  'state-locked.webp',
    # 'state_done':    'state-done.webp',   # wired to nothing
}

MIME = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml'}

# Keys whose art is composited straight onto the page with no container of
# its own. If one of these is opaque it will render as a rectangle on navy,
# which is exactly what shipped when stormy_win pointed at the RGB file
# instead of the -cut one. Checked at bake time rather than in a screenshot.
NEEDS_ALPHA = ('cut_', 'stormy_', 'carl_')


def has_alpha(path):
    try:
        from PIL import Image
    except ImportError:
        return None                      # cannot check; do not block the bake
    try:
        im = Image.open(path)
    except Exception:
        return None
    if im.mode not in ('RGBA', 'LA', 'P'):
        return False
    im = im.convert('RGBA')
    w, h = im.size
    corners = [im.getpixel(c) for c in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    return max(px[3] for px in corners) == 0


# ── headshots are delivered at full size and rendered at 26 to 38 px ──
#
# An NHL mug is a 336 px torso shot around 140 KB, and forty-nine of them
# inlined at that size made the single file 12.5 MB from 3.1 -- for a
# picture the page never draws bigger than 38 across.
#
# Worse than the weight: at 26 px a full torso is a blue smudge. The head
# occupies the top third of the frame and everything below it is sweater,
# so the crop is the point and the resize is the bonus. Cropping to 62% of
# the subject's own height, measured off the alpha channel rather than
# assumed, keeps the whole head and a sliver of shoulder on every man --
# tighter and it takes the hair off, looser and the face is small again.
HS_PX   = 128          # 38 px at 3.4x, which is more than any screen asks
HS_Q    = 88
HS_CROP = 0.62         # of the subject's height, from the top of his head


def portrait(path):
    """A mug, cropped to the man and sized for the page. Bytes, or None."""
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        im = Image.open(path).convert('RGBA')
        bb = im.split()[3].getbbox()
        if bb:
            W, H = im.size
            side = max(32, min(int(round((bb[3] - bb[1]) * HS_CROP)), min(W, H)))
            top  = min(max(0, bb[1] - int(side * 0.07)), H - side)
            cx   = (bb[0] + bb[2]) // 2
            left = max(0, min(cx - side // 2, W - side))
            im = im.crop((left, top, left + side, top + side))
        if im.size != (HS_PX, HS_PX):
            im = im.resize((HS_PX, HS_PX), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=HS_Q, method=6, exact=True)
        return buf.getvalue()
    except Exception:
        return None


def main():
    found, missing, total = {}, [], 0

    # headshots: art/hs-<lastname>.png, any number of them, no manifest needed.
    # The build keys them by last name and falls back to the numbered sweater
    # for anyone who has not been delivered.
    import glob
    hs, seen_stem = [], set()
    for d in ART_DIRS:
        # the cropped WebP wins over the full-size PNG it was made from, so a
        # delivery can leave both on disk and only the small one is ever used
        for f in sorted(glob.glob(os.path.join(d, 'hs-*.webp'))):
            hs.append(f); seen_stem.add(os.path.splitext(os.path.basename(f))[0].lower())
        for f in sorted(glob.glob(os.path.join(d, 'hs-*.png'))):
            if os.path.splitext(os.path.basename(f))[0].lower() not in seen_stem:
                hs.append(f)
    # The league hands out a grey silhouette for anyone without a real mug,
    # and it is the same file every time. Seven of Toronto's forty-nine came
    # down as that. It is worse than what the build already draws: the
    # numbered sweater carries his number and the club's crest, the
    # silhouette carries nothing. Any image two men share is by definition
    # not either man, so it is dropped and they keep their sweaters.
    import hashlib
    dup = {}
    for path in hs:
        try: dup.setdefault(hashlib.md5(open(path, 'rb').read()).hexdigest(), []).append(path)
        except OSError: pass
    shared = {h for h, v in dup.items() if len(v) > 1}
    placeholders = sum(len(dup[h]) for h in shared)

    seen_hs, kept, shrunk_already = set(), [], True
    hs_before = hs_after = 0
    for path in sorted(hs):
        if os.path.basename(path).lower() in seen_hs:
            continue
        seen_hs.add(os.path.basename(path).lower())
        raw = open(path, 'rb').read()
        if hashlib.md5(raw).hexdigest() in shared:
            continue
        hs_before += len(raw)
        ext = os.path.splitext(path)[1].lower()
        key = 'hs_' + os.path.basename(path)[3:-len(ext)].lower()
        small = portrait(path) if ext != '.webp' else None
        if small is None and ext != '.webp':
            shrunk_already = False       # a raw mug went in whole
        if small is not None:
            raw, ext = small, '.webp'
            # keep it: 5 KB beside a 140 KB mug means the repo can carry the
            # faces without carrying 7 MB of them, and every machine that
            # builds from the repo gets the identical bytes
            side = os.path.splitext(path)[0] + '.webp'
            if not os.path.exists(side):
                open(side, 'wb').write(raw)
                kept.append(os.path.basename(side))
        hs_after += len(raw)
        total += len(raw)
        found[key] = 'data:%s;base64,%s' % (MIME.get(ext, 'image/png'),
                                            base64.b64encode(raw).decode())
    if found:
        if hs_after < hs_before:
            print('  baked  %d headshots  %.1f MB of mugs -> %.0f KB, cropped to the man'
                  % (len(found), hs_before / 1048576, hs_after / 1024))
        elif shrunk_already:
            print('  baked  %d headshots  %.0f KB, already cropped' % (len(found), hs_after / 1024))
        else:
            print('  baked  %d headshots  %.0f KB, NOT cropped -- no Pillow, so a 336px'
                  ' torso is going in at full size' % (len(found), hs_after / 1024))
        if kept:
            print('         wrote %d cropped .webp beside the mugs, for the repo' % len(kept))
        if placeholders:
            print('         skipped %d league placeholders; those men keep their sweaters'
                  % placeholders)
    for key, fname in FILES.items():
        path = find_art(fname)
        if not path:
            missing.append(fname if isinstance(fname, str) else fname[0])
            continue
        if key.startswith(NEEDS_ALPHA):
            a = has_alpha(path)
            if a is False:
                sys.exit('\n%s is opaque, and %s is composited straight onto the page.\n'
                         'It would render as a rectangle on navy. Use the -cut variant.\n'
                         % (os.path.basename(path), key))
        raw = open(path, 'rb').read()
        total += len(raw)
        mime = MIME.get(os.path.splitext(path)[1].lower(), 'image/webp')
        found[key] = 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode())
        print('  baked  %-16s <- %-26s %6.0f KB' % (key, os.path.basename(path), len(raw) / 1024))

    # ── the all-time Leafs roster, inlined as data rather than as an image ──
    at_path = os.path.join(ART_DIR, 'leafs-alltime.json')
    at_block = ''
    if os.path.exists(at_path):
        import json as _json
        raw = _json.load(open(at_path, encoding='utf-8'))
        pl = raw.get('players') if isinstance(raw, dict) else raw
        keep = [p for p in (pl or [])
                if p.get('n') and p.get('gp') and p.get('y0') and p.get('y1')]
        if len(keep) < 50:
            sys.exit('leafs-alltime.json has only %d usable rows; expected the whole franchise'
                     % len(keep))
        payload = {'built': (raw.get('built') if isinstance(raw, dict) else '') or '',
                   'players': keep}
        at_block = 'const LEAFS_ALLTIME=' + _json.dumps(payload, separators=(',', ':'),
                                                        ensure_ascii=False) + ';\n'
        print('  baked  all-time Leafs   %d players, %d to %d'
              % (len(keep), min(p['y0'] for p in keep), max(p['y1'] for p in keep)))

    # newline='' both ways, or a bake on Windows rewrites every line of
    # app.js with \r\n and the diff is the whole file
    src = open(JS, encoding='utf-8', newline='').read()

    # ── the guard ─────────────────────────────────────────────────────
    # This script strips the old block and writes a new one, so a run that
    # finds nothing used to delete everything: app.js went from 1.56 MB of
    # inlined art to none, silently, and printed "0 of 41 keys baked" as if
    # that were a normal outcome. The only way back was git. It is a
    # one-command foot-gun sitting in a file three briefs tell people to run.
    #
    # A bake can only ever ADD. If this run would lose a key that is already
    # inlined, nothing is written and the reason is printed. Pass
    # --allow-shrink when a removal is what you actually meant.
    before = baked_keys(src)
    lost = before - set(found)
    if lost and '--allow-shrink' not in sys.argv:
        print('\nREFUSING TO WRITE. Nothing has been changed.\n')
        print('  %s already has %d keys inlined.' % (JS, len(before)))
        print('  This run found %d, and would delete %d:' % (len(found), len(lost)))
        print('    ' + ', '.join(sorted(lost)))
        print('\n  Almost always this means the art is not where the script looked.')
        print('  It searches, in this order, and also tries a -tor suffix:')
        for d in ART_DIRS:
            print('    %-46s %s' % (d, 'exists' if os.path.isdir(d) else 'not here'))
        print('\n  Run from demo/src, or pass --allow-shrink if you mean it.')
        sys.exit(1)

    src = re.sub(r'^const LEAFS_ALLTIME=.*?;\n', '', src, flags=re.M)
    if at_block:
        mark = '/* ── all-time Leafs ──'
        if mark not in src:
            sys.exit('all-time anchor missing from %s' % JS)
        src = src.replace(mark, at_block + mark, 1)

    # strip any previous block so this is idempotent
    if BEGIN in src:
        i, j = src.index(BEGIN), src.index(END) + len(END)
        src = src[:i] + src[j:]
        src = re.sub(r'\n{3,}', '\n\n', src)

    if found:
        body = ',\n'.join('  %s:{src:"%s"}' % (k, v) for k, v in found.items())
        block = '\n%s\nObject.assign(ART, {\n%s\n});\n%s\n' % (BEGIN, body, END)
        # must land AFTER the ART literal and BEFORE anything reads it
        anchor = "\n/* ── hero crops ─"
        if anchor not in src:
            sys.exit('anchor not found in %s — did the hero-crop block move?' % JS)
        src = src.replace(anchor, block + anchor, 1)

    open(JS, 'w', encoding='utf-8', newline='').write(src)

    gained = sorted(set(found) - before)
    print('\n%d of %d keys baked, %.1f MB of art inlined' % (len(found), len(FILES), total / 1048576))
    if gained:
        print('new this run (%d): %s' % (len(gained), ', '.join(gained)))
    if missing:
        print('not delivered yet (%d): %s' % (len(missing), ', '.join(missing)))
    print('\nnow run:  python3 build.py')


if __name__ == '__main__':
    main()
