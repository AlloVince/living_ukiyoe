import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {spawn} from 'node:child_process';
export async function serve({port=4177,base='/',quiet=false}={}) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw Error('Base must be a directory path, e.g. /living_ukiyoe/');
  const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.json':'application/json'};
  const server=http.createServer(async(req,res)=>{
    let path;
    try { path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch {res.writeHead(400).end();return;}
    if (base!=='/' && path===base.slice(0,-1)) {res.writeHead(301,{Location:base}).end();return;}
    if (!path.startsWith(base)) {res.writeHead(404).end('Not found');return;}
    const local=path.slice(base.length)||'index.html';
    const file=resolve(root,local);
    if (!file.startsWith(root+sep) && file!==root) {res.writeHead(403).end();return;}
    try {
      if (!(await stat(file)).isFile()) throw Error('file');
      const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);
    } catch {res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  const actual=server.address().port;
  if(!quiet)console.log(`Living Ukiyo-e: http://127.0.0.1:${actual}${base}`);
  return {server,url:`http://127.0.0.1:${actual}${base}`};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv.includes('--dev')) await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('build.mjs',import.meta.url))],{stdio:'inherit'});
    child.on('exit',code=>code===0?resolve():reject(Error('Build failed')));
  });
  const {server}=await serve({port:Number(process.env.PORT||4177),base:process.env.BASE_PATH||'/'});
  const watchers=[];
  if(process.argv.includes('--dev')) {
    const {watch}=await import('node:fs');let pending;
    for(const path of ['app','demo/src','index.html','credits.html']) watchers.push(watch(new URL('../'+path,import.meta.url),{recursive:true},()=>{
      clearTimeout(pending);pending=setTimeout(()=>spawn(process.execPath,[fileURLToPath(new URL('build.mjs',import.meta.url))],{stdio:'inherit'}),150);
    }));
  }
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{watchers.forEach(w=>w.close());server.close();});
}
