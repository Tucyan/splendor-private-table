import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {RoomStore} from '../src/rooms.js';

const llmConfig=Object.freeze({enabled:true,apiKey:'fixture-key',apiUrl:'https://llm.example/v1/chat/completions',model:'base-model',advancedModel:'advanced-model',reflectionModel:'reflection-model',timeoutMs:321,extraBody:{}});

class Stream extends EventEmitter {
  write(text){this.last=text;}
  end(){this.destroyed=true;this.emit('close');}
}
function setup(t,options={}){
  const store=new RoomStore(options);t.after(()=>store.close());
  const host=store.register(null,'房主'),guest=store.register(null,'来宾');
  store.create(host);store.join(guest,store.room(host).code);
  return {store,host,guest,room:store.room(host)};
}
test('host settings start at the first reordered seat and complete an equal-turn final round',t=>{
  const {store,host,guest,room}=setup(t);
  assert.equal(room.settings.finishScore,15);
  assert.throws(()=>store.settingsUpdate(guest,{finishScore:20}),/房主/);
  assert.throws(()=>store.settingsUpdate(host,{finishScore:0}),/分数/);
  assert.throws(()=>store.settingsUpdate(host,{turnOrder:[host.id,host.id]}),/顺序/);
  store.settingsUpdate(host,{finishScore:20,turnOrder:[guest.id,host.id]});
  store.start(host);
  assert.equal(room.game.players[room.game.turn].id,guest.id);
  assert.throws(()=>store.settingsUpdate(host,{finishScore:15}),/开始/);
  room.game.players.find(p=>p.id===guest.id).score=19;
  store.action(guest,{version:room.version,action:{type:'take',gems:{white:1}}});
  assert.equal(room.game.finalRound,null);
  store.action(host,{version:room.version,action:{type:'take',gems:{blue:1}}});
  room.game.players.find(p=>p.id===guest.id).score=20;
  store.action(guest,{version:room.version,action:{type:'take',gems:{green:1}}});
  assert.equal(room.game.status,'playing');
  store.action(host,{version:room.version,action:{type:'take',gems:{red:1}}});
  assert.equal(room.game.status,'finished');
});
test('online state handles multiple tabs, disconnection and reconnection',t=>{
  const {store,host,guest}=setup(t);const a=new Stream(),b=new Stream();
  store.attach(guest,a);store.attach(guest,b);
  assert.equal(store.snapshot(host).room.players[1].online,true);
  a.end();assert.equal(store.snapshot(host).room.players[1].online,true);
  b.end();assert.equal(store.snapshot(host).room.players[1].online,false);
  store.attach(guest,new Stream());assert.equal(store.snapshot(host).room.players[1].online,true);
});
test('the room survives everyone disconnecting until the idle timeout, then clears memberships',t=>{
  const {store,host,guest,room}=setup(t);const a=new Stream(),b=new Stream();
  store.attach(host,a);store.attach(guest,b);a.end();b.end();
  assert.equal(store.rooms.has(room.code),true);
  room.updatedAt=Date.now()-12*60*60*1000+1000;store.sweep();
  assert.equal(store.rooms.has(room.code),true);
  room.updatedAt=Date.now()-12*60*60*1000-1000;store.sweep();
  assert.equal(store.rooms.has(room.code),false);
  assert.equal(host.roomCode,null);assert.equal(guest.roomCode,null);
});
test('the final human actively leaving deletes a running room and its managed seats',t=>{
  const {store,host,guest,room}=setup(t);store.start(host);
  store.leave(host);
  assert.equal(store.rooms.has(room.code),true);
  assert.equal(room.players.find(p=>p.id===host.id).ai,true);
  store.leave(guest);
  assert.equal(store.rooms.has(room.code),false);
  assert.equal(host.roomCode,null);assert.equal(guest.roomCode,null);
});
test('duplicate action version cannot spend gems twice, and a reconnect retains seat',t=>{
  const {store,host,room}=setup(t);store.start(host);
  const version=room.version;store.action(host,{version,action:{type:'take',gems:{white:1}}});
  assert.throws(()=>store.action(host,{version,action:{type:'take',gems:{white:1}}}),/更新/);
  assert.equal(room.game.players[0].gems.white,1);
  assert.equal(store.register(host.token,'新名').roomCode,room.code);
});
test('advanced observer memory records public reserves and masks blind identities',t=>{
  const {store,host,guest,room}=setup(t,{llmConfig});
  store.addAI(host,'llm-advanced');
  const observer=room.players.find(player=>player.mode==='llm-advanced');
  store.start(host);
  const marketCard=room.game.market[1][0];
  store.action(host,{version:room.version,action:{type:'reserve',cardId:marketCard.id}});
  let observed=store.advancedObservations.get(room.gameId,observer.id);
  assert.equal(observed.observedReserved[host.id][0].cardId,marketCard.id);
  assert.equal(observed.events.at(-1).visibility,'public');

  store.action(guest,{version:room.version,action:{type:'reserve',level:2}});
  observed=store.advancedObservations.get(room.gameId,observer.id);
  assert.equal(observed.events.at(-1).visibility,'blind');
  assert.equal(observed.events.at(-1).level,2);
  assert.equal(Object.hasOwn(observed.events.at(-1),'cardId'),false);
  assert.equal(Object.hasOwn(observed.events.at(-1),'card'),false);
});
test('advanced observer memory records successful AI actions',async t=>{
  const {store,host,guest,room}=setup(t,{
    llmConfig,aiDelay:1,
    advancedChoose:async(_game,_id,actions)=>({action:actions.find(action=>action.type==='take')||actions[0],source:'advanced-test'}),
  });
  store.addAI(host,'llm-advanced');
  const observer=room.players.find(player=>player.mode==='llm-advanced');
  store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  store.action(guest,{version:room.version,action:{type:'take',gems:{blue:1}}});
  await delay(80);
  const observed=store.advancedObservations.get(room.gameId,observer.id);
  assert.equal(observed.events.at(-1).actorId,observer.id);
  assert.equal(observed.events.at(-1).type,'take');
  assert.equal(room.aiStatus.source,'advanced-test');
});
test('advanced observer memory records the action used by AI fallback',async t=>{
  const {store,host,guest,room}=setup(t,{llmConfig,aiDelay:1,advancedChoose:async()=>{throw new Error('adapter failed');}});
  store.addAI(host,'llm-advanced');
  const observer=room.players.find(player=>player.mode==='llm-advanced');
  store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  store.action(guest,{version:room.version,action:{type:'take',gems:{blue:1}}});
  await delay(80);
  const observed=store.advancedObservations.get(room.gameId,observer.id);
  assert.equal(observed.events.at(-1).actorId,observer.id);
  assert.ok(['take','buy','reserve','discard','noble','pass'].includes(observed.events.at(-1).type));
  assert.equal(room.aiStatus.source,'llm-advanced-fallback');
  assert.equal(room.aiStatus.reasonCode,'AI_ADAPTER_ERROR');
});
test('advanced observations and plans are cleared on reset, deletion, expiry and close',t=>{
  const tracked=()=>{
    const value=setup(t,{llmConfig});
    value.store.addAI(value.host,'llm-advanced');
    value.store.start(value.host);
    const observer=value.room.players.find(player=>player.mode==='llm-advanced');
    value.store.action(value.host,{version:value.room.version,action:{type:'take',gems:{white:1}}});
    value.store.advancedPlans.set(value.room.gameId,observer.id,{primaryTarget:'target',expectedActions:['take red']});
    return {...value,observer};
  };
  const reset=tracked();
  const resetGameId=reset.room.gameId;
  reset.store.finish(reset.host);reset.store.reset(reset.host);
  assert.equal(reset.store.advancedObservations.has(resetGameId,reset.observer.id),false);
  assert.equal(reset.store.advancedPlans.has(resetGameId,reset.observer.id),false);

  const deleted=tracked();
  const deletedGameId=deleted.room.gameId;
  deleted.store.leave(deleted.host);deleted.store.leave(deleted.guest);
  assert.equal(deleted.store.rooms.has(deleted.room.code),false);
  assert.equal(deleted.store.advancedObservations.has(deletedGameId,deleted.observer.id),false);
  assert.equal(deleted.store.advancedPlans.has(deletedGameId,deleted.observer.id),false);

  const expired=tracked();
  const expiredGameId=expired.room.gameId;
  expired.room.updatedAt=Date.now()-13*60*60*1000;expired.store.sweep();
  assert.equal(expired.store.advancedObservations.has(expiredGameId,expired.observer.id),false);
  assert.equal(expired.store.advancedPlans.has(expiredGameId,expired.observer.id),false);

  const closed=tracked();
  const closedGameId=closed.room.gameId;
  closed.store.close();
  assert.equal(closed.store.advancedObservations.has(closedGameId,closed.observer.id),false);
  assert.equal(closed.store.advancedPlans.has(closedGameId,closed.observer.id),false);
});
test('basic and local-only rooms do not create advanced observation buckets',t=>{
  const {store,host,room}=setup(t);
  store.addAI(host,'local-simple');store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  assert.equal(store.advancedObservations.size,0);
});
test('unexpected AI adapter exception falls back once without stopping the game',async t=>{
  let calls=0;const {store,host,guest,room}=setup(t,{aiDelay:1,llmConfig,aiChoose:async()=>{calls++;throw new Error('adapter failed');}});
  store.leave(guest);store.addAI(host,'llm-basic');store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await delay(80);
  assert.equal(calls,1);
  assert.equal(room.game.turn,0);
  assert.equal(room.aiStatus.source,'llm-basic-fallback');
  assert.equal(room.aiStatus.reasonCode,'AI_ADAPTER_ERROR');
});
test('AI waits for an online human and resumes once connected',async t=>{
  let calls=0;const {store,host,guest,room}=setup(t,{aiDelay:1,llmConfig,aiChoose:async(g,id,actions)=>{calls++;return {action:actions[0],source:'llm-basic'};}});
  store.leave(guest);store.addAI(host,'llm-basic');store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await delay(30);assert.equal(calls,0);
  store.attach(host,new Stream());await delay(80);assert.equal(calls,1);assert.equal(room.game.turn,0);
});

