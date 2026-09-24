import {captureTableEffects} from './table-effects.js';
import {gem} from './gems.js';
import {bindRoomSettings} from './room-settings.js';
import {canAffordCard,purchaseGap,discountedCost,nobleGap} from './player-view.js';
import {createLongPressTracker,createTouchSwipeTracker,marketViewIndex,shouldShowContextTooltip,swipePageIndex} from './mobile-interactions.js';
import {createSoundPlayer,stateSoundCues} from './sound-effects.js';
import {reflectionStatusView} from './reflection-status.js';
import {publicPlayerGrid,publicPlayerSummary} from './player-summary.js';

const basePath=new URL('.',import.meta.url).pathname;
const appPath=(path='')=>basePath+path.replace(/^\/+/, '');

const $=s=>document.querySelector(s);
const COLORS=['white','blue','green','red','black'];
const ALL=[...COLORS,'gold'];
const NAMES={white:'钻石',blue:'蓝宝石',green:'祖母绿',red:'红宝石',black:'缟玛瑙',gold:'黄金'};
const AI_MODE_NAMES={'llm-basic':'LLM · 基础','llm-advanced':'LLM · 高级','local-beginner':'本地 · 新手','local-simple':'本地 · 简单','local-normal':'本地 · 普通','local-hard':'本地 · 困难','local-hell':'本地 · 地狱'};
const REASONING_EFFORT_NAMES={off:'关闭',low:'低',high:'高',max:'最高'};
const aiModeName=mode=>AI_MODE_NAMES[mode==='local'?'local-simple':mode]||'AI 商人';
const AI_OPTIONS=[
  {mode:'local-beginner',name:'本地 · 新手',detail:'适合初次练习 · 只按简单规则拿宝石和买牌'},
  {mode:'local-simple',name:'本地 · 简单',detail:'本地运行 · 简单策略'},
  {mode:'local-normal',name:'本地 · 普通',detail:'本地局面评估 · 无需密钥'},
  {mode:'local-hard',name:'本地 · 困难',detail:'更多局面推演 · 无需密钥'},
  {mode:'local-hell',name:'本地 · 地狱',detail:'可预知真实牌序 · 无需密钥'},
  {mode:'llm-basic',name:'LLM · 基础',detail:'依据当前局面决策 · 无历史记忆',requiresKey:true},
  {mode:'llm-advanced',name:'LLM · 高级',detail:'独立高级决策路径 · 依据当前局面',requiresKey:true},
];
const MOBILE_TABLE_QUERY='(max-width:1099px), (max-width:1199px) and (max-height:649px)';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=o=>Object.values(o||{}).reduce((a,b)=>a+b,0);
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
let state=null,connected=false,busy=false,selection={},source,dialogKind=null,lastVersion=null;
let hintCode=new URLSearchParams(location.search).get('room')||'';
let toastTimer;
let mobileMarketView=0,marketScrollTimer=null,suppressLongPressClick=null,longPressShown=false;
let mobileTableLayout=matchMedia(MOBILE_TABLE_QUERY).matches;
let scoreDraft=null;
let settingsExpanded=false;
let soundMuted=storage.get('splendor.sound-muted')==='true';
const soundPlayer=createSoundPlayer({assetBase:new URL('./assets/audio/',import.meta.url),isMuted:()=>soundMuted});

function icon(name){const shapes={arrow:'M5 12h14m-6-6 6 6-6 6',copy:'M9 9h11v12H9zM15 9V3H3v12h6',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m11 10v-2a4 4 0 0 0-3-4m0-12a4 4 0 0 1 0 8',bot:'M5 7h14v13H5zM12 3v4M8 12h1m6 0h1M9 16h6M2 11v5m20-5v5',crown:'M3 7l5 4 4-7 4 7 5-4-3 12H6z',close:'m6 6 12 12M6 18 18 6',book:'M12 5v16M12 5C8 2 4 3 2 4v15c5-2 8-1 10 2 2-3 5-4 10-2V4c-3-1-6-2-10 1',exit:'M9 4H4v16h5m4-12 4 4-4 4m-5-4h13',check:'m5 12 4 4 10-10',soundOn:'M11 5 6 9H3v6h3l5 4zM15 9a4 4 0 0 1 0 6m-4-8a8 8 0 0 1 0 12',soundOff:'M11 5 6 9H3v6h3l5 4zM16 10l5 5m0-5-5 5'};return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${shapes[name]||shapes.arrow}"/></svg>`;}
function nobleCardIcon(color,size=14){return `<svg class="noble-card-icon ${color}" width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true"><rect x="2.25" y=".75" width="9.5" height="12.5" rx="1.35" fill="currentColor"/><path d="M4 3.3h6M4 5.25h4.4M4 10.8h6" fill="none" stroke="#fff" stroke-width=".7" opacity=".42"/></svg>`;}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200);}

