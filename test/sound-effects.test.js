import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundPlayer,stateSoundCues} from '../public/sound-effects.js';

const gems=(values={})=>({white:0,blue:0,green:0,red:0,black:0,gold:0,...values});
const player=(id)=>({id,cards:[],reserved:[],nobles:[],gems:gems()});
const snapshot=()=>({
  me:{id:'me'},
  room:{
    code:'123456',version:4,
    game:{status:'playing',turn:1,players:[player('me'),player('other')]},
  },
});
const transition=(change)=>{
  const before=snapshot(),after=structuredClone(before);
  after.room.version+=1;change?.(before,after);return [before,after];
};

test('state sound cues identify physical table actions and prioritize their strongest cue',()=>{
  let pair=transition((_before,after)=>{after.room.game.players[1].gems.blue=2;});
  assert.deepEqual(stateSoundCues(...pair),['take']);

  pair=transition((_before,after)=>{
    after.room.game.players[1].reserved.push({id:'r1'});
    after.room.game.players[1].gems.gold=1;
  });
  assert.deepEqual(stateSoundCues(...pair),['reserve']);

  pair=transition((before,after)=>{
    before.room.game.players[1].gems.red=3;
    after.room.game.players[1].gems.red=1;
    after.room.game.players[1].cards.push({id:'c1'});
  });
  assert.deepEqual(stateSoundCues(...pair),['buy']);

  pair=transition((_before,after)=>{after.room.game.players[1].nobles.push({id:'n1'});});
  assert.deepEqual(stateSoundCues(...pair),['noble']);
});

test('turn notification follows an action, while start and finish use single distinct cues',()=>{
  const [beforeTake,afterTake]=transition((_before,after)=>{
    after.room.game.players[1].gems.green=1;
    after.room.game.turn=0;
  });
  assert.deepEqual(stateSoundCues(beforeTake,afterTake),['take','turn']);

  const beforeStart=snapshot();beforeStart.room.game=null;
  const afterStart=snapshot();afterStart.room.version=beforeStart.room.version+1;
  assert.deepEqual(stateSoundCues(beforeStart,afterStart),['start']);

  const [beforeFinish,afterFinish]=transition((_before,after)=>{
    after.room.game.status='finished';after.room.game.turn=0;
  });
  assert.deepEqual(stateSoundCues(beforeFinish,afterFinish),['finish']);
});

test('initial, duplicate, missed, room-changing, and non-game updates stay silent',()=>{
  const before=snapshot(),after=structuredClone(before);
  const cases=[
    [null,after],
    [before,after],
    [before,{...after,room:{...after.room,version:8}}],
    [before,{...after,room:{...after.room,code:'654321',version:5}}],
  ];
  for(const pair of cases)assert.deepEqual(stateSoundCues(...pair),[]);
  const [beforeNoop,afterNoop]=transition();
  assert.deepEqual(stateSoundCues(beforeNoop,afterNoop),[]);
});

test('sound player stays locked, honors mute, and plays local clips after unlock',async()=>{
  class FakeAudio{
    static instances=[];
    constructor(src){this.src=src;this.currentTime=9;this.playCalls=0;FakeAudio.instances.push(this);}
    play(){this.playCalls+=1;return Promise.resolve();}
  }
  let muted=false;
  const player=createSoundPlayer({assetBase:'https://game.test/assets/audio/',AudioClass:FakeAudio,isMuted:()=>muted});

  assert.equal(player.play('take'),false);
  player.unlock();
  assert.equal(player.play('take'),true);
  await Promise.resolve();
  assert.equal(FakeAudio.instances.length,1);
  assert.equal(FakeAudio.instances[0].src,'https://game.test/assets/audio/chips-handle-2.ogg');
  assert.equal(FakeAudio.instances[0].currentTime,0);
  assert.equal(FakeAudio.instances[0].playCalls,1);

  muted=true;
  assert.equal(player.play('buy'),false);
  assert.equal(FakeAudio.instances.length,1);
  assert.equal(player.play('missing'),false);
});
