import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPlayerGrid,publicPlayerResources,publicPlayerSummary} from '../public/player-summary.js';

test('public player summary keeps six gem counts in a stable color order',()=>{
  const summary=publicPlayerSummary({
    score:12,
    gems:{white:1,blue:2,green:3,red:0,black:4,gold:1},
    bonuses:{white:2,blue:0,green:1,red:3,black:0},
    reserved:[{id:'hidden-one'},{id:'hidden-two'}],
  });

  assert.equal(summary.score,12);
  assert.equal(summary.reservedCount,2);
  assert.deepEqual(summary.gems,[
    ['white',1],['blue',2],['green',3],['red',0],['black',4],['gold',1],
  ]);
  assert.deepEqual(summary.bonuses,[
    ['white',2],['blue',0],['green',1],['red',3],['black',0],
  ]);
  assert.equal(JSON.stringify(summary).includes('hidden-one'),false);
});

test('public player summary treats missing public collections as empty',()=>{
  assert.deepEqual(publicPlayerSummary({score:0}),{
    score:0,
    reservedCount:0,
    gems:[['white',0],['blue',0],['green',0],['red',0],['black',0],['gold',0]],
    bonuses:[['white',0],['blue',0],['green',0],['red',0],['black',0]],
  });
});

test('public player resources attach card counts to colors but never to gold',()=>{
  const resources=publicPlayerResources({
    gems:{white:2,gold:1},
    bonuses:{white:3},
  });

  assert.deepEqual(resources[0],{color:'white',gemCount:2,cardCount:3});
  assert.deepEqual(resources.at(-1),{color:'gold',gemCount:1});
  assert.equal('cardCount' in resources.at(-1),false);
});

test('public player grid uses the sixth lower cell for reserved cards',()=>{
  const grid=publicPlayerGrid({
    gems:{white:2,gold:1},
    bonuses:{white:3,black:1},
    reserved:[{id:'hidden-one'},{id:'hidden-two'}],
  });

  assert.equal(grid.top.length,6);
  assert.deepEqual(grid.top.at(-1),{color:'gold',count:1});
  assert.equal(grid.bottom.length,6);
  assert.deepEqual(grid.bottom.slice(0,5),[
    {kind:'card',color:'white',count:3},
    {kind:'card',color:'blue',count:0},
    {kind:'card',color:'green',count:0},
    {kind:'card',color:'red',count:0},
    {kind:'card',color:'black',count:1},
  ]);
  assert.deepEqual(grid.bottom.at(-1),{kind:'reserved',count:2});
});
