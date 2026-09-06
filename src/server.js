import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RoomStore } from './rooms.js';

const PUBLIC=fileURLToPath(new URL('../public/',import.meta.url));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const tokenOf=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('splendor_session='))?.slice(17);
async function bodyOf(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('请求必须使用 JSON');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('请求内容过大');chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new Error('JSON 格式不正确');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('请求内容不正确');return body;
}

export function createServer(options={}){
  const store=new RoomStore(options);
  const registrations=new Map();
  function allowRegistration(ip){
    const now=Date.now();
    for(const [key,value] of registrations)if(value.until<=now)registrations.delete(key);
    let entry=registrations.get(ip);
    if(!entry){if(registrations.size>=2000)return false;entry={count:0,until:now+60000};registrations.set(ip,entry);}
    return ++entry.count<=30;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        if(req.method==='POST'){
          const origin=req.headers.origin;
          if(origin&&new URL(origin).host!==req.headers.host){json(res,403,{error:'不允许跨站请求'});return;}
        }
        if(url.pathname==='/api/health'&&req.method==='GET'){json(res,200,{ok:true});return;}
        if(url.pathname==='/api/session'&&req.method==='POST'){
          if(!store.session(tokenOf(req))&&!allowRegistration(req.socket.remoteAddress)){
            res.setHeader('Retry-After','60');json(res,429,{error:'新访客过于频繁，请一分钟后再试'});return;
          }
          const body=await bodyOf(req);const s=store.register(tokenOf(req),body.name);
          const secure=process.env.COOKIE_SECURE==='true'?'; Secure':'';
          res.setHeader('Set-Cookie',`splendor_session=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
          json(res,200,store.snapshot(s));return;
        }
        const s=store.session(tokenOf(req));if(!s){json(res,401,{error:'请先设置昵称'});return;}
        if(url.pathname==='/api/room'&&req.method==='GET'){json(res,200,store.snapshot(s));return;}
        if(url.pathname==='/api/events'&&req.method==='GET'){
          if(s.streams.size>=5){json(res,429,{error:'打开页面过多'});return;}
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 2000\n\n');
          const heartbeat=setInterval(()=>{res.write(': heartbeat\n\n');s.seen=Date.now();},15000);heartbeat.unref();
          res.on('close',()=>clearInterval(heartbeat));store.attach(s,res);return;
        }
        if(req.method!=='POST'){json(res,404,{error:'接口不存在'});return;}
        const body=await bodyOf(req);
        switch(url.pathname){
          case '/api/rooms':store.create(s);break;
          case '/api/join':store.join(s,body.code);break;
          case '/api/room/ai':store.addAI(s,body.mode);break;
          case '/api/room/start':store.start(s);break;
          case '/api/room/settings':store.settingsUpdate(s,body);break;
          case '/api/room/reset':store.reset(s);break;
          case '/api/room/finish':store.finish(s);break;
          case '/api/room/kick':store.kick(s,body.playerId);break;
          case '/api/room/leave':store.leave(s);break;
          case '/api/room/action':store.action(s,body);break;
          default:json(res,404,{error:'接口不存在'});return;
        }
        json(res,200,store.snapshot(s));return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const relative=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file=path.resolve(PUBLIC,relative);
      if(!file.startsWith(PUBLIC)||relative.split(/[\\/]/).some(p=>p.startsWith('.'))||!TYPES[path.extname(file)]){res.writeHead(404);res.end('Not found');return;}
      try{const data=await readFile(file);res.writeHead(200,{'Content-Type':TYPES[path.extname(file)],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end('Not found');}
    }catch(error){if(!res.headersSent)json(res,400,{error:error.message||'操作失败'});else res.end();}
  });
  server.on('close',()=>store.close());server.store=store;
  server.requestTimeout=30000;server.headersTimeout=15000;
  return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3030);const host=process.env.HOST||'0.0.0.0';
  const server=createServer();server.listen(port,host,()=>console.log(`璀璨宝石已启动：http://localhost:${port} （监听 ${host}）\nDeepSeek：${server.store.aiKey?'已配置':'未配置，可使用本地练习 AI'}`));
  server.on('error',err=>{console.error(`服务启动失败：${err.code}`);process.exitCode=1;});
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.store.close();server.closeAllConnections();server.close();});
}

