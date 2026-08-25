/* This file used to point at an absolute path on the machine it was
   written on, which meant not one of these ran anywhere else. ROOT is
   worked out from the file's own location instead: the build sits beside
   these sources in the working copy and one level up in the repo, so both
   are tried. BUILD_URL is a proper file:// URL, because "file://" plus a
   Windows path is not one. */
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
const HERE  = dirname(fileURLToPath(import.meta.url));
const ROOT  = existsSync(join(HERE, 'Toronto_GameDay_Citrus.html')) ? HERE : join(HERE, '..');
const BUILD = join(ROOT, 'Toronto_GameDay_Citrus.html');
const BUILD_URL = pathToFileURL(BUILD).href;
import http from 'http'; import { readFileSync } from 'fs';

/* Only here for eyeballing the page in a browser -- every harness spins up
   its own server now, including verify.mjs, which used to need this one
   running in another window and failed obscurely when it was not. */
const find = u => {
  for (const d of [ROOT, HERE]){ const f = join(d, u); if (existsSync(f)) return f; }
  return null;
};
http.createServer((q,s)=>{
  const u = q.url === '/' ? '/Toronto_GameDay_Citrus.html' : q.url.split('?')[0];
  const f = find(u);
  if (!f){ s.writeHead(404); s.end('not here: ' + u); return; }
  s.writeHead(200,{'Content-Type': f.endsWith('.js') ? 'text/javascript'
    : f.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8'});
  s.end(readFileSync(f));
}).listen(4321, () => console.log('http://localhost:4321/  ->  ' + BUILD));