async function api(path,body){
  const res=await fetch(appPath(path),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'操作失败');return data;
}
function accept(next){
  const playEffects=captureTableEffects(state,next,{gem,cardHTML});
  const soundCues=stateSoundCues(state,next);
  const screen=x=>!x?.room?'home':x.room.game?'game':'lobby';
  const screenChanged=screen(state)!==screen(next);
  const key=next.room?`${next.room.code}:${next.room.version}`:'home';
  if(key!==lastVersion){selection={};lastVersion=key;if(dialogKind==='card')closeDialog();}
  const removed=state?.room&&!next.room;
  if(screenChanged||state?.room?.code!==next.room?.code)mobileMarketView=0;
  settingsControls.cancel();
  if(state?.room?.code!==next.room?.code||next.room?.game)settingsExpanded=false;
  if(state?.room?.code!==next.room?.code||next.room?.game||next.room?.hostId!==next.me.id)scoreDraft=null;
  state=next;render();playEffects();soundCues.forEach((cue,index)=>index?setTimeout(()=>soundPlayer.play(cue),420*index):soundPlayer.play(cue));if(screenChanged)window.scrollTo(0,0);if(removed)toast('你已离开房间');
}
async function mutate(path,body={}){
  if(busy)return;busy=true;document.body.classList.add('busy');
  try{accept(await api(path,body));}catch(e){toast(e.message);}finally{busy=false;document.body.classList.remove('busy');}
}
function connect(){
  source?.close();source=new EventSource(appPath('/api/events'));
  source.onopen=()=>{connected=true;renderConnection();};
  source.onmessage=e=>{connected=true;accept(JSON.parse(e.data));};
  source.onerror=()=>{connected=false;renderConnection();};
}
function renderConnection(){const el=$('#connection');if(el){el.className=`connection ${connected?'':'offline'}`;el.innerHTML=`<i></i>${connected?'已连接':'连接中…'}`;}}
function header(){return `<header class="header"><a class="brand" href="${esc(basePath)}" aria-label="璀璨宝石首页"><img src="./assets/mark.svg" width="31" height="31" alt=""><span>璀璨宝石<small>SPLENDOR · PRIVATE TABLE</small></span></a><nav><span id="connection" class="connection"><i></i>已连接</span><button class="text-btn sound-toggle" data-do="toggle-sound" aria-pressed="${!soundMuted}" aria-label="${soundMuted?'开启':'关闭'}音效" title="${soundMuted?'开启':'关闭'}音效">${icon(soundMuted?'soundOff':'soundOn')}<span>音效</span></button><button class="text-btn" data-do="rules">${icon('book')}<span>游戏规则</span></button><button class="profile" data-do="profile"><span class="avatar small">${esc(state.me.name.slice(0,1))}</span><span>${esc(state.me.name)}</span><span class="edit-mark">⌑</span></button></nav></header>`;}
function footer(){return `<footer><span>为相聚而开的一张桌</span><span>基础版 · 2–4 人 · 原创插画</span><span>SPLENDOR / 私人桌游室</span></footer>`;}
function cardHTML(card,{hero=false,disabled=false}={}){
  const art=['mine','harbor','estate'][card.level-1];
  const costs=COLORS.filter(c=>card.cost[c]).map(c=>`<span class="cost ${c}" title="${NAMES[c]} ${card.cost[c]}">${gem(c,15)}${card.cost[c]}</span>`).join('');
  const room=state?.room, me=room?.game?.players.find(p=>p.id===state.me.id);
  const affordable=!hero&&!disabled&&room?.game?.status==='playing'&&canAffordCard(me,card);
  const ready=affordable&&room.legalActions.some(a=>a.type==='buy'&&a.cardId===card.id);
  const badge=ready?'可购买':'可负担';
  return `<button class="dev-card level-${card.level} ${hero?'hero-card':''} ${affordable?'affordable':''}" ${disabled?'disabled':''} ${hero?'':`data-card="${esc(card.id)}"`} aria-label="${card.level}级${NAMES[card.bonus]}卡，${card.points}分，${COLORS.filter(c=>card.cost[c]).map(c=>NAMES[c]+card.cost[c]).join('、')}${affordable?'，'+badge:''}"><img class="card-art" src="./assets/${art}.svg" alt="" style="filter:hue-rotate(${COLORS.indexOf(card.bonus)*17-25}deg)"><div class="card-top"><span class="prestige">${card.points||'<span class="zero-point">·</span>'}</span><span class="bonus ${card.bonus}">${gem(card.bonus,30)}</span></div><div class="card-bottom"><div class="costs">${costs}</div><span class="card-place">${['山谷矿场','远洋商路','翡翠庄园'][card.level-1]}</span></div>${affordable?`<span class="affordability-badge">✓ ${badge}</span>`:''}</button>`;
}

