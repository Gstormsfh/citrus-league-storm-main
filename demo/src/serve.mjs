import http from 'http'; import { readFileSync } from 'fs';
http.createServer((q,s)=>{ const p=q.url==='/'?'/index.html':q.url;
  try{ const b=readFileSync('/home/claude/leafs'+p);
    s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.json')?'application/json':'text/html'}); s.end(b);
  }catch(e){ s.writeHead(404); s.end('nf'); } }).listen(4321,()=>console.log('4321'));
