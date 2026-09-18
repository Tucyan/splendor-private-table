export const SOUND_LIBRARY=Object.freeze({
  start:{file:'card-shuffle.ogg',volume:.28},
  take:{file:'chips-handle-2.ogg',volume:.36},
  buy:{file:'card-place-1.ogg',volume:.42},
  reserve:{file:'card-slide-4.ogg',volume:.34},
  noble:{file:'cards-pack-open-1.ogg',volume:.4},
  turn:{file:'chip-lay-2.ogg',volume:.3},
  finish:{file:'card-fan-1.ogg',volume:.42},
});

const sum=(values)=>Object.values(values||{}).reduce((total,value)=>total+(Number(value)||0),0);
const grew=(current,previous,key)=>(current?.[key]?.length||0)>(previous?.[key]?.length||0);

export function stateSoundCues(before,after){
  const oldRoom=before?.room,room=after?.room;
  if(!oldRoom||!room||oldRoom.code!==room.code||room.version!==oldRoom.version+1)return [];
  if(!oldRoom.game&&room.game)return ['start'];
  if(!oldRoom.game||!room.game)return [];
  const oldGame=oldRoom.game,game=room.game;
  if(oldGame.status!=='finished'&&game.status==='finished')return ['finish'];

  let bought=false,reserved=false,noble=false,took=false;
  for(const current of game.players||[]){
    const previous=(oldGame.players||[]).find(candidate=>candidate.id===current.id);
    if(!previous)continue;
    bought||=grew(current,previous,'cards');
    reserved||=grew(current,previous,'reserved');
    noble||=grew(current,previous,'nobles');
    took||=sum(current.gems)>sum(previous.gems);
  }
  const primary=noble?'noble':bought?'buy':reserved?'reserve':took?'take':null;
  const oldTurn=(oldGame.players||[])[oldGame.turn]?.id;
  const currentTurn=(game.players||[])[game.turn]?.id;
  const becameMyTurn=game.status==='playing'&&currentTurn===after.me?.id&&oldTurn!==after.me?.id;
  return [...(primary?[primary]:[]),...(becameMyTurn?['turn']:[])];
}

export function createSoundPlayer({assetBase,AudioClass=globalThis.Audio,isMuted=()=>false}={}){
  const clips=new Map();
  let unlocked=false;
  return {
    unlock(){unlocked=true;},
    play(cue){
      const config=SOUND_LIBRARY[cue];
      if(!unlocked||isMuted()||!config||!AudioClass)return false;
      try{
        let clip=clips.get(cue);
        if(!clip){
          clip=new AudioClass(new URL(config.file,assetBase).href);
          clip.preload='auto';clip.volume=config.volume;clips.set(cue,clip);
        }
        clip.currentTime=0;
        const result=clip.play();
        result?.catch?.(()=>{});
        return true;
      }catch{return false;}
    },
  };
}