function home(){
  const sample=[{id:'a',level:1,bonus:'blue',points:0,cost:{white:1,green:2,red:1}},{id:'b',level:3,bonus:'green',points:4,cost:{white:3,blue:3,red:6}},{id:'c',level:2,bonus:'red',points:2,cost:{blue:3,green:2,black:3}}];
  return `<main class="home"><section class="hero"><div class="hero-copy"><div class="eyebrow"><span></span> 你的私人桌游时光</div><h1>一颗宝石，<br>一场<span>黄金时代。</span></h1><p>从第一座矿场，到声名远扬的宝石帝国。<br>邀上三两好友，让每一次选择都闪闪发光。</p><div class="hero-meta"><span>${icon('users')} 2–4 位玩家</span><b>·</b><span>约 30 分钟</span><b>·</b><span>支持 AI 对手</span></div></div><div class="hero-visual" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="spark spark-one">✧</span><span class="spark spark-two">✦</span><div class="display-cards">${sample.map(c=>cardHTML(c,{hero:true,disabled:true})).join('')}</div><div class="visual-caption"><span>THE ART OF THE PERFECT MOVE</span><span>每一步，皆有光芒</span></div></div></section><section class="entry-panel"><div class="entry-intro"><span class="eyebrow">LET’S PLAY</span><h2>好局，从这里开始</h2><p>房间只属于你和受邀的朋友。</p></div><div class="entry-create"><label for="nickname">你的桌上昵称 <span>自动保存在此浏览器</span></label><div class="nickname-line"><span class="avatar small">${esc(state.me.name.slice(0,1))}</span><input id="nickname" maxlength="24" value="${esc(state.me.name)}" autocomplete="nickname" aria-label="你的昵称"></div><button class="btn primary full" data-do="create">创建房间 ${icon('arrow')}</button></div><div class="entry-divider"><span>或</span></div><form class="entry-join" id="join-form"><label for="room-code">朋友已经在等你？</label><input id="room-code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="输入 6 位房间号" value="${esc(hintCode)}" required><button class="btn secondary full" type="submit">加入房间 ${icon('arrow')}</button></form></section><section class="home-notes"><article>${gem('green',30)}<div><h3>熟悉的规则，随时开局</h3><p>完整基础版体验，无需下载客户端。</p></div></article><article>${icon('bot')}<div><h3>少一位朋友？让 LLM 入座</h3><p>邀请 LLM，一起切磋宝石生意。</p></div></article><article>${icon('users')}<div><h3>一个房间号，就是邀请函</h3><p>实时同步局面，刷新也能回到座位。</p></div></article></section></main>`;
}
function roomTop(lobby=false){const r=state.room;return `<section class="room-top"><div><div class="eyebrow">${lobby?'THE GATHERING':'THE GEM MERCHANTS'}</div><h1>${lobby?'入座，等好戏开场。':'宝石商人的会客厅'}${!lobby?`<span class="round-label">第 ${r.game.round} 轮</span>`:''}</h1></div><div class="room-tools"><button class="room-code" data-do="copy" title="复制房间号"><span>房间号</span><strong>${r.code}</strong>${icon('copy')}</button><button class="text-btn" data-do="invite">复制邀请链接</button>${r.game?.status==='playing'&&r.hostId===state.me.id?'<button class="text-btn end-game-button" data-do="finish">结束本局</button>':''}<button class="icon-btn" data-do="leave" title="离开房间">${icon('exit')}</button></div></section>`;}
function lobby(){
  const r=state.room,host=r.hostId===state.me.id;
  return `<main class="room-page">${roomTop(true)}${roomSettings()}<div class="lobby-heading"><h2>这一桌的朋友 <span>${r.players.length} / 4</span></h2><span class="muted">房主开始游戏后，按座位顺序轮流行动</span></div><section class="seats">${Array.from({length:4},(_,i)=>{
    const p=orderedPlayers(r)[i];
    return p?`<article class="seat ${p.id===state.me.id?'my-seat':''}"><span class="seat-number">0${i+1}</span>${host&&p.id!==state.me.id?`<button class="seat-kick icon-btn" data-kick="${p.id}" title="移出玩家">${icon('close')}</button>`:''}<div class="avatar large ${p.ai?'ai-avatar':''}">${p.ai?icon('bot'):esc(p.name.slice(0,1))}</div><h3>${esc(p.name)} ${p.id===state.me.id?'<small>你</small>':''}</h3><span class="status"><i class="${p.online?'':'off'}"></i>${p.ai?esc(aiModeName(p.mode)):(p.online?'在线，已入座':'离线，等待重连')}</span><span class="seat-role">${p.id===r.hostId?icon('crown')+' 房主':p.ai?'AI 对手':'宝石商人'}</span></article>`:`<article class="seat empty"><span class="seat-number">0${i+1}</span><div class="empty-symbol">＋</div><h3>虚位以待</h3><p>分享房间号，邀请一位朋友</p>${host?'<button class="btn subtle" data-do="add-ai">邀请 AI 入座</button>':'<span class="muted">等待房主邀请</span>'}</article>`;
  }).join('')}</section><section class="lobby-bottom"><div class="table-note">${gem('gold',32)}<div><strong>从零开始，积累你的第一份声望。</strong><p>购买卡牌建立折扣，吸引贵族。达到 ${r.settings?.finishScore||15} 分时进入最后一轮。</p></div></div>${host?`<button class="btn primary start-btn" data-do="start" ${r.players.length<2?'disabled':''}>${r.players.length<2?'等待至少 2 位玩家':'开始这一局'} ${icon('arrow')}</button>`:'<span class="waiting-text">等待房主开始游戏<span class="dots">…</span></span>'}</section><div class="lobby-footnote">${state.llmAvailable?'LLM 已就绪，可邀请 AI 加入对局。':'LLM 尚未配置。你仍可邀请本地 AI，或与朋友直接开局。'}</div></main>`;
}
function orderedPlayers(room){return (room.settings?.turnOrder||room.players.map(p=>p.id)).map(id=>room.players.find(p=>p.id===id)).filter(Boolean);}
function roomSettings(){
  const r=state.room,host=r.hostId===state.me.id,score=r.settings?.finishScore||15;
  return `<section class="room-settings ${settingsExpanded?'':'is-collapsed'}" aria-labelledby="settings-title"><button type="button" class="settings-toggle" data-do="toggle-settings" aria-expanded="${settingsExpanded}" aria-controls="settings-score settings-order"><strong id="settings-title">房间设置</strong><span>${score} 分结束 · ${settingsExpanded?'收起':'展开'} <b aria-hidden="true">${settingsExpanded?'⌃':'⌄'}</b></span></button>
    <div class="settings-score" id="settings-score" ${settingsExpanded?'':'hidden'}><h3>结束得分</h3>${host?`<form id="room-score-form"><label class="score-input" for="finish-score"><input id="finish-score" aria-label="结束分数" type="number" inputmode="numeric" min="5" max="30" step="1" required value="${esc(scoreDraft??score)}"><span>分</span></label><button class="btn subtle" type="submit">保存分数</button></form>`:`<strong class="score-readonly">${score} 分</strong>`}<p>达到目标后完成当前轮，每人回合数相同。</p><span class="settings-saved">当前 ${score} 分 · 默认 15 · 可设 5–30</span></div>
    <div class="settings-order" id="settings-order" ${settingsExpanded?'':'hidden'}><h3>轮换顺序 <small>${host?'拖动手柄排序 · 松手保存':'仅房主可调整'}</small></h3><ol class="turn-order" aria-label="轮换顺序">${orderedPlayers(r).map((p,i)=>`<li data-order-player="${esc(p.id)}"><span class="order-number">${String(i+1).padStart(2,'0')}</span><span class="avatar small ${p.ai?'ai-avatar':''}">${p.ai?icon('bot'):esc(p.name.slice(0,1))}</span><strong title="${esc(p.name)}">${esc(p.name)}</strong><span class="order-seat">${i===0?'先手':`第 ${i+1} 位`}</span>${host?`<button type="button" class="order-handle" data-order-handle="${esc(p.id)}" aria-label="拖动调整 ${esc(p.name)} 的顺序" title="拖动排序；键盘上下方向键也可调整">⠿</button>`:''}</li>`).join('')}</ol><p>从第一位开始，依次轮换。</p></div></section>`;
}
const canEditSettings=()=>!!state?.room&&!state.room.game&&state.room.hostId===state.me.id&&!busy;
async function saveSettings(body,notice,focusId){
  if(!canEditSettings())return;
  busy=true;document.body.classList.add('busy');
  try{const next=await api('/api/room/settings',body);if('finishScore' in body)scoreDraft=null;accept(next);toast(notice);}
  catch(error){render();toast(error.message);}
  finally{busy=false;document.body.classList.remove('busy');if(focusId)document.querySelector(`[data-order-handle="${CSS.escape(focusId)}"]`)?.focus();}
}
const settingsControls=bindRoomSettings({canEdit:canEditSettings,
  saveOrder:(turnOrder,focusId)=>saveSettings({turnOrder},'轮换顺序已保存',focusId),
  onScoreInput:value=>{scoreDraft=value;},
  onScoreSave:()=>saveSettings({finishScore:Number($('#finish-score').value)},'结束分数已保存'),
});
function playerPanel(p){const r=state.room,g=r.game,info=r.players.find(x=>x.id===p.id),me=p.id===state.me.id,current=g.status==='playing'&&g.players[g.turn].id===p.id,summary=publicPlayerSummary(p),grid=publicPlayerGrid(p);return `<article data-player-id="${esc(p.id)}" class="player-panel ${me?'is-me':''} ${current?'current':''}"><div class="player-head"><span class="avatar ${p.ai?'ai-avatar':''}">${p.ai?icon('bot'):esc(p.name.slice(0,1))}</span><div class="player-name"><strong title="${esc(p.name)}">${esc(p.name)} ${me?'<small>你</small>':''}</strong><span><i class="online-dot ${info?.online?'':'off'}"></i>${info?.online?'在线':'已离线'}${p.ai?' · AI':''}</span></div><span class="player-score" aria-label="${esc(p.name)}，${summary.score}分">${summary.score}<small>分</small></span>${r.hostId===state.me.id&&!me&&!p.ai?`<button class="tiny-btn player-kick" data-kick="${p.id}" title="移出玩家" aria-label="移出${esc(p.name)}">×</button>`:''}</div><div class="player-resource-grid" aria-label="${esc(p.name)}的筹码、发展牌与预留牌">${grid.top.map(({color,count})=>`<span class="player-gem-number ${color} ${count?'':'is-zero'}" title="${NAMES[color]}筹码 ${count}" aria-label="${NAMES[color]}筹码 ${count}">${count}</span>`).join('')}${grid.bottom.map(item=>item.kind==='reserved'?`<span class="player-reserved-count" title="预留牌 ${item.count}" aria-label="预留牌 ${item.count}">${item.count}</span>`:`<span class="player-card-count ${item.color}" title="${NAMES[item.color]}发展牌 ${item.count}" aria-label="${NAMES[item.color]}发展牌 ${item.count}">${item.count}</span>`).join('')}</div></article>`;}
function nobleHTML(n){const g=state.room.game,eligible=g.pending?.type==='noble'&&g.pending.nobleIds.includes(n.id)&&g.players[g.turn].id===state.me.id;return `<button class="noble ${eligible?'eligible':''}" data-noble-info="${esc(n.id)}" ${eligible?`data-noble="${esc(n.id)}"`:''} aria-label="贵族，3分，需要${COLORS.filter(c=>n.cost[c]).map(c=>NAMES[c]+n.cost[c]+'张永久卡').join('、')}"><span class="noble-portrait">${icon('crown')}</span><div><span class="noble-title">贵族来访 <b>3<span> 分</span></b></span><div class="noble-cost">${COLORS.filter(c=>n.cost[c]).map(c=>`<span>${nobleCardIcon(c,14)}${n.cost[c]}</span>`).join('')}</div></div></button>`;}
function resourceRow(values,label){return `<div class="owned-bonuses">${COLORS.map(c=>`<span title="${NAMES[c]}${label} ${values[c]||0}" aria-label="${NAMES[c]}${label} ${values[c]||0}">${gem(c,20)}<b>${values[c]||0}</b></span>`).join('')}</div>`;}
function personalResources(me){return `<section class="my-gems"><div class="section-label">拥有的宝石 <span>筹码 ${sum(me.gems)} / 10（含黄金）</span></div>${resourceRow(me.gems,'持有')}</section>
    <section class="my-bonuses"><div class="section-label">永久折扣 <span>每次购买均生效</span></div>${resourceRow(me.bonuses,'折扣')}</section>
    <section class="my-equivalent"><div class="section-label">等效宝石数 <span>持有 + 永久折扣</span></div>${resourceRow(Object.fromEntries(COLORS.map(c=>[c,(me.gems[c]||0)+(me.bonuses[c]||0)])),'等效')}</section>
    <div class="owned-gold">${gem('gold',20)}<span>黄金（万能）</span><strong>${me.gems.gold||0}</strong><small>单独计算，不计入等效数</small></div>`;}
