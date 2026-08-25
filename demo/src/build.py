#!/usr/bin/env python3
"""Inline app.js into index.html -> Toronto_GameDay_Citrus.html (single file)."""
import pathlib
# The sources are wherever this file is; the built page is not necessarily
# in the same place. In a working copy it sits beside them, and in the repo
# it sits one level up at demo/ while the sources live in demo/src. Write
# it back over whichever one already exists, so the harnesses -- which look
# in exactly those two places -- find what was just built.
d   = pathlib.Path(__file__).resolve().parent
OUT = 'Toronto_GameDay_Citrus.html'
out_dir = d
if not (d/OUT).exists() and (d.parent/OUT).exists():
    out_dir = d.parent
html = (d/'index.html').read_text(encoding='utf-8')
js   = (d/'app.js').read_text(encoding='utf-8')
tag  = '<script src="app.js"></script>'
assert tag in html, 'script tag not found'
# guard: a literal </script> inside the JS would close the tag early
assert '</script' not in js, 'JS contains a closing script tag'
out = html.replace(tag, '<script>\n' + js + '\n</script>')
(out_dir/OUT).write_text(out, encoding='utf-8')
print(f'built {out_dir/OUT}  {len(out):,} bytes  (html {len(html):,} + js {len(js):,})')
