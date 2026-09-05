import { randomBytes, randomInt } from 'node:crypto';
import { createGame, applyAction, legalActions, viewGame, endGame } from './game.js';
import { chooseAIAction, localAction } from './ai.js';

const fail=message=>{throw new Error(message);};
const nameOf=value=>{
  if(typeof value!=='string') fail('请输入昵称');
  const name=value.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,24);
  if(!name) fail('昵称不能为空');
  return name;
};

export class RoomStore {
  constructor({aiKey=process.env.deepseekkey||process.env.DEEPSEEK_API_KEY||'',aiDelay=900,aiChoose=chooseAIAction}={}) {
    this.sessions=new Map();this.rooms=new Map();this.aiKey=aiKey;this.aiDelay=aiDelay;this.aiChoose=aiChoose;
    this.cleanup=setInterval(()=>this.sweep(),60000);this.cleanup.unref();
  }
  close(){clearInterval(this.cleanup);for(const r of this.rooms.values())this.cancelAI(r);for(const s of this.sessions.values())for(const stream of s.streams)stream.end();}
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
    return {me:{id:s.id,name:s.name},aiAvailable:!!this.aiKey,room:r?{
      code:r.code,hostId:r.hostId,version:r.version,createdAt:r.createdAt,
      players:r.players.map(p=>({id:p.id,name:p.name,ai:p.ai,mode:p.mode,online:p.ai||!!this.sessions.get(p.token)?.streams.size})),
      game:r.game?viewGame(r.game,s.id):null,
      legalActions:r.game?legalActions(r.game,s.id):[],
      aiStatus:r.aiStatus,
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
    const r={code,hostId:s.id,players:[this.human(s)],game:null,version:0,banned:new Set(),createdAt:Date.now(),updatedAt:Date.now(),aiStatus:null,aiTask:null};
    this.rooms.set(code,r);s.roomCode=code;this.publish(r);
  }
  human(s){return {id:s.id,name:s.name,token:s.token,ai:false,mode:'human'};}
  join(s,code){
    if(typeof code!=='string'||!/^\d{6}$/.test(code))fail('请输入 6 位房间号');
    const r=this.rooms.get(code);if(!r)fail('房间不存在或已关闭');
    if(this.room(s)===r)return;
    if(this.room(s))fail('请先离开当前房间');if(r.banned.has(s.id))fail('你已被移出此房间');
    if(r.game)fail('对局已经开始，暂时不能加入');if(r.players.length>=4)fail('房间已满（最多 4 人）');
    r.players.push(this.human(s));s.roomCode=code;r.version++;this.publish(r);
  }
  addAI(s,mode='deepseek'){
    const r=this.requireHost(s);if(r.game)fail('请在准备大厅邀请 AI');if(r.players.length>=4)fail('房间已满');
    if(!['deepseek','local'].includes(mode))fail('未知 AI 类型');if(mode==='deepseek'&&!this.aiKey)fail('服务端尚未配置 DeepSeek 密钥');
    const names=['阿尔托','卢米','翡翠','奥罗'];const name=names.find(n=>!r.players.some(p=>p.name===n))||'宝石商人';
    r.players.push({id:randomBytes(12).toString('hex'),name,ai:true,mode});r.version++;this.publish(r);
  }
  start(s){
    const r=this.requireHost(s);if(r.game)fail('对局已经开始');if(r.players.length<2)fail('至少需要 2 位玩家，可以邀请 AI');
    r.game=createGame(r.players.map(({id,name,ai})=>({id,name,ai})));r.version++;r.aiStatus=null;this.publish(r);
  }
  reset(s){const r=this.requireHost(s);if(r.game?.status!=='finished')fail('请完成本局后再返回大厅');this.cancelAI(r);r.game=null;r.aiStatus=null;r.version++;this.publish(r);}
  finish(s){const r=this.requireHost(s);const game=endGame(r.game);this.cancelAI(r);r.game=game;r.aiStatus=null;r.version++;this.publish(r);}
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
    }else r.players.splice(index,1);
    if(r.hostId===id)r.hostId=r.players.find(x=>!x.ai)?.id||null;
    if(!r.players.some(x=>!x.ai)){this.rooms.delete(r.code);return;}
    r.version++;this.publish(r);
  }
  action(s,{version,action}={}){
    const r=this.requireRoom(s);if(!r.game)fail('对局尚未开始');if(version!==r.version)fail('局面已更新，请根据最新局面重新操作');
    r.game=applyAction(r.game,s.id,action);r.version++;r.aiStatus=null;this.publish(r);
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
        r.aiStatus={playerId:p.id,state:'thinking',source:p.mode};for(const player of r.players){const s=this.sessions.get(player.token);if(s)this.send(s);}
        const result=r.game.pending?{action:localAction(r.game,p.id,actions),source:p.mode}:
          await this.aiChoose(r.game,p.id,actions,{key:p.mode==='deepseek'?this.aiKey:'',signal:task.abort.signal});
        if(task.abort.signal.aborted||r.version!==version||this.rooms.get(r.code)!==r)return;
        r.game=applyAction(r.game,p.id,result.action);r.version++;
        r.aiStatus={playerId:p.id,state:'done',source:result.source,notice:result.notice,cacheHitTokens:result.cacheHitTokens};
        if(result.notice)r.game.log.push({playerId:p.id,text:result.notice});
      }catch{
        if(task.abort.signal.aborted||r.version!==version||this.rooms.get(r.code)!==r)return;
        try{
          const actions=legalActions(r.game,p.id);
          r.game=applyAction(r.game,p.id,localAction(r.game,p.id,actions));r.version++;
          const notice='AI 本回合决策异常，已由本地策略完成。';
          r.aiStatus={playerId:p.id,state:'done',source:'fallback',notice};
          r.game.log.push({playerId:p.id,text:notice});
        }catch{r.aiStatus={playerId:p.id,state:'error',notice:'AI 暂停：当前局面无法执行合法动作，请检查服务端规则。'};}
      }
      finally{if(r.aiTask===task){r.aiTask=null;if(r.aiStatus?.state!=='error')this.publish(r);else for(const player of r.players){const s=this.sessions.get(player.token);if(s)this.send(s);}}}
    },this.aiDelay);task.timer.unref();
  }
  sweep(){
    const now=Date.now();
    for(const [code,r] of this.rooms){if(now-r.updatedAt>12*60*60*1000&&!r.players.some(p=>this.sessions.get(p.token)?.streams.size)){this.cancelAI(r);this.rooms.delete(code);for(const p of r.players){const s=this.sessions.get(p.token);if(s)s.roomCode=null;}}}
    for(const [token,s] of this.sessions)if(!s.roomCode&&!s.streams.size&&now-s.seen>60*60*1000)this.sessions.delete(token);
  }
}
