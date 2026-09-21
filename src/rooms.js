import { randomBytes, randomInt } from 'node:crypto';
import { createGame, applyAction, legalActions, viewGame, endGame } from './game.js';
import { chooseAIAction, localAction } from './ai.js';
import { chooseLocalDifficultyAction } from './local-ai.js';
import { AdvancedObservationMemory, AdvancedPlanMemory } from './ai-advanced-context.js';
import { createEndSnapshot, ReflectionCoordinator } from './ai-reflection.js';
import { chooseAdvancedAction } from './ai-advanced.js';
import { publicLlmConfig } from './llm-config.js';

const DISABLED_LLM_CONFIG=Object.freeze({enabled:false,model:undefined,advancedModel:undefined,reflectionModel:undefined});

const fail=message=>{throw new Error(message);};
const nameOf=value=>{
  if(typeof value!=='string') fail('请输入昵称');
  const name=value.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,24);
  if(!name) fail('昵称不能为空');
  return name;
};

export class RoomStore {
  constructor({llmConfig=DISABLED_LLM_CONFIG,aiDelay=900,aiChoose=chooseAIAction,advancedChoose=chooseAdvancedAction,memoryStore,fetchImpl,reflectionBarrierMs=60000,reflectionTimeoutMs=20000}={}) {
    this.sessions=new Map();this.rooms=new Map();this.llmConfig=llmConfig;this.aiDelay=aiDelay;this.aiChoose=aiChoose;this.advancedChoose=advancedChoose;
    this.reflectionBarrierMs=reflectionBarrierMs;this.reflectionBarrierEnabled=Boolean(memoryStore);
    this.advancedObservations=new AdvancedObservationMemory();this.advancedPlans=new AdvancedPlanMemory();this.reflection=new ReflectionCoordinator({ llmConfig, ...(memoryStore ? { store: memoryStore } : {}), ...(fetchImpl ? { fetchImpl } : {}), timeoutMs: reflectionTimeoutMs });
    this.cleanup=setInterval(()=>this.sweep(),60000);this.cleanup.unref();
  }
  close(){clearInterval(this.cleanup);for(const r of this.rooms.values()){this.cancelAI(r);this.clearAdvancedMemory(r);}for(const s of this.sessions.values())for(const stream of s.streams)stream.end();}
  session(token){const s=this.sessions.get(token);if(s)s.seen=Date.now();return s;}
  register(token,name){
    let s=this.session(token);
    const clean=nameOf(name);
    if(!s){
      if(this.sessions.size>=2000)fail('服务暂时繁忙');
      token=randomBytes(32).toString('hex');s={token,id:randomBytes(12).toString('hex'),name:clean,roomCode:null,streams:new Set(),seen:Date.now()};this.sessions.set(token,s);
    }
    s.name=clean;const room=this.room(s);
    if(room){const p=room.players.find(p=>p.id===s.id);if(p)p.name=clean;const gp=room.game?.players.find(p=>p.id===s.id);if(gp)gp.name=clean;this.publish(room);}
    return s;
  }
  room(s){return this.rooms.get(s.roomCode)||null;}
  requireRoom(s){return this.room(s)||fail('你还没有加入房间');}
  requireHost(s){const room=this.requireRoom(s);if(room.hostId!==s.id)fail('只有房主可以操作');return room;}
  snapshot(s){
    const r=this.room(s);
    return {me:{id:s.id,name:s.name},llmAvailable:this.llmConfig.enabled===true,llmModels:publicLlmConfig(this.llmConfig),room:r?{
      code:r.code,hostId:r.hostId,version:r.version,createdAt:r.createdAt,
      players:r.players.map(p=>({id:p.id,name:p.name,ai:p.ai,mode:p.mode,online:p.ai||!!this.sessions.get(p.token)?.streams.size})),
      settings:r.settings,
      game:r.game?viewGame(r.game,s.id):null,
      legalActions:r.game?legalActions(r.game,s.id):[],
      aiStatus:r.aiStatus,reflectionStatus:r.reflectionStatus,
    }:null};
  }
  send(s){const data=`data: ${JSON.stringify(this.snapshot(s))}\n\n`;for(const stream of s.streams){if(!stream.destroyed){if(stream.writableLength>256000)stream.destroy();else stream.write(data);}}}
  publish(room){room.updatedAt=Date.now();for(const p of room.players){const s=this.sessions.get(p.token);if(s)this.send(s);}this.scheduleAI(room);}
  attach(s,stream){
    if(s.streams.size>=5)fail('同一浏览器打开的页面过多，请关闭部分页面');
    s.streams.add(stream);s.seen=Date.now();const r=this.room(s);if(r)this.publish(r);else this.send(s);
    stream.on('close',()=>{s.streams.delete(stream);s.seen=Date.now();const r=this.room(s);if(r)this.publish(r);});
  }
  create(s){
    if(this.room(s))fail('请先离开当前房间');if(this.rooms.size>=100)fail('房间数量已达上限');
    let code;do{code=String(randomInt(100000,1000000));}while(this.rooms.has(code));
    const r={code,hostId:s.id,players:[this.human(s)],settings:{finishScore:15,turnOrder:[s.id]},game:null,gameId:null,version:0,banned:new Set(),createdAt:Date.now(),updatedAt:Date.now(),aiStatus:null,reflectionStatus:null,aiTask:null};
    this.rooms.set(code,r);s.roomCode=code;this.publish(r);
  }
  human(s){return {id:s.id,name:s.name,token:s.token,ai:false,mode:'human'};}
  join(s,code){
    if(typeof code!=='string'||!/^\d{6}$/.test(code))fail('请输入 6 位房间号');
    const r=this.rooms.get(code);if(!r)fail('房间不存在或已关闭');
    if(this.room(s)===r)return;
    if(this.room(s))fail('请先离开当前房间');if(r.banned.has(s.id))fail('你已被移出此房间');
    if(r.game)fail('对局已经开始，暂时不能加入');if(r.players.length>=4)fail('房间已满（最多 4 人）');
    r.players.push(this.human(s));r.settings.turnOrder.push(s.id);s.roomCode=code;r.version++;this.publish(r);
  }
  addAI(s,mode='llm-basic'){
    const r=this.requireHost(s);if(r.game)fail('请在准备大厅邀请 AI');if(r.players.length>=4)fail('房间已满');
    if(mode==='local')mode='local-simple';
    if(!['llm-basic','llm-advanced','local-simple','local-normal','local-hard','local-hell'].includes(mode))fail('未知 AI 类型');
    if(mode.startsWith('llm-')&&!this.llmConfig.enabled)fail('服务端尚未启用 LLM 配置');
    const names=['阿尔托','卢米','翡翠','奥罗'];const name=names.find(n=>!r.players.some(p=>p.name===n))||'宝石商人';
    const id=randomBytes(12).toString('hex');r.players.push({id,name,ai:true,mode});r.settings.turnOrder.push(id);r.version++;this.publish(r);
  }
  start(s){
    const r=this.requireHost(s);if(r.startTask)return r.startTask;if(r.game)fail('对局已经开始');if(r.players.length<2)fail('至少需要 2 位玩家，可以邀请 AI');
    const begin=(status=null)=>{
      if(this.rooms.get(r.code)!==r||r.game||r.hostId!==s.id){r.startTask=null;return;}
      r.settings.turnOrder=r.settings.turnOrder.filter(id=>r.players.some(p=>p.id===id));
      r.players.forEach(p=>{if(!r.settings.turnOrder.includes(p.id))r.settings.turnOrder.push(p.id);});
      r.game=createGame(r.players.map(({id,name,ai})=>({id,name,ai})),r.settings);r.gameId=randomBytes(12).toString('hex');r.version++;r.aiStatus=status;r.reflectionStatus=null;r.startTask=null;this.publish(r);
    };
    const advanced=r.players.some(p=>p.ai&&p.mode==='llm-advanced') && this.reflectionBarrierEnabled;
    const pending=advanced?this.reflection.pendingJobsSync():[];
    if(!pending.length){begin();return;}
    r.aiStatus={state:'syncing',source:'llm-advanced',mode:'llm-advanced',notice:'正在同步高级 AI 的历史经验…'};this.publish(r);
    const task=this.reflection.waitForPending({key:this.llmConfig.apiKey,timeoutMs:this.reflectionBarrierMs}).catch(()=>({status:'sync_failed'})).then(result=>{
      const status=result.status==='synced'?null:result.status==='sync_failed'
        ?{state:'sync_failed',source:'llm-advanced',mode:'llm-advanced',continueWithPrevious:true,notice:'经验同步失败，继续使用上次经验。'}
        :{state:'memory_busy',source:'llm-advanced',mode:'llm-advanced',continueWithPrevious:true,notice:'经验同步超时，继续使用上次经验。'};
      begin(status);
    });
    r.startTask=task;
    return task;
  }
  settingsUpdate(s,body={}){const r=this.requireHost(s);if(r.game)fail('对局开始后不能修改设置');const score=body.finishScore===undefined?r.settings.finishScore:Number(body.finishScore);if(!Number.isInteger(score)||score<5||score>30)fail('结束分数需为 5-30 的整数');const ids=r.players.map(p=>p.id);const order=body.turnOrder||r.settings.turnOrder;if(!Array.isArray(order)||order.length!==ids.length||new Set(order).size!==ids.length||order.some(id=>!ids.includes(id)))fail('轮换顺序无效');r.settings={finishScore:score,turnOrder:[...order]};r.version++;this.publish(r);}
  reset(s){const r=this.requireHost(s);if(r.game?.status!=='finished')fail('请完成本局后再返回大厅');this.cancelAI(r);this.advancedObservations.clear(r.gameId);this.advancedPlans.clear(r.gameId);r.game=null;r.gameId=null;r.aiStatus=null;r.reflectionStatus=null;r.version++;this.publish(r);}
  finish(s){const r=this.requireHost(s);const before=r.game;const game=endGame(before);this.recordAdvancedObservation(r,before,game,before.players[before.turn]?.id,{type:'finish'});this.cancelAI(r);r.game=game;r.aiStatus=null;r.reflectionStatus={state:'syncing',status:'syncing'};r.version++;this.queueReflection(r);this.publish(r);}
  queueReflection(r){if(r.game?.status!=='finished'||!r.gameId||!r.players.some(p=>p.ai&&p.mode==='llm-advanced'))return;const snapshot=createEndSnapshot(r.game,{gameId:r.gameId,players:r.players});void this.reflection.enqueue(snapshot).then(()=>this.reflection.recoverPending({key:this.llmConfig.apiKey})).then(results=>{const failed=results.some(item=>item?.status==='failed');r.reflectionStatus={state:failed?'failed':'saved',status:failed?'failed':'saved',lessons:results.reduce((n,item)=>n+(item?.lessons||0),0)};this.publish(r);}).catch(()=>{r.reflectionStatus={state:'failed',status:'failed'};this.publish(r);});}
  kick(s,id){const r=this.requireHost(s);if(id===s.id)fail('不能踢出自己，请使用离开房间');this.remove(r,id,true);}
  leave(s){const r=this.requireRoom(s);this.remove(r,s.id,false);}
  remove(r,id,kicked){
    const index=r.players.findIndex(p=>p.id===id);if(index<0)fail('玩家不在房间中');const p=r.players[index];
    if(r.game?.status==='playing'&&p.ai)fail('进行中的 AI 席位需要保留到本局结束');
    this.cancelAI(r);const s=this.sessions.get(p.token);
    if(s){s.roomCode=null;if(kicked)r.banned.add(s.id);this.send(s);}
    if(r.game?.status==='playing'){
      const bot={id:p.id,name:`托管·${p.name}`.slice(0,24),ai:true,mode:'local'};r.players[index]=bot;
      const gp=r.game.players.find(x=>x.id===id);gp.ai=true;gp.name=bot.name;
      r.game.log.push({playerId:id,text:`${p.name} 已离开，本地策略接管席位`});
    }else {r.players.splice(index,1);r.settings.turnOrder=r.settings.turnOrder.filter(x=>x!==id);}
    if(r.hostId===id)r.hostId=r.players.find(x=>!x.ai)?.id||null;
    if(!r.players.some(x=>!x.ai)){this.clearAdvancedMemory(r);this.rooms.delete(r.code);return;}
    r.version++;this.publish(r);
  }
  action(s,{version,action}={}){
    const r=this.requireRoom(s);if(!r.game)fail('对局尚未开始');if(version!==r.version)fail('局面已更新，请根据最新局面重新操作');
    const before=r.game,after=applyAction(before,s.id,action);this.recordAdvancedObservation(r,before,after,s.id,action);r.game=after;r.version++;r.aiStatus=null;this.queueReflection(r);this.publish(r);
  }
  recordAdvancedObservation(r,before,after,actorId,action){
    if(!r.gameId)return;
    for(const observer of r.players.filter(player=>player.ai&&player.mode==='llm-advanced'))
      this.advancedObservations.record({gameId:r.gameId,observerId:observer.id,before,after,actorId,action});
  }
  clearAdvancedMemory(r){if(r.gameId){this.advancedObservations.clear(r.gameId);this.advancedPlans.clear(r.gameId);}}
  async chooseForAI(r,p,actions,signal){
    const mode=p.mode==='local'?'local-simple':p.mode;
    const options={llmConfig:mode.startsWith('llm-')?this.llmConfig:undefined,signal,gameId:r.gameId,observationMemory:this.advancedObservations,planMemory:this.advancedPlans};
    if(r.game.pending&&(mode==='llm-basic'||mode==='local-simple'))return {action:localAction(r.game,p.id,actions),source:mode};
    if(mode==='llm-basic')return this.aiChoose(r.game,p.id,actions,options);
    if(mode==='llm-advanced'){
      try {
        const memory=await this.reflection.store.readMemory();
        options.experiences=(memory.lessons||[]).filter(lesson=>lesson.status!=='retired').slice(-8).map(lesson=>({id:lesson.id,text:lesson.recommendation||lesson.trigger||''}));
      } catch { options.experiences=[]; }
      return this.advancedChoose(r.game,p.id,actions,options);
    }
    if(mode==='local-simple')return {action:localAction(r.game,p.id,actions),source:mode};
    const difficulty={'local-normal':'normal','local-hard':'hard','local-hell':'hell'}[mode];
    if(!difficulty)fail('未知 AI 类型');
    return {action:chooseLocalDifficultyAction(r.game,p.id,actions,{difficulty}),source:mode};
  }
  cancelAI(r){if(r.aiTask){clearTimeout(r.aiTask.timer);r.aiTask.abort.abort();r.aiTask=null;}}
  scheduleAI(r){
    if(this.rooms.get(r.code)!==r||r.aiTask||r.game?.status!=='playing')return;
    if(!r.players.some(p=>!p.ai&&this.sessions.get(p.token)?.streams.size))return;
    const p=r.players.find(p=>p.id===r.game.players[r.game.turn].id);if(!p?.ai)return;
    const task={abort:new AbortController(),timer:null};r.aiTask=task;
    task.timer=setTimeout(async()=>{
      const version=r.version;
      try{
        const actions=legalActions(r.game,p.id);if(!actions.length)return;
        r.aiStatus={playerId:p.id,state:'thinking',source:p.mode,mode:p.mode};for(const player of r.players){const s=this.sessions.get(player.token);if(s)this.send(s);}
        const result=await this.chooseForAI(r,p,actions,task.abort.signal);
        if(task.abort.signal.aborted||r.version!==version||this.rooms.get(r.code)!==r)return;
        const before=r.game,after=applyAction(before,p.id,result.action);this.recordAdvancedObservation(r,before,after,p.id,result.action);r.game=after;r.version++;this.queueReflection(r);
        r.aiStatus={playerId:p.id,state:'done',source:result.source,mode:p.mode,reasonCode:result.reasonCode,notice:result.notice,cacheHitTokens:result.cacheHitTokens};
        if(result.notice)r.game.log.push({playerId:p.id,text:result.notice});
      }catch{
        if(task.abort.signal.aborted||r.version!==version||this.rooms.get(r.code)!==r)return;
        try{
          const actions=legalActions(r.game,p.id);
          const action=localAction(r.game,p.id,actions),before=r.game,after=applyAction(before,p.id,action);this.recordAdvancedObservation(r,before,after,p.id,action);r.game=after;r.version++;this.queueReflection(r);
          const notice='AI 本回合决策异常，已由本地策略完成。';
          const source=p.mode==='llm-advanced'?'llm-advanced-fallback':p.mode==='llm-basic'?'llm-basic-fallback':'local-fallback';
          r.aiStatus={playerId:p.id,state:'done',source,mode:p.mode,reasonCode:'AI_ADAPTER_ERROR',notice};
          r.game.log.push({playerId:p.id,text:notice});
        }catch{r.aiStatus={playerId:p.id,state:'error',mode:p.mode,notice:'AI 暂停：当前局面无法执行合法动作，请检查服务端规则。'};}
      }
      finally{if(r.aiTask===task){r.aiTask=null;if(r.aiStatus?.state!=='error')this.publish(r);else for(const player of r.players){const s=this.sessions.get(player.token);if(s)this.send(s);}}}
    },this.aiDelay);task.timer.unref();
  }
  sweep(){
    const now=Date.now();
    for(const [code,r] of this.rooms){if(now-r.updatedAt>12*60*60*1000&&!r.players.some(p=>this.sessions.get(p.token)?.streams.size)){this.cancelAI(r);this.clearAdvancedMemory(r);this.rooms.delete(code);for(const p of r.players){const s=this.sessions.get(p.token);if(s)s.roomCode=null;}}}
    for(const [token,s] of this.sessions)if(!s.roomCode&&!s.streams.size&&now-s.seen>60*60*1000)this.sessions.delete(token);
  }
}
