export function tableChanges(before,after){
  const result={cards:[],gems:[],dealt:[]},old=before?.room,current=after?.room;
  if(!old?.game||!current?.game||old.code!==current.code||current.version!==old.version+1)return result;
  for(const player of current.game.players){
    const previous=old.game.players.find(p=>p.id===player.id);
    if(!previous||player.id===after.me.id)continue;
    for(const card of player.cards)if(!previous.cards.some(c=>c.id===card.id))result.cards.push({playerId:player.id,card});
    for(const [color,value] of Object.entries(player.gems)){
      const count=value-(previous.gems[color]||0);
      if(count>0)result.gems.push({playerId:player.id,color,count});
    }
  }
  const previousIds=new Set(Object.values(old.game.market).flat().map(c=>c.id));
  result.dealt=Object.values(current.game.market).flat().filter(c=>!previousIds.has(c.id));
  return result;
}

const query=(selector)=>document.querySelector(selector);
const rect=el=>{const box=el?.getBoundingClientRect();return box?.width&&box?.height?box:null;};
const avatar=id=>query(`[data-player-id="${CSS.escape(id)}"] .avatar`);
const cardElement=id=>query(`.market [data-card="${CSS.escape(id)}"]`);
const center=box=>({x:box.left+box.width/2,y:box.top+box.height/2});
const slides=new Map();

// Capture old positions before the table is rerendered; effects live outside #app.
export function captureTableEffects(before,after,{gem,cardHTML}){
  if(document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches)return ()=>{};
  const changes=tableChanges(before,after),flights=[];
  const moves=[];
  const continuous=before?.room?.game&&after?.room?.game&&before.room.code===after.room.code;
  if(!continuous){for(const slide of slides.values())slide.animation.cancel();slides.clear();}
  if(continuous){
    for(const [level,cards] of Object.entries(after.room.game.market)){
      const previous=before.room.game.market[level]||[];
      cards.forEach((card,index)=>{
        const oldIndex=previous.findIndex(c=>c.id===card.id),active=slides.get(card.id);
        const moved=after.room.version===before.room.version+1&&oldIndex>=0&&oldIndex!==index;
        if(!moved&&!active)return;
        // Read the current visual position, including any in-progress movement.
        const box=rect(cardElement(card.id));
        if(box)moves.push({id:card.id,level,box,end:moved?performance.now()+420:active.end});
        active?.animation.cancel();slides.delete(card.id);
      });
    }
  }
  for(const {playerId,card} of changes.cards){
    const source=cardElement(card.id),target=avatar(playerId);
    const box=rect(source)||rect(target);
    if(box)flights.push({playerId,box,html:source?.outerHTML||cardHTML(card,{disabled:true}),kind:'card'});
  }
  for(const {playerId,color,count} of changes.gems){
    const box=rect(query(`[data-gem="${CSS.escape(color)}"] .gem`));
    if(box)for(let i=0;i<Math.min(count,3);i++)flights.push({playerId,box,html:gem(color,34),kind:'gem',delay:i*100});
  }
  return ()=>{
    for(const move of moves){
      const target=cardElement(move.id),box=rect(target),duration=move.end-performance.now();
      if(!box||duration<=0)continue;
      const dx=move.box.left-box.left,dy=move.box.top-box.top;
      if(Math.abs(dx)<.5&&Math.abs(dy)<.5)continue;
      const animation=target.animate([
        {transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'},
      ],{duration,easing:'cubic-bezier(.22,.61,.36,1)'});
      animation.id='market-slide';
      const entry={animation,end:move.end};slides.set(move.id,entry);
      animation.finished.catch(()=>{}).finally(()=>{if(slides.get(move.id)===entry)slides.delete(move.id);});
    }
    for(const flight of flights){
      const target=avatar(flight.playerId),box=rect(target);if(!box)continue;
      const from=center(flight.box),to=center(box),node=document.createElement('div');
      node.className=`table-flight flight-${flight.kind}`;node.setAttribute('aria-hidden','true');
      node.innerHTML=flight.html;
      const width=flight.kind==='card'?Math.min(flight.box.width,100):34,height=flight.kind==='card'?width*1.4:34;
      Object.assign(node.style,{left:`${from.x-width/2}px`,top:`${from.y-height/2}px`,width:`${width}px`,height:`${height}px`});
      document.body.append(node);
      const dx=to.x-from.x,dy=to.y-from.y;
      const animation=node.animate([
        {transform:'translate(0,0) scale(1)',opacity:1},
        {transform:`translate(${dx*.45}px,${dy*.45-48}px) scale(${flight.kind==='card'?.82:1.15}) rotate(-10deg)`,opacity:1,offset:.5},
        {transform:`translate(${dx}px,${dy}px) scale(.18) rotate(8deg)`,opacity:0},
      ],{duration:760,delay:flight.delay||0,easing:'cubic-bezier(.3,.05,.3,1)',fill:'both'});
      animation.finished.then(()=>{
        const live=avatar(flight.playerId);
        if(live)live.animate([{boxShadow:'0 0 0 0 #dfbb70aa'},{boxShadow:'0 0 0 15px #dfbb7000'}],{duration:400});
      }).catch(()=>{}).finally(()=>node.remove());
    }
    for(const card of changes.dealt){
      const delay=moves.some(move=>String(move.level)===String(card.level))?140:0;
      const target=cardElement(card.id),box=rect(target),deck=rect(query(`[data-deck="${card.level}"]`));
      if(!box||!deck)continue;
      const from=center(deck),to=center(box),node=document.createElement('div');
      node.className='table-deal';node.dataset.effectCard=card.id;node.setAttribute('aria-hidden','true');
      Object.assign(node.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});
      const back=document.createElement('div');back.className='deal-back';back.innerHTML=`<span>${'ⅠⅡⅢ'[card.level-1]}</span>${gem('gold',32)}<small>SPLENDOR</small>`;
      const face=target.cloneNode(true);face.classList.add('deal-front');face.removeAttribute('data-card');
      node.append(back,face);document.body.append(node);
      // The real slot remains interactive. The temporary face covers it while flipping.
      target.style.opacity='0';
      const move=node.animate([
        {transform:`translate(${from.x-to.x}px,${from.y-to.y}px) scale(.4)`,opacity:0},
        {transform:`translate(${(from.x-to.x)*.25}px,-12px) scale(.9)`,opacity:1,offset:.45},
        {transform:'translate(0,0) scale(1)',opacity:1},
      ],{duration:720,delay,easing:'cubic-bezier(.2,.7,.25,1)',fill:'both'});
      back.animate([{transform:'perspective(700px) rotateY(0deg)'},{transform:'perspective(700px) rotateY(-180deg)'}],{duration:600,delay:100+delay,fill:'both'});
      face.animate([{transform:'perspective(700px) rotateY(180deg)'},{transform:'perspective(700px) rotateY(0deg)'}],{duration:600,delay:100+delay,fill:'both'});
      move.finished.catch(()=>{}).finally(()=>{node.remove();const live=cardElement(card.id);if(live)live.style.removeProperty('opacity');});
    }
    // Presence/SSE rerenders must not reveal a replacement underneath its moving face.
    for(const node of document.querySelectorAll('.table-deal')){
      const live=cardElement(node.dataset.effectCard);if(live)live.style.opacity='0';
    }
  };
}