function personalHand(me){return `<section class="hand"><div class="section-label">预留手牌 <span>${me.reserved.length} / 3 · 仅自己可见</span></div><div class="hand-cards">${me.reserved.map(c=>cardHTML(c)).join('')||'<div class="empty-hand">暂无预留手牌</div>'}</div></section>`;}
function inventorySummary(me){return `<div class="inventory-summary" aria-label="持有宝石与永久折扣">${ALL.map(c=>`<span class="${c}" aria-label="${NAMES[c]}持有${me.gems[c]||0}${c==='gold'?'':`，永久折扣${me.bonuses[c]||0}`}">${gem(c,16)}<b>${me.gems[c]||0}${c!=='gold'&&me.bonuses[c]>0?`<span class="summary-bonus">+${me.bonuses[c]}</span>`:''}</b></span>`).join('')}</div>`;}
function mobileReservedView(me){return `<section class="market-view mobile-market-panel reserved-market-view" id="market-view-1" aria-label="预留手牌"><div class="mobile-panel-heading"><strong>预留手牌</strong><span>${me.reserved.length} / 3 · 仅自己可见</span></div><div class="hand-cards">${me.reserved.map(c=>cardHTML(c)).join('')||'<div class="empty-hand">暂无预留手牌</div>'}</div></section>`;}
function mobileResourcesView(me){return `<section class="market-view mobile-market-panel resources-market-view" id="market-view-2" aria-label="宝石库详情"><div class="mobile-panel-heading"><strong>宝石库详情</strong><span>${me.score} 分声望</span></div><div class="mobile-resource-scroll">${personalResources(me)}<button class="collection-button" data-do="collection"><span>已购发展卡</span><strong>${me.cards.length} 张</strong><span>查看全部 ↗</span></button></div></section>`;}
function marketViewTabs(me){return `<div class="market-view-tabs" role="tablist" aria-label="牌桌视图">${[['市场',''],['预留',` ${me.reserved.length}/3`],['宝石库','']].map(([label,count],index)=>`<button role="tab" aria-controls="market-view-${index}" aria-selected="${mobileMarketView===index}" data-market-view="${index}">${label}${count}</button>`).join('')}</div>`;}
function marketRows(g){return [3,2,1].map(level=>`<div class="market-row"><button class="deck level-${level}" data-deck="${level}" ${g.decks[level]===0?'disabled':''} aria-label="盲预留${level}级牌，剩余${g.decks[level]}张"><span class="deck-level">${'ⅠⅡⅢ'[level-1]}</span>${gem('gold',30)}<span>${g.decks[level]} <small>张</small></span></button>${g.market[level].map(c=>cardHTML(c)).join('')}${Array.from({length:Math.max(0,4-g.market[level].length)},()=>'<div class="card-empty">牌库已空</div>').join('')}</div>`).join('');}
function marketArea(g,me){
  const rows=marketRows(g);
  if(!mobileTableLayout)return `<div class="market">${rows}</div>`;
  return `${marketViewTabs(me)}<div class="market" data-market-carousel><section class="market-view market-board" id="market-view-0" aria-label="发展卡市场">${rows}</section>${mobileReservedView(me)}${mobileResourcesView(me)}</div>`;
}
function mobileTableTools(){return `<div class="mobile-table-tools"><button class="icon-btn" data-do="history" aria-label="对局记录" title="对局记录">${icon('book')}</button><button class="icon-btn" data-do="table-menu" aria-label="房间菜单" title="房间菜单">${icon('users')}</button></div>`;}
function personalSidebar(){
  const g=state.room.game,me=g.players.find(p=>p.id===state.me.id);
  return `<aside class="personal-sidebar" aria-label="我的手牌与宝石">
    <div class="personal-heading"><div><span class="eyebrow">MY COLLECTION</span><h2>我的宝石库</h2></div><span class="personal-score">${me.score}<small>声望</small></span></div>
    <div class="bank-column"><div id="bank-panel">${bankPanel()}</div>${state.room.aiStatus?.notice?`<div class="ai-notice">${icon('bot')}${esc(state.room.aiStatus.notice)}</div>`:''}</div>
    ${personalResources(me)}
    ${personalHand(me)}
    <button class="collection-button" data-do="collection"><span>已购发展卡</span><strong>${me.cards.length} 张</strong><span>查看全部 ↗</span></button>
    <div class="mobile-inventory">${inventorySummary(me)}</div>
  </aside>`;
}
function gamePage(){
  const r=state.room,g=r.game,me=g.players.find(p=>p.id===state.me.id),current=g.players[g.turn],currentSeat=r.players.find(p=>p.id===current?.id),currentMode=current?.ai?aiModeName(currentSeat?.mode):'',myTurn=current?.id===state.me.id&&g.status==='playing';
  const autoMe=r.autoPlay?.playerId===state.me.id;
  const turnTitle=autoMe?'调试自动托管中':myTurn?(g.pending?.type==='noble'?'请选择一位贵族':g.pending?.type==='discard'?`请返还 ${g.pending.count} 枚筹码`:'轮到你了'):`${esc(current.name)}${current?.ai?` · ${esc(currentMode)}`:''} 的回合`;
  const turnPrompt=autoMe?'当前账号由服务器自动代打，无法接管。':g.pending?.type==='discard'?(current?.ai?`${esc(currentMode)} 正在选择返还筹码`:`需返还 ${g.pending.count} 枚筹码`):g.pending?.type==='noble'?(current?.ai?`${esc(currentMode)} 正在选择贵族`:'请选择一位贵族'):myTurn?'挑选宝石，或点击卡牌进行购买与预留。':current?.ai?`${esc(currentMode)} 正在思考下一步…`:'好生意，值得片刻等待。';
  return `<main class="game-page">${roomTop()}${g.status==='finished'?results():`<div class="turn-banner ${myTurn?'your-turn':''}"><span>${myTurn?'✦':'◷'}</span><strong>${turnTitle}</strong><span>${turnPrompt}</span>${g.finalRound!==null?'<b class="final-tag">最后一轮</b>':''}</div>`}
    <div class="game-layout">
      <aside class="players-column" style="--player-count:${g.players.length}"><div class="section-label">桌上玩家 <span>${g.players.length} 位</span></div>${(g.turnOrder||g.players.map(p=>p.id)).map(id=>playerPanel(g.players.find(p=>p.id===id))).join('')}<button class="collection-button log-button" data-do="history"><span>对局记录</span><span>查看 ↗</span></button><div class="latest-action">${g.log.slice(-1).map(l=>esc(l.text)).join('')||'商路铺开，好局开始。'}</div></aside>
      <section class="market-column"><div class="section-label">贵族沙龙 <span>满足折扣，自动来访</span></div><div class="nobles">${g.nobles.map(nobleHTML).join('')}</div>
        <div class="market-heading section-label">发展卡市场 <span><i class="available-dot"></i> 高亮卡牌资源足够 · 悬停查看缺口</span></div>
        ${marketArea(g,me)}
      </section>
      ${personalSidebar()}
    </div>${mobileTableTools()}</main>`;
}

