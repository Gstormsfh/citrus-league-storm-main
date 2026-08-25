#!/bin/sh
# What ships. out/ is the tree that goes into the repo: the single file the
# room opens, and the sources that rebuild it. Art that lives in the repo
# already is not copied -- only files this demo added.
set -e
cd "$(dirname "$0")"
mkdir -p out/src/art out/src/scripts out/src/grid2 out/src/live
cp Toronto_GameDay_Citrus.html out/
for f in app.js index.html build.py bake_art.py carve.py serve.mjs \
         fetch-assets.mjs \
         players.json shots.json \
         realsite.mjs verify.mjs mobplay.mjs mobsweep.mjs offline.mjs \
         classcheck.mjs audit_hub.mjs shots_all.mjs proof.mjs leak.mjs \
         figcheck.mjs vecfall.mjs rowcheck.mjs nudgeshot.mjs nits.mjs rank4.mjs phone_all.mjs \
         carlshot.mjs ultshot.mjs tapsize.mjs \
         checks.ps1 package.json \
         CARLTON-BRIEF.md CARLTON-PROMPT.txt PAGE-DESIGN-BRIEF.md \
         TERMINAL-BRIEF-LIVE.md ALLTIME-LEAFS.md; do
  [ -f "$f" ] && cp "$f" out/src/ || echo "  missing: $f"
done
# the seven Carlton layers and the mascot cut-outs are new to this demo
for f in art/carlton-base.webp art/carlton-hit.webp art/carlton-a.webp \
         art/carlton-blk.webp art/carlton-tk.webp art/carlton-g.webp \
         art/carlton-sog.webp art/mascot-stormy-tor-win-cut.webp \
         art/mascot-stormy-tor-loss-cut.webp; do
  [ -f "$f" ] && cp "$f" out/src/art/ || echo "  missing: $f"
done
[ -d grid2 ] && cp -r grid2/. out/src/grid2/ 2>/dev/null || true
# live/ holds the replay's source data and a pile of test screenshots.
# Only the data ships -- the screenshots are 62 MB and rebuild in a minute.
for f in live/*.txt live/*.json; do [ -f "$f" ] && cp "$f" out/src/live/; done
for f in scripts/*.mjs scripts/*.py; do [ -f "$f" ] && cp "$f" out/src/scripts/; done
du -sh out
find out -type f | wc -l
