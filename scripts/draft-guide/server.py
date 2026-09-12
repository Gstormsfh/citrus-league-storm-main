"""Local-only guide configurator. No remote writes or application deployment."""
import argparse,hashlib,json,mimetypes,tempfile,webbrowser,threading
from http.server import HTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from scoring import calculate
from build import generate,ROOT
DATA=json.loads((ROOT/'workbook-data.json').read_text())
def identity(weights):
 return {'canonicalRevision':DATA.get('canonicalRevision'),'sourceSha256':DATA['source']['sha256'],'weightsSha256':hashlib.sha256(json.dumps(weights,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'kind':'explicit_local_preview'}
class Handler(BaseHTTPRequestHandler):
 def respond(self,status,body,kind='application/json'):
  if not isinstance(body,bytes):body=json.dumps(body).encode()
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
 def allowed(self):return self.headers.get('Host') in [f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}']
 def do_GET(self):
  if not self.allowed():return self.respond(403,{'error':'Localhost only'})
  if self.path=='/api/data':return self.respond(200,{'identity':identity(DATA['weights']),'source':DATA['source'],'weights':DATA['weights'],'rookies':DATA['rookies'],'result':calculate(DATA,DATA['weights'])})
  if self.path in ['/','/index.html']:return self.respond(200,(ROOT/'index.html').read_bytes(),'text/html; charset=utf-8')
  name=self.path.removeprefix('/assets/')
  if self.path.startswith('/assets/') and name in ['Barlow-Regular.ttf','Barlow-Bold.ttf','BarlowCondensed-Bold.ttf','logo.png']:
   return self.respond(200,(ROOT/'assets'/name).read_bytes(),mimetypes.guess_type(name)[0] or 'application/octet-stream')
  return self.respond(404,{'error':'Not found'})
 def do_POST(self):
  if not self.allowed() or (self.headers.get('Origin') and self.headers['Origin'] not in [f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}']):return self.respond(403,{'error':'Local requests only'})
  try:
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<32768:raise ValueError('Invalid request size')
   req=json.loads(self.rfile.read(length));weights=req['weights'];result=calculate(DATA,weights)
   if self.path=='/api/score':return self.respond(200,{**result,'identity':identity(weights)})
   if self.path=='/api/pdf':
    name=req.get('league','My league')
    if not isinstance(name,str) or not 1<=len(name.strip())<=64:raise ValueError('League name must be 1-64 characters')
    with tempfile.TemporaryDirectory(prefix='citrus-guide-') as folder:
     path=Path(folder)/'guide.pdf';generate(DATA,weights,name.strip(),path);payload=path.read_bytes()
    return self.respond(200,payload,'application/pdf')
   return self.respond(404,{'error':'Not found'})
  except (ValueError,KeyError,TypeError) as e:return self.respond(400,{'error':str(e)})
 def log_message(self,*args):pass
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8765);p.add_argument('--open',action='store_true');p.add_argument('--data',type=Path,default=ROOT/'workbook-data.json');a=p.parse_args();DATA=json.loads(a.data.read_text());server=HTTPServer(('127.0.0.1',a.port),Handler)
 url=f'http://127.0.0.1:{server.server_port}';print(f'Citrus guide configurator: {url}',flush=True)
 if a.open:threading.Timer(.3,lambda:webbrowser.open(url)).start()
 try:server.serve_forever()
 except KeyboardInterrupt:server.server_close()