function updateMarketViewTabs(){
  document.querySelectorAll('[data-market-view]').forEach(tab=>tab.setAttribute('aria-selected',Number(tab.dataset.marketView)===mobileMarketView));
}
function showMobileMarketView(index,smooth=true){
  mobileMarketView=Math.max(0,Math.min(2,index));updateMarketViewTabs();
  const market=$('[data-market-carousel]');
  if(market?.clientWidth)market.scrollTo({left:market.clientWidth*mobileMarketView,behavior:smooth?'smooth':'auto'});
}
function bindMobileMarket(){
  const market=$('[data-market-carousel]');if(!market)return;
  requestAnimationFrame(()=>showMobileMarketView(mobileMarketView,false));
  const swipe=createTouchSwipeTracker({onSwipe:deltaX=>showMobileMarketView(swipePageIndex(mobileMarketView,deltaX,3))});
  market.addEventListener('touchstart',event=>swipe.start(event.touches),{passive:true});
  market.addEventListener('touchmove',event=>{
    if(swipe.move(event.touches)!=='horizontal')return;
    longPressTracker.cancel();pressedElement?.classList.remove('long-press-active');pressedElement=null;longPressShown=false;
  },{passive:true});
  market.addEventListener('touchend',event=>swipe.finish(event.changedTouches),{passive:true});
  market.addEventListener('touchcancel',swipe.cancel,{passive:true});
  market.addEventListener('scroll',()=>{
    clearTimeout(marketScrollTimer);marketScrollTimer=setTimeout(()=>{
      mobileMarketView=marketViewIndex(market.scrollLeft,market.clientWidth,3);updateMarketViewTabs();
    },70);
  },{passive:true});
}

function bankPanel(){
  const r=state.room,g=r.game,me=g.players.find(p=>p.id===state.me.id);
  const myTurn=g.status==='playing'&&g.players[g.turn].id===me.id;
  const discard=myTurn&&g.pending?.type==='discard',pool=discard?me.gems:g.bank;
  const picked=sum(selection),pass=myTurn&&r.legalActions.some(a=>a.type==='pass');
  const valid=discard?picked===g.pending.count:r.legalActions.some(a=>a.type==='take'&&ALL.every(c=>(a.gems[c]||0)===(selection[c]||0)));
  return `<section class="bank-panel"><div class="section-label">${discard?'返还筹码':'拿取宝石'}<span>${discard?`需还 ${g.pending.count} 枚`:sum(g.bank)+' 枚'}</span></div>
    <div class="gem-bank">${ALL.map(c=>`<button class="token-button ${c} ${selection[c]?'selected':''}" data-gem="${c}" ${!myTurn||(!discard&&g.pending)||(!discard&&c==='gold')||!pool[c]?'disabled':''} aria-label="${discard?'返还':'选择'}${NAMES[c]}，剩余${pool[c]}，已选${selection[c]||0}"><span class="token">${gem(c,32)}<b>${pool[c]}</b>${selection[c]?`<em>${selection[c]}</em>`:''}</span><span>${NAMES[c]}</span></button>`).join('')}</div>
    <div class="selection-status"><span>${discard?'选择要返还的筹码':pass?'本回合可手动跳过':picked?`已选择 ${picked} 枚宝石`:'选择你需要的宝石'}</span><button class="tiny-btn" data-do="clear-gems" ${!picked?'disabled':''}>重选</button></div>
    ${pass?'<button class="btn primary full bank-action" data-do="pass"><span class="action-label-full">跳过本回合</span><span class="action-label-compact">跳过</span> →</button>':`<button class="btn primary full bank-action" data-do="take" ${!valid||!myTurn?'disabled':''}><span class="action-label-full">${discard?'确认返还':'拿取宝石'}</span><span class="action-label-compact">${discard?'返还':'拿取'}</span> ${icon('arrow')}</button>`}
  </section>`;
}

function results(){
  const g=state.room.game,reflection=reflectionStatusView(state.room);
  const reflectionMarkup=reflection?`<div class="reflection-status reflection-${esc(reflection.kind)}" data-reflection-state="${esc(reflection.state)}" role="status"><span class="reflection-status-icon">${icon(reflection.state==='saved'?'check':reflection.state==='failed'?'close':'bot')}</span><span><strong>${esc(reflection.label)}</strong><small>${esc(reflection.detail)}</small></span></div>`:'';
  return `<section class="results"><span class="winner-icon">${icon('crown')}</span><div class="results-copy"><div class="eyebrow">${g.endReason==='stalemate'?'连续跳过 · 提前结算':g.endReason==='host'?'房主结束 · 当前排名':'A BRILLIANT FINISH'}</div><h2>${g.winners.map(id=>esc(g.players.find(p=>p.id===id)?.name)).join('、')} ${g.winners.length>1?'并列获胜':'赢得本局'}</h2><p>${[...g.players].sort((a,b)=>b.score-a.score||a.cards.length-b.cards.length).map(p=>`${esc(p.name)} ${p.score}分 / ${p.cards.length}张卡`).join('　·　')}</p>${reflectionMarkup}</div>${state.room.hostId===state.me.id?'<button class="btn primary" data-do="reset">返回大厅，再来一局</button>':'<span class="muted">等待房主返回大厅</span>'}</section>`;
}
function render(){
  if(!state)return;
  hideCardTooltip();
  const sidebarScroll=$('.personal-sidebar')?.scrollTop||0;
  const focused=document.activeElement, id=focused?.id, value=focused?.value, start=focused?.selectionStart;
  document.body.classList.toggle('at-table',!!state.room?.game);
  $('#app').innerHTML=header()+(state.room?(state.room.game?gamePage():lobby()):home())+footer();
  if($('.personal-sidebar'))$('.personal-sidebar').scrollTop=sidebarScroll;
  const ai=state.room?.aiStatus;
  if(ai?.state==='done'&&!ai.notice&&$('.bank-column')){
    $('.bank-column').insertAdjacentHTML('beforeend',`<p class="ai-result" data-ai-source="${esc(ai.source)}">${icon('check')} ${esc(aiModeName(ai.mode||ai.source))} 已完成行动</p>`);
  }
  renderConnection();
  bindMobileMarket();
  if(id&&['nickname','room-code'].includes(id)){const el=document.getElementById(id);if(el){el.value=value;el.focus();try{el.setSelectionRange(start,start);}catch{}}}
}
function openDialog(html,kind='generic'){dialogKind=kind;$('#dialog').dataset.kind=kind;$('#dialog').innerHTML=`<button class="dialog-close icon-btn" data-do="close" aria-label="关闭">${icon('close')}</button>${html}`;if(!$('#dialog').open)$('#dialog').showModal();}
function closeDialog(){dialogKind=null;$('#dialog').close();}

