"""Run the existing independent full-population audit on a saved cloud request."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--attempt', type=Path, required=True)
p.add_argument('--auditor', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
if a.output.exists():
    raise FileExistsError(a.output)
spec = importlib.util.spec_from_file_location('independent_population_auditor', a.auditor)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
request_path = a.attempt / 'completion-request.exact.json'
schedule_path = a.attempt / 'schedule.json'
request = json.loads(request_path.read_text())
candidate, context = request['p_candidate'], request['p_context']
assert context['status'] == 'validated'
assert context['candidate_revision'] == candidate['revision']
# The sealed context contract binds its complete row array at the top level;
# the independent auditor's older flat-row interface expects that binding on
# every row. Do not invent or replace per-row bindings if one is present.
assert all('canonical_revision' not in row for row in context['rows'])
result = module.audit(candidate, json.loads(schedule_path.read_text()),
                      ({**row, 'canonical_revision': context['candidate_revision']}
                       for row in context['rows']))
result['source_revision'] = candidate['source_revision']
result['candidate_revision'] = candidate['revision']
result['input_sha256'] = {str(f): hashlib.sha256(f.read_bytes()).hexdigest()
                          for f in (a.auditor, request_path, schedule_path)}
with a.output.open('x') as stream:
    json.dump(result, stream, indent=2, allow_nan=False)
print(json.dumps(result, indent=2))
