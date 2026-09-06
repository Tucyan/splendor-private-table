// Pointer events support both mouse and touch without a drag-and-drop dependency.
export function bindRoomSettings({canEdit,saveOrder,onScoreInput,onScoreSave}) {
  let drag=null;
  const rows=()=>[...document.querySelectorAll('[data-order-player]')];
  const ids=()=>rows().map(row=>row.dataset.orderPlayer);
  const labelRows=()=>rows().forEach((row,i)=>{row.querySelector('.order-number').textContent=String(i+1).padStart(2,'0');row.querySelector('.order-seat').textContent=i===0?'先手':'第 '+(i+1)+' 位';});
  function cancel(){
    if(!drag)return;
    const previous=drag;drag=null;
    previous.row.classList.remove('is-dragging');
    if(previous.handle.hasPointerCapture(previous.pointerId))previous.handle.releasePointerCapture(previous.pointerId);
  }
  document.addEventListener('input',e=>{if(e.target.id==='finish-score')onScoreInput(e.target.value);});
  document.addEventListener('submit',e=>{if(e.target.id==='room-score-form'){e.preventDefault();if(canEdit())onScoreSave();}});
  document.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-order-handle]');
    if(!handle||!canEdit()||e.button!==0||drag)return;
    e.preventDefault();
    drag={handle,row:handle.closest('[data-order-player]'),before:ids(),pointerId:e.pointerId};
    handle.setPointerCapture(e.pointerId);handle.focus();drag.row.classList.add('is-dragging');
  });
  document.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-order-player]');
    if(!target||target===drag.row)return;
    const all=rows();
    if(all.indexOf(drag.row)<all.indexOf(target))target.after(drag.row);else target.before(drag.row);
    drag.handle.setPointerCapture(drag.pointerId);
    labelRows();
  });
  document.addEventListener('pointerup',e=>{
    if(!drag||e.pointerId!==drag.pointerId)return;
    const next=ids(),before=drag.before;cancel();
    if(canEdit()&&next.join()!==before.join())saveOrder(next);
  });
  function restore(){if(!drag)return;const list=drag.row.parentElement;drag.before.forEach(id=>list.append(rows().find(row=>row.dataset.orderPlayer===id)));labelRows();cancel();}
  document.addEventListener('pointercancel',restore);
  document.addEventListener('lostpointercapture',restore);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){restore();return;}
    const handle=e.target.closest('[data-order-handle]');
    if(!handle||!canEdit()||!['ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();const next=ids(),index=next.indexOf(handle.dataset.orderHandle),to=index+(e.key==='ArrowUp'?-1:1);
    if(to<0||to>=next.length)return;
    [next[index],next[to]]=[next[to],next[index]];saveOrder(next,handle.dataset.orderHandle);
  });
  return {cancel};
}
