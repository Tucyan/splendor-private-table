export function marketViewIndex(scrollLeft,viewWidth,viewCount){
  if(!viewWidth||viewCount<1)return 0;
  return Math.max(0,Math.min(viewCount-1,Math.round(scrollLeft/viewWidth)));
}

export function createLongPressTracker({delay=450,tolerance=10,onTrigger=()=>{}}={}){
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
      reset();return result;
    },
    cancel:reset,
  };
}