let tooltipTarget=null,pressedElement=null;
function hideCardTooltip(){
  tooltipTarget?.removeAttribute('aria-describedby');tooltipTarget=null;
  const tip=$('#card-tooltip');if(tip){tip.hidden=true;tip.classList.remove('noble-tooltip');}
}
function positionTooltip(element,tip){
  tip.hidden=false;tooltipTarget=element;element.setAttribute('aria-describedby','card-tooltip');
  const rect=element.getBoundingClientRect(),box=tip.getBoundingClientRect();
  const left=Math.max(10,Math.min(rect.left+rect.width/2-box.width/2,document.documentElement.clientWidth-box.width-10));
  const top=rect.top>=box.height+18?rect.top-box.height-10:Math.min(rect.bottom+10,window.innerHeight-box.height-10);
  tip.style.left=`${left}px`;tip.style.top=`${Math.max(10,top)}px`;
}
function showCardTooltip(element){
  hideCardTooltip();
  const g=state?.room?.game;
  if(!g||element.disabled||$('#dialog').open)return;
  const me=g.players.find(p=>p.id===state.me.id);
  const card=[...Object.values(g.market).flat(),...me.reserved].find(c=>c.id===element.dataset.card);
  if(!card)return;
  const gap=purchaseGap(me,card);if(!gap.remaining)return false;
  const tip=$('#card-tooltip');
  tip.innerHTML=`<strong>还需 ${gap.remaining} 枚宝石</strong><div class="shortfall-colors">${Object.entries(gap.colors).map(([c,n])=>`<span>${gem(c,18)}${NAMES[c]} <b>×${n}</b></span>`).join('')}</div><p>${gap.goldUsed?`现有黄金可抵扣其中 ${gap.goldUsed} 枚；抵扣后仍缺 ${gap.remaining} 枚。`:'已计入你拥有的宝石与永久折扣。'}</p>`;
  positionTooltip(element,tip);return true;
}
function showNobleTooltip(element){
  hideCardTooltip();
  const g=state?.room?.game;if(!g||$('#dialog').open)return false;
  const me=g.players.find(p=>p.id===state.me.id),noble=g.nobles.find(n=>n.id===element.dataset.nobleInfo);
  if(!me||!noble)return false;
  const gap=nobleGap(me,noble),tip=$('#card-tooltip');tip.classList.add('noble-tooltip');
  tip.innerHTML=`<strong>${gap.remaining?`还差 ${gap.remaining} 张发展卡`:'已满足贵族来访条件'}</strong><div class="shortfall-colors noble-shortfall">${Object.entries(gap.colors).map(([c,n])=>`<span>${nobleCardIcon(c,18)}${NAMES[c]} <b>×${n}</b></span>`).join('')||'<span>所有颜色要求均已满足</span>'}</div><p>贵族价值 3 分。回合结束时，永久发展卡满足全部颜色要求即可获得；每回合最多获得 1 位。</p>`;
  positionTooltip(element,tip);return true;
}
function showContextTooltip(element){return element.dataset.card?showCardTooltip(element):showNobleTooltip(element);}
const longPressTracker=createLongPressTracker({onTrigger:element=>{longPressShown=showContextTooltip(element);if(longPressShown)element.classList.add('long-press-active');},onRelease:hideCardTooltip});
document.addEventListener('pointerover',event=>{
  if(!shouldShowContextTooltip({mobile:mobileTableLayout,trigger:'hover',pointerType:event.pointerType}))return;
  const target=event.target.closest('[data-card],[data-noble-info]');
  if(target&&!target.contains(event.relatedTarget))showContextTooltip(target);
});
document.addEventListener('pointerout',event=>{
  if(event.pointerType==='touch')return;
  if(tooltipTarget?.contains(event.target)&&!tooltipTarget.contains(event.relatedTarget))hideCardTooltip();
});
document.addEventListener('focusin',event=>{if(!shouldShowContextTooltip({mobile:mobileTableLayout,trigger:'focus'}))return;const target=event.target.closest('[data-card],[data-noble-info]');if(target)showContextTooltip(target);});
document.addEventListener('focusout',hideCardTooltip);
document.addEventListener('pointerdown',event=>{
  soundPlayer.unlock();
  if(event.pointerType!=='touch')return;
  pressedElement=event.target.closest('[data-card],[data-noble-info]');longPressShown=false;
  if(pressedElement&&!pressedElement.disabled)longPressTracker.start(pressedElement,{x:event.clientX,y:event.clientY});
});
document.addEventListener('pointermove',event=>{if(event.pointerType==='touch')longPressTracker.move({x:event.clientX,y:event.clientY});},{passive:true});
document.addEventListener('pointerup',event=>{
  if(event.pointerType!=='touch')return;
  const target=longPressTracker.finish();pressedElement?.classList.remove('long-press-active');pressedElement=null;
  if(target&&longPressShown){suppressLongPressClick=target;setTimeout(()=>{if(suppressLongPressClick===target)suppressLongPressClick=null;},800);}
  longPressShown=false;
});
document.addEventListener('pointercancel',()=>{longPressTracker.cancel();pressedElement?.classList.remove('long-press-active');pressedElement=null;longPressShown=false;});
document.addEventListener('click',event=>{
  if(suppressLongPressClick?.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();suppressLongPressClick=null;return;}
  hideCardTooltip();
},true);
window.addEventListener('scroll',hideCardTooltip,true);
window.addEventListener('resize',()=>{
  hideCardTooltip();const next=matchMedia(MOBILE_TABLE_QUERY).matches;
  if(next!==mobileTableLayout){mobileTableLayout=next;render();}
});
function confirmDialog(title,text,action,label='确认'){openDialog(`<div class="eyebrow">TABLE MATTERS</div><h2>${title}</h2><p>${text}</p><div class="dialog-actions"><button class="btn subtle" data-do="close">取消</button><button class="btn primary" data-confirm="${action}">${label}</button></div>`);}
function cardDialog(cardId,level){
  const r=state.room,g=r.game,me=g.players.find(p=>p.id===state.me.id);if(g.status!=='playing')return;
  const card=[...Object.values(g.market).flat(),...me.reserved].find(c=>c.id===cardId);
  const buy=r.legalActions.find(a=>a.type==='buy'&&a.cardId===cardId);
  const reserve=r.legalActions.find(a=>a.type==='reserve'&&(cardId?a.cardId===cardId:a.level===level));
  if(!card&&level===undefined)return;
  const cost=card?discountedCost(me,card):{};
  const gap=card?purchaseGap(me,card):null;
  const payment=buy?.payment||{...cost,gold:0};
  openDialog(`<div class="eyebrow">${card?'DEVELOPMENT CARD':'A LITTLE MYSTERY'}</div><h2>${card?`${['矿场','商路','庄园'][card.level-1]} · ${NAMES[card.bonus]}`:`盲预留 ${level} 级卡`}</h2>${card?`<div class="card-detail">${cardHTML(card,{hero:true,disabled:true})}<div><h3>${card.points} 点声望</h3><p>购入后，永久获得<br><strong>${NAMES[card.bonus]}折扣 +1</strong></p><p class="muted">所需支付（已扣除折扣）</p><div class="payment-preview">${COLORS.filter(c=>cost[c]).map(c=>`<span>${gem(c,19)}${cost[c]}</span>`).join('')||'免费购买'}</div>${gap.remaining?`<p class="card-gap">还缺 ${gap.remaining} 枚宝石${gap.goldUsed?`（已计入 ${gap.goldUsed} 枚黄金）`:''}</p>`:''}</div></div>`:'<p>从牌堆顶端预留一张未知卡牌。只有你可以看到这张卡。</p>'}<p class="muted">预留最多 3 张卡；供应区有黄金时获得 1 枚。<br>${g.players[g.turn].id!==me.id?'现在还没轮到你，可以先看看市场。':g.pending?'请先完成本回合的返还筹码或贵族选择。':''}</p>${buy?`<details class="custom-payment"><summary>实际支付方案（可调整黄金替代）</summary>${payment.gold?`<p class="gold-payment-note">本次可用 ${payment.gold} 枚黄金补足缺少的颜色；上方价格不含黄金替代。</p>`:''}<div class="payment-inputs">${ALL.map(c=>`<label>${gem(c,18)}<input type="number" min="0" max="${me.gems[c]}" value="${payment[c]}" data-payment="${c}" aria-label="支付${NAMES[c]}"></label>`).join('')}</div></details>`:''}<div class="dialog-actions"><button class="btn secondary" data-reserve="${cardId||''}" data-level="${level||''}" ${!reserve?'disabled':''}>${gem('gold',18)} 预留卡牌</button>${card?`<button class="btn primary" data-buy="${cardId}" ${!buy?'disabled':''}>${buy?'购买卡牌':'暂不可购买'} ${icon('arrow')}</button>`:''}</div>`,'card');
}
function rules(){openDialog(`<div class="eyebrow">A QUICK GUIDE</div><h2>从一颗宝石，到 ${state.room?.game?.finishScore||state.room?.settings?.finishScore||15} 分声望。</h2><div class="rules"><section><h3>01 / 轮到你，选择一个行动</h3><p><b>拿取：</b>最多三种不同颜色各一枚；或取同色两枚，此时该色供应须至少四枚。不能直接拿黄金。</p><p><b>购买：</b>购买市场或自己预留的卡。发展卡提供永久折扣，黄金可替代任意颜色。点击卡牌查看实际支付。</p><p><b>预留：</b>拿一张市场牌或牌堆顶牌，最多保留三张；黄金尚有库存时，额外获得一枚黄金。</p></section><section><h3>02 / 回合结束前</h3><p>手中筹码（含黄金）不能超过十枚，超出时自由选择返还。永久折扣满足贵族要求时，贵族自动来访；同时满足多位时选择一位，每回合最多一位。</p></section><section><h3>03 / 一场漂亮的收官</h3><p>任意玩家达到 ${state.room?.game?.finishScore||state.room?.settings?.finishScore||15} 分，完成当前轮，让每人获得相同回合数。声望最高者获胜；同分时购买发展卡更少者胜出，仍相同则共享胜利。</p></section><section><h3>私人桌规则</h3><p>无法拿取且无法购买时，可手动跳过，即使仍能预留；所有玩家连续跳过一圈后按当前排名结算。房主可通过“结束本局”提前结束对局。</p><h3>关于这张桌</h3><p>二至四人，含完整九十张基础卡和十位贵族。没有扩展。玩家离线保留座位；主动离开或被房主移出后，进行中的席位交给本地策略托管。服务重启将清空房间。</p></section></div><button class="btn primary full" data-do="close">明白了，入座吧</button>`);}
async function act(action){await mutate('/api/room/action',{version:state.room.version,action});}
async function copy(text,success){try{await navigator.clipboard.writeText(text);toast(success);}catch{openDialog(`<h2>复制邀请信息</h2><input class="copy-fallback" readonly value="${esc(text)}"><p>选择上方文字后复制给朋友。</p>`);$('.copy-fallback').select();}}
async function saveHomeName(){const name=$('#nickname')?.value?.trim();if(name&&name!==state.me.name){const next=await api('/api/session',{name});storage.set('splendor.nickname',next.me.name);state=next;}}

