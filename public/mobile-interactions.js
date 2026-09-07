export function marketViewIndex(scrollLeft,viewWidth,viewCount){
  if(!viewWidth||viewCount<1)return 0;
  return Math.max(0,Math.min(viewCount-1,Math.round(scrollLeft/viewWidth)));
}

export function shouldShowContextTooltip({mobile=false,trigger,pointerType}={}){
  if(trigger==='longpress')return true;
  return !mobile&&(trigger==='focus'||(trigger==='hover'&&pointerType!=='touch'));
}

export function swipePageIndex(startIndex,deltaX,viewCount,threshold=48){
  if(!viewCount||Math.abs(deltaX)<threshold)return startIndex;
  const direction=deltaX<0?1:-1;
  return Math.max(0,Math.min(viewCount-1,startIndex+direction));
}

export function createTouchSwipeTracker({threshold=48,onSwipe=()=>{}}={}){
  let startTouch=null;
  const findTouch=touches=>startTouch&&Array.from(touches||[]).find(touch=>touch.identifier===startTouch.identifier);
  const direction=touch=>{
    if(!startTouch||!touch)return null;
    const dx=touch.clientX-startTouch.x,dy=touch.clientY-startTouch.y;
    if(Math.hypot(dx,dy)<8)return null;
    return Math.abs(dx)>Math.abs(dy)?'horizontal':'vertical';
  };
  return {
    start(touches){
      const list=Array.from(touches||[]),touch=list.length===1?list[0]:null;
      startTouch=touch?{identifier:touch.identifier,x:touch.clientX,y:touch.clientY}:null;
    },
    move(touches){return direction(findTouch(touches));},
    finish(changedTouches){
      const touch=findTouch(changedTouches),start=startTouch;startTouch=null;
      if(!start||!touch)return null;
      const dx=touch.clientX-start.x,dy=touch.clientY-start.y;
      if(Math.abs(dx)<threshold||Math.abs(dx)<=Math.abs(dy))return null;
      onSwipe(dx);return dx;
    },
    cancel(){startTouch=null;},
  };
}

export function createLongPressTracker({delay=450,tolerance=10,onTrigger=()=>{},onRelease=()=>{}}={}){
  let timer=null,target=null,startPoint=null,triggered=false;
  const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const reset=()=>{clearTimer();target=null;startPoint=null;triggered=false;};
  return {
    start(value,{x,y}){
      reset();target=value;startPoint={x,y};
      timer=setTimeout(()=>{timer=null;triggered=true;onTrigger(target);},delay);
    },
    move({x,y}){
      if(!startPoint||triggered)return;
      if(Math.hypot(x-startPoint.x,y-startPoint.y)>tolerance)reset();
    },
    finish(){
      const result=triggered?target:null;
      if(result)onRelease(result);
      reset();return result;
    },
    cancel(){if(triggered&&target)onRelease(target);reset();},
  };
}
