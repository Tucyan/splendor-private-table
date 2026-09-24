import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import { createServer } from '../src/server.js';

const disabledLlmConfig=Object.freeze({enabled:false,model:undefined,advancedModel:undefined,reflectionModel:undefined});

async function fixture(t,options={}) {
  const server=createServer({llmConfig:disabledLlmConfig,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  function client(){let cookie='';return async(path,body)=>{
    const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,data:await res.json(),cookie};
  };}
  return {base,client,server};
}

test('sessions, room membership, ownership, hiding secrets and in-game kick', async t=>{
  const {client}=await fixture(t);const host=client(),guest=client(),outsider=client();
  await host('/api/session',{name:'房主'});await guest('/api/session',{name:'小蓝'});await outsider('/api/session',{name:'访客'});
  let res=await host('/api/rooms',{});assert.equal(res.status,200);
  const code=res.data.room.code;assert.match(code,/^\d{6}$/);
  res=await guest('/api/join',{code});assert.equal(res.data.room.players.length,2);
  assert.equal((await outsider('/api/room')).data.room,null);
  assert.equal((await guest('/api/room/start',{})).status,400);
  res=await host('/api/room/start',{});assert.equal(res.data.room.game.status,'playing');
  assert.equal(typeof res.data.room.game.decks[1],'number');
  assert.ok(!JSON.stringify(res.data).includes('sessionToken'));
  const guestState=(await guest('/api/room')).data;
  const guestId=guestState.me.id;
  assert.equal((await guest('/api/room/action',{version:0,action:{type:'take',gems:{white:3}}})).status,400);
  res=await host('/api/room/kick',{playerId:guestId});
  assert.equal(res.data.room.game.players.length,2);
  assert.ok(res.data.room.players.find(p=>p.id===guestId).ai);
  assert.equal((await guest('/api/room')).data.room,null);
  assert.equal((await guest('/api/join',{code})).status,400);
});

test('room capacity, nickname change and leave transfer host',async t=>{
  const {client}=await fixture(t);const a=client(),b=client();
  await a('/api/session',{name:'A'});await b('/api/session',{name:'B'});
  const {data}=await a('/api/rooms',{});await b('/api/join',{code:data.room.code});
  await a('/api/room/ai',{mode:'local'});await a('/api/room/ai',{mode:'local'});
  assert.equal((await a('/api/room/ai',{mode:'local'})).status,400);
  assert.equal((await a('/api/room/ai',{mode:'llm-basic'})).status,400);
  assert.equal((await b('/api/session',{name:'新昵称'})).data.me.name,'新昵称');
  await a('/api/room/leave',{});
  const next=(await b('/api/room')).data;assert.equal(next.room.hostId,next.me.id);
});

test('the AI endpoint forwards all five local modes and gates only generic LLM modes', async t => {
  for (const mode of ['local-beginner', 'local-simple', 'local-normal', 'local-hard', 'local-hell']) {
    const { client } = await fixture(t);
    const host = client();
    await host('/api/session', { name: '房主' });
    await host('/api/rooms', {});
    for (const llmMode of ['llm-basic', 'llm-advanced']) {
      const denied = await host('/api/room/ai', { mode: llmMode });
      assert.equal(denied.status, 400);
      assert.match(denied.data.error, /LLM.*配置/);
    }
    assert.match((await host('/api/room/ai', { mode:'deepseek' })).data.error, /未知 AI 类型/);
    const result = await host('/api/room/ai', { mode });
    assert.equal(result.status, 200, `${mode}: ${result.data.error || ''}`);
    assert.equal(result.data.room.players.find(p => p.ai).mode, mode);
  }
});

test('createServer loads generic LLM config from its injected environment and publishes only model names', async t => {
  const {client,server}=await fixture(t,{
    llmConfig:undefined,
    env:{LLM_API_KEY:'server-secret',LLM_API_URL:'https://provider.example/chat',LLM_MODEL:'base-x',LLM_ADVANCED_MODEL:'advanced-x',LLM_REASONING_EFFORTS:'low,max'},
  });
  assert.equal(server.store.llmConfig.model,'base-x');
  const host=client();
  const result=await host('/api/session',{name:'房主'});
  assert.equal(result.data.llmAvailable,true);
  assert.deepEqual(result.data.llmModels,{enabled:true,baseModel:'base-x',advancedModel:'advanced-x',reflectionModel:'advanced-x',reasoningEfforts:['off','low','max']});
  await host('/api/rooms',{});
  const added=await host('/api/room/ai',{mode:'llm-advanced',reasoningEffort:'max'});
  assert.equal(added.data.room.players.at(-1).reasoningEffort,'max');
  assert.equal((await host('/api/room/ai',{mode:'llm-advanced',reasoningEffort:'high'})).status,400);
  assert.ok(!JSON.stringify(result.data).includes('server-secret'));
  assert.ok(!JSON.stringify(result.data).includes('provider.example'));
});

test('HTTP validates session, JSON, origin and static file boundaries',async t=>{
  const {base,client}=await fixture(t);
  assert.equal((await client()('/api/rooms',{})).status,401);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/璀璨宝石/);
  const audio=await fetch(base+'/assets/audio/chip-lay-2.ogg');
  assert.equal(audio.status,200);assert.match(audio.headers.get('content-type'),/^audio\/ogg/);assert.ok((await audio.arrayBuffer()).byteLength>1000);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/src/server.js')).status,404);
  assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status,400);
});

