import http from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import path from 'node:path';

const root=fileURLToPath(new URL('../dist/client/',import.meta.url));
const port=Number(process.env.PORT||5173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.rsc':'text/x-component','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
const COMPRESSIBLE=new Set(['.glb','.json','.js','.css','.html','.rsc','.svg','.wasm']);
const cache=new Map();
try{await stat(path.join(root,'index.html'));}catch{console.error('Build the campus first: npm run build');process.exit(1);}
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    const relative=path.relative(root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403).end();return;}
    const info=await stat(file);
    if(!info.isFile()){res.writeHead(404).end();return;}
    const type=types[path.extname(file)]||'application/octet-stream';
    // Phones reach this over a tunnel, where the transfer is the whole wait.
    // Compress once and keep it; the real size still goes out so the loading
    // percentage measures the model, not the compressed stream.
    const wants=(req.headers['accept-encoding']||'').includes('gzip');
    if(wants&&COMPRESSIBLE.has(path.extname(file))&&info.size>4096){
      const key=file+':'+info.mtimeMs;
      let body=cache.get(key);
      if(!body){body=gzipSync(await readFile(file),{level:6});cache.set(key,body);}
      res.writeHead(200,{'Content-Type':type,'Content-Encoding':'gzip','Content-Length':body.length,
        'X-Uncompressed-Length':info.size,'Vary':'Accept-Encoding','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:body);
      return;
    }
    res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'Cache-Control':'no-cache'});
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch{res.writeHead(404).end('Not found');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Open http://127.0.0.1:${port}/ if the campus is already running, or set PORT to another number.`:error);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Campus ready: http://127.0.0.1:${port}/\nKeep this window open. Press Ctrl+C to stop.`));
