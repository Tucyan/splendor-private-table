import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {RoomStore} from '../src/rooms.js';

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
test('online state handles multiple tabs, disconnection and reconnection',t=>{
  const {store,host,guest}=setup(t);const a=new Stream(),b=new Stream();
  store.attach(guest,a);store.attach(guest,b);
  assert.equal(store.snapshot(host).room.players[1].online,true);
  a.end();assert.equal(store.snapshot(host).room.players[1].online,true);
  b.end();assert.equal(store.snapshot(host).room.players[1].online,false);
  store.attach(guest,new Stream());assert.equal(store.snapshot(host).room.players[1].online,true);
});
test('duplicate action version cannot spend gems twice, and a reconnect retains seat',t=>{
  const {store,host,room}=setup(t);store.start(host);
  const version=room.version;store.action(host,{version,action:{type:'take',gems:{white:1}}});
  assert.throws(()=>store.action(host,{version,action:{type:'take',gems:{white:1}}}),/更新/);
  assert.equal(room.game.players[0].gems.white,1);
  assert.equal(store.register(host.token,'新名').roomCode,room.code);
});
test('unexpected AI adapter exception falls back once without stopping the game',async t=>{
  let calls=0;const {store,host,guest,room}=setup(t,{aiDelay:1,aiKey:'test',aiChoose:async()=>{calls++;throw new Error('adapter failed');}});
  store.leave(guest);store.addAI(host,'deepseek');store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await delay(80);
  assert.equal(calls,1);
  assert.equal(room.game.turn,0);
  assert.equal(room.aiStatus.source,'fallback');
});
test('AI waits for an online human and resumes once connected',async t=>{
  let calls=0;const {store,host,guest,room}=setup(t,{aiDelay:1,aiChoose:async(g,id,actions)=>{calls++;return {action:actions[0],source:'local'};}});
  store.leave(guest);store.addAI(host,'local');store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await delay(30);assert.equal(calls,0);
  store.attach(host,new Stream());await delay(80);assert.equal(calls,1);assert.equal(room.game.turn,0);
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
  const {store,host,guest,room}=setup(t,{aiDelay:1,aiChoose:async(g,id,actions)=>{
    started();return new Promise(resolve=>{resolveDecision=()=>resolve({action:actions[0],source:'local'});});
  }});
  store.leave(guest);store.addAI(host,'local');store.attach(host,new Stream());store.start(host);
  store.action(host,{version:room.version,action:{type:'take',gems:{white:1}}});
  await Promise.race([start,delay(1000).then(()=>{throw new Error('AI did not start');})]);
  const task=room.aiTask;store.finish(host);
  const version=room.version;const finished=structuredClone(room.game);
  assert.equal(task.abort.signal.aborted,true);resolveDecision();await delay(10);
  assert.equal(room.version,version);assert.deepEqual(room.game,finished);
});
