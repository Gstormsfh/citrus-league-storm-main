"""Compare every rendered page with an already inspected same-content edition."""
import argparse
import hashlib
import json
from pathlib import Path
import pymupdf

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('before', type=Path)
p.add_argument('after', type=Path)
p.add_argument('output', type=Path)
a = p.parse_args()
if a.output.exists():
    raise FileExistsError(a.output)
with pymupdf.open(a.before) as before, pymupdf.open(a.after) as after:
    assert len(before) == len(after), 'Page count changed'
    changed = []
    for i, (old, new) in enumerate(zip(before, after), 1):
        left = old.get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False)
        right = new.get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False)
        if (left.width, left.height, left.samples) != (right.width, right.height, right.samples):
            changed.append(i)
    result = {'status': 'PASS' if not changed else 'VISUAL_REVIEW_REQUIRED',
              'pages': len(after), 'changedPages': changed,
              'scope': 'Every-page render equality to the named previously inspected edition, not new editorial or numerical approval',
              'sha256': {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in (a.before, a.after)}}
with a.output.open('x') as stream:
    json.dump(result, stream, indent=2)
print(json.dumps(result))