test('AI status exposes safe adapter metadata without provider bodies or keys',async t=>{
  const {store,host,guest,room}=setup(t,{aiDelay:1,llmConfig,aiChoose:async(_g,_id,actions)=>({
    action:actions[0],source:'llm-basic-fallback',reasonCode:'LLM_HTTP_503',notice:'LLM 本回合不可用，已由本地策略完成。',
  })});
  store.leave(guest);store.addAI(host,'llm-basic');store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await delay(80);
  assert.equal(room.aiStatus.reasonCode,'LLM_HTTP_503');
  assert.equal(room.aiStatus.source,'llm-basic-fallback');
  assert.match(room.aiStatus.notice,/本地策略/);
  assert.ok(!JSON.stringify(room.aiStatus).includes(llmConfig.apiKey));
  assert.equal(Object.hasOwn(room.aiStatus,'body'),false);
});

test('only the host can force finish a game and return the room to the lobby',t=>{
  const {store,host,guest,room}=setup(t);store.start(host);
  room.game.players[0].score=8;room.game.players[1].score=3;
  assert.throws(()=>store.finish(guest),/房主/);
  store.finish(host);
  assert.equal(room.game.status,'finished');assert.equal(room.game.endReason,'host');
  assert.deepEqual(room.game.winners,[host.id]);assert.equal(room.game.players[0].score,8);
  assert.equal(room.aiTask,null);
  store.reset(host);assert.equal(room.game,null);assert.equal(room.players.length,2);
});

test('host ending during an AI request aborts it and rejects the late decision',async t=>{
  let resolveDecision,started;
  const start=new Promise(resolve=>{started=resolve;});
  const {store,host,guest,room}=setup(t,{aiDelay:1,llmConfig,aiChoose:async(g,id,actions)=>{
    started();return new Promise(resolve=>{resolveDecision=()=>resolve({action:actions[0],source:'local'});});
  }});
  store.leave(guest);store.addAI(host,'llm-basic');store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await Promise.race([start,delay(1000).then(()=>{throw new Error('AI did not start');})]);
  const task=room.aiTask;store.finish(host);
  const version=room.version;const finished=structuredClone(room.game);
  assert.equal(task.abort.signal.aborted,true);resolveDecision();await delay(10);
  assert.equal(room.version,version);assert.deepEqual(room.game,finished);
});
