import json,subprocess,shutil,os
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def calculate(data,weights):
 node=os.environ.get('CITRUS_NODE') or shutil.which('node')
 if not node:raise ValueError('Node.js 22.18+ is required; set CITRUS_NODE to its executable.')
 p=subprocess.run([node,'--disable-warning=ExperimentalWarning',str(ROOT/'score.mjs')],input=json.dumps({'data':data,'weights':weights}),text=True,capture_output=True,timeout=30)
 if p.returncode:raise ValueError(p.stderr.strip().splitlines()[0:5])
 return json.loads(p.stdout)