document.addEventListener('submit',async e=>{
  if(e.target.id==='join-form'){e.preventDefault();hintCode=$('#room-code').value;try{await saveHomeName();await mutate('/api/join',{code:hintCode});}catch(error){toast(error.message);}}
  if(e.target.id==='profile-form'){e.preventDefault();const name=$('#profile-name').value;try{const next=await api('/api/session',{name});storage.set('splendor.nickname',next.me.name);closeDialog();accept(next);toast('昵称已保存');}catch(error){toast(error.message);}}
});
document.addEventListener('keydown',e=>{
  soundPlayer.unlock();
  if(!e.target.matches('[data-market-view]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();
  const current=Number(e.target.dataset.marketView),next=e.key==='Home'?0:e.key==='End'?2:e.key==='ArrowLeft'?Math.max(0,current-1):Math.min(2,current+1);
  showMobileMarketView(next);document.querySelector(`[data-market-view="${next}"]`)?.focus();
});
document.addEventListener('click',async e=>{
  const el=e.target.closest('button');if(!el||el.disabled)return;
  const d=el.dataset;
  if(d.marketView!==undefined){showMobileMarketView(Number(d.marketView));return;}
  if(d.card)return cardDialog(d.card);
  if(d.deck)return cardDialog(null,Number(d.deck));
  if(d.gem){
    const g=state.room.game,me=g.players.find(p=>p.id===state.me.id),discard=g.pending?.type==='discard',pool=discard?me.gems:g.bank,c=d.gem;
    const max=discard?Math.min(pool[c],g.pending.count):Math.min(pool[c],2);
    selection[c]=((selection[c]||0)+1)%(max+1);if(!selection[c])delete selection[c];
    $('#bank-panel').innerHTML=bankPanel();return;
  }
  if(d.noble)return act({type:'noble',nobleId:d.noble});
  if(d.kick){const p=state.room.players.find(p=>p.id===d.kick);return confirmDialog('移出这位玩家？',`${esc(p.name)} 将离开房间。${state.room.game?.status==='playing'?'本局席位与资源将保留，由本地策略托管。':''}`,`kick:${d.kick}`,'移出玩家');}
  if(d.confirm){closeDialog();if(d.confirm.startsWith('kick:'))return mutate('/api/room/kick',{playerId:d.confirm.slice(5)});if(d.confirm==='leave')return mutate('/api/room/leave');if(d.confirm==='finish')return mutate('/api/room/finish');}
  if(d.buy){const payment=Object.fromEntries([...document.querySelectorAll('[data-payment]')].map(input=>[input.dataset.payment,Number(input.value)]));const cardId=d.buy;closeDialog();return act({type:'buy',cardId,payment});}
  if('reserve'in d){const action=d.reserve?{type:'reserve',cardId:d.reserve}:{type:'reserve',level:Number(d.level)};closeDialog();return act(action);}
  if(d.reasoningEffort){closeDialog();return mutate('/api/room/ai',{mode:'llm-advanced',reasoningEffort:d.reasoningEffort});}
  if(d.ai==='llm-advanced'){
    const efforts=state.llmModels?.reasoningEfforts||['off','low','high','max'];
    return openDialog(`<div class="eyebrow">LLM · ADVANCED</div><h2>选择 LLM 推理强度</h2><p>强度列表由服务端环境配置提供。</p><div class="ai-mode-list">${efforts.map(effort=>`<button class="ai-option" data-reasoning-effort="${esc(effort)}"><span class="ai-option-mark">${icon(effort==='off'?'close':'bot')}</span><span><strong>${esc(REASONING_EFFORT_NAMES[effort]||effort)}</strong><small>${esc(effort==='off'?'关闭思考模式':`使用 ${effort} 推理强度`)}</small></span>${icon('arrow')}</button>`).join('')}</div><button class="btn secondary full" data-do="ai-difficulty">返回 AI 类型选择</button>`);
  }
  if(d.ai){closeDialog();return mutate('/api/room/ai',{mode:d.ai});}
  switch(d.do){
    case 'toggle-sound':soundMuted=!soundMuted;storage.set('splendor.sound-muted',String(soundMuted));render();if(!soundMuted)soundPlayer.play('turn');toast(soundMuted?'音效已关闭':'音效已开启');return;
    case 'toggle-settings':settingsExpanded=!settingsExpanded;render();document.querySelector('.settings-toggle')?.focus();return;
    case 'table-menu':return openDialog(`<h2>房间 ${state.room.code} · 第 ${state.room.game.round} 轮</h2><div class="table-menu"><button class="btn secondary" data-do="invite">${icon('copy')}复制邀请链接</button><button class="btn secondary" data-do="profile">${icon('users')}修改昵称</button><button class="btn secondary" data-do="rules">${icon('book')}游戏规则</button>${state.room.hostId===state.me.id&&state.room.game.status==='playing'?'<button class="btn secondary" data-do="finish">结束本局</button>':''}<button class="btn secondary" data-do="leave">${icon('exit')}离开房间</button>${state.room.hostId===state.me.id?state.room.players.filter(p=>p.id!==state.me.id&&!p.ai).map(p=>`<button class="btn secondary" data-kick="${p.id}">${icon('close')}移出 ${esc(p.name)}</button>`).join(''):''}</div>${state.room.aiStatus?.notice?`<p>${esc(state.room.aiStatus.notice)}</p>`:''}`);
    case 'collection':{const me=state.room.game.players.find(p=>p.id===state.me.id);return openDialog(`<div class="eyebrow">YOUR DEVELOPMENT CARDS</div><h2>已购发展卡 · ${me.cards.length} 张</h2><div class="collection-grid">${me.cards.map(c=>cardHTML(c,{disabled:true})).join('')||'<p class="muted">购入的卡牌将汇集于此。</p>'}</div>`);}
    case 'history':return openDialog(`<div class="eyebrow">TABLE JOURNAL</div><h2>对局记录</h2><div class="history-list">${state.room.game.log.slice().reverse().map(l=>`<p>${esc(l.text)}</p>`).join('')||'<p>好局开始。</p>'}</div>`);
    case 'rules':return rules();
    case 'close':return closeDialog();
    case 'profile':return openDialog(`<div class="eyebrow">YOUR SEAT AT THE TABLE</div><h2>朋友怎么称呼你？</h2><form id="profile-form"><label for="profile-name">桌上昵称</label><input id="profile-name" maxlength="24" value="${esc(state.me.name)}" required autocomplete="nickname"><p class="muted">自动保存在此浏览器，下次入座无需重填。</p><button class="btn primary full" type="submit">保存昵称</button></form>`);
    case 'create':try{await saveHomeName();await mutate('/api/rooms');}catch(error){toast(error.message);}return;
    case 'add-ai':return openDialog(`<div class="eyebrow">ONE MORE MIND</div><h2>邀请一位 AI 商人</h2><p>可以选择本地策略，也可以邀请 LLM。下一步选择商人类型与难度。</p><button class="btn primary full" data-do="ai-difficulty">继续选择 AI 难度 / 类型 ${icon('arrow')}</button>`);
    case 'ai-difficulty':return openDialog(`<div class="eyebrow">ONE MORE MIND</div><h2>选择 AI 难度 / 类型</h2><p>选择一位商人加入牌桌。</p><div class="ai-mode-list">${AI_OPTIONS.map(option=>{const disabled=option.requiresKey&&!state.llmAvailable;return `<button class="ai-option" data-ai="${esc(option.mode)}" ${disabled?'disabled':''}>${option.mode.startsWith('local')?gem('green',30):icon('bot')}<span><strong>${esc(option.name)}</strong><small>${esc(disabled?'服务端尚未配置 LLM 密钥':option.detail)}</small></span>${icon('arrow')}</button>`;}).join('')}</div>`);
    case 'start':return mutate('/api/room/start');
    case 'reset':return mutate('/api/room/reset');
    case 'finish':return confirmDialog('结束当前对局？','将立即停止本局及 AI 思考，按当前声望和发展卡数量结算。房间与玩家席位会保留，可返回大厅再开一局。','finish','结束并结算');
    case 'copy':return copy(state.room.code,'房间号已复制');
    case 'invite':return copy(`${location.origin}${basePath}?room=${state.room.code}`,'邀请链接已复制，发给朋友吧');
    case 'leave':return confirmDialog('离开这张桌？',state.room.game?.status==='playing'?'本局将由本地策略接管你的席位。离开后无法重新加入本局。':'你的座位将被空出；如果你是房主，会将房主交给下一位真人玩家。','leave','离开房间');
    case 'clear-gems':selection={};$('#bank-panel').innerHTML=bankPanel();return;
    case 'take':return act({type:state.room.game.pending?.type==='discard'?'discard':'take',gems:{...selection}});
    case 'pass':return act({type:'pass'});
  }
});
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
$('#dialog').addEventListener('close',()=>{dialogKind=null;});
window.addEventListener('online',()=>connect());
async function boot(){
  try{const name=storage.get('splendor.nickname')||`宝石商人${Math.floor(Math.random()*900+100)}`;const next=await api('/api/session',{name});storage.set('splendor.nickname',next.me.name);accept(next);connect();}
  catch(error){$('#app').innerHTML=`<div class="loading"><h2>暂时无法连接桌游室</h2><p>${esc(error.message)}</p><button class="btn primary" id="retry-connect">重新连接</button></div>`;$('#retry-connect').onclick=boot;}
}
boot();