test('anonymous session creation is rate limited without locking out existing players',async t=>{
  const {client}=await fixture(t);const existing=client();await existing('/api/session',{name:'已入座'});
  let limited=false;
  for(let i=0;i<35;i++)if((await client()('/api/session',{name:'新访客'})).status===429)limited=true;
  assert.equal(limited,true);
  assert.equal((await existing('/api/session',{name:'已改名'})).status,200);
});

test('real SSE reports presence and ten clients can occupy three private rooms',async t=>{
  const {base,client,server}=await fixture(t);
  const clients=Array.from({length:10},()=>client());
  const sessions=await Promise.all(clients.map((c,i)=>c('/api/session',{name:`玩家${i}`})));
  const codes=[];
  for(let i=0;i<10;i++){
    if(i%4===0)codes.push((await clients[i]('/api/rooms',{})).data.room.code);
    else assert.equal((await clients[i]('/api/join',{code:codes.at(-1)})).status,200);
  }
  assert.equal(new Set(codes).size,3);
  const response=await fetch(base+'/api/events',{headers:{cookie:sessions[1].cookie},signal:AbortSignal.timeout(3000)});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();let frames='';
  while(!frames.includes('data:')){const chunk=await reader.read();frames+=new TextDecoder().decode(chunk.value);}
  const online=(await clients[0]('/api/room')).data.room.players;
  assert.equal(online[1].online,true);
  const serverStream=[...server.store.sessions.values()].find(s=>s.id===sessions[1].data.me.id).streams.values().next().value;
  const closed=once(serverStream,'close');await reader.cancel();await closed;
  assert.equal((await clients[0]('/api/room')).data.room.players[1].online,false);
  assert.equal((await clients[8]('/api/room')).data.room.players.length,2);
});

test('host finish endpoint stops a running game; other players cannot use it',async t=>{
  const {client}=await fixture(t);const host=client(),guest=client();
  await host('/api/session',{name:'房主'});await guest('/api/session',{name:'玩家'});
  const code=(await host('/api/rooms',{})).data.room.code;await guest('/api/join',{code});
  await host('/api/room/start',{});
  assert.equal((await guest('/api/room/finish',{})).status,400);
  const result=await host('/api/room/finish',{});
  assert.equal(result.status,200);assert.equal(result.data.room.game.endReason,'host');
  assert.equal(result.data.room.game.status,'finished');
});
