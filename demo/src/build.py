#!/usr/bin/env python3
"""Inline app.js into index.html -> Toronto_GameDay_Citrus.html (single file)."""
import pathlib
d = pathlib.Path('/home/claude/leafs')
html = (d/'index.html').read_text(encoding='utf-8')
js   = (d/'app.js').read_text(encoding='utf-8')
tag  = '<script src="app.js"></script>'
assert tag in html, 'script tag not found'
# guard: a literal </script> inside the JS would close the tag early
assert '</script' not in js, 'JS contains a closing script tag'
out = html.replace(tag, '<script>\n' + js + '\n</script>')
(d/'Toronto_GameDay_Citrus.html').write_text(out, encoding='utf-8')
print(f'built Toronto_GameDay_Citrus.html  {len(out):,} bytes  (html {len(html):,} + js {len(js):,})')
