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
import base64, os, sys, re

ART_DIR = 'art'
JS      = 'app.js'
BEGIN   = '/* ==== BAKED ART: written by bake_art.py, do not edit by hand ==== */'
END     = '/* ==== END BAKED ART ==== */'

# key in the build            filename that has to appear in art/
FILES = {
    # --- the club crest. Drop the real asset in as art/crest.png (or .svg
    #     converted to png) and it replaces every drawn leaf in the build. ---
    'crest':         'crest.png',
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
    # --- the page bands: wide 16:9 plates behind each hero (fallback) ---
    'band_ult':      'band-locker.webp',
    'band_stormy':   'band-bench.webp',
    'band_hl':       'band-clock.webp',
    'band_guess':    'band-tunnel.webp',
    'band_luck':     'band-ice.webp',
    'band_rank':     'band-podium.webp',
    'band_fx':       'band-card.webp',
    'band_bz':       'band-crease.webp',
    'band_grid':     'band-grid.webp',
    'band_lb':       'band-board.webp',
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

MIME = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}


def main():
    found, missing, total = {}, [], 0

    # headshots: art/hs-<lastname>.png, any number of them, no manifest needed.
    # The build keys them by last name and falls back to the numbered sweater
    # for anyone who has not been delivered.
    import glob
    for path in sorted(glob.glob(os.path.join(ART_DIR, 'hs-*.png')) +
                       glob.glob(os.path.join(ART_DIR, 'hs-*.webp'))):
        raw = open(path, 'rb').read()
        total += len(raw)
        ext = os.path.splitext(path)[1].lower()
        key = 'hs_' + os.path.basename(path)[3:-len(ext)].lower()
        found[key] = 'data:%s;base64,%s' % (MIME.get(ext, 'image/png'),
                                            base64.b64encode(raw).decode())
    if found:
        print('  baked  %d headshots' % len(found))
    for key, fname in FILES.items():
        path = os.path.join(ART_DIR, fname)
        if not os.path.exists(path):
            missing.append(fname)
            continue
        raw = open(path, 'rb').read()
        total += len(raw)
        mime = MIME.get(os.path.splitext(fname)[1].lower(), 'image/webp')
        found[key] = 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode())
        print('  baked  %-16s <- %-22s %6.0f KB' % (key, fname, len(raw) / 1024))

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

    src = open(JS, encoding='utf-8').read()
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

    open(JS, 'w', encoding='utf-8').write(src)

    print('\n%d of %d keys baked, %.1f MB of art inlined' % (len(found), len(FILES), total / 1048576))
    if missing:
        print('not delivered yet (%d): %s' % (len(missing), ', '.join(missing)))
    print('\nnow run:  python3 build.py')


if __name__ == '__main__':
    main()
