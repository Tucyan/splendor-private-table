import test from 'node:test';
import assert from 'node:assert/strict';
import {tableChanges} from '../public/table-effects.js';
const snapshot=()=>({me:{id:'me'},room:{code:'123456',version:1,game:{players:[{id:'me',cards:[],gems:{blue:0}},{id:'other',cards:[],gems:{blue:0}}],market:{1:[{id:'a',level:1}]}}}});
test('opponent acquisitions and replacement cards are detected without own flights',()=>{
 const before=snapshot(),after=structuredClone(before);after.room.version++;
 after.room.game.players[1].cards.push({id:'a',level:1});after.room.game.players[1].gems.blue=2;
 after.room.game.players[0].gems.blue=1;after.room.game.market[1]=[{id:'b',level:1}];
 const changes=tableChanges(before,after);
 assert.deepEqual(changes.cards,[{playerId:'other',card:{id:'a',level:1}}]);
 assert.deepEqual(changes.gems,[{playerId:'other',color:'blue',count:2}]);
 assert.deepEqual(changes.dealt,[{id:'b',level:1}]);
});
test('initial load, duplicate events, changed room and missed versions never replay actions',()=>{
 const before=snapshot(),after=structuredClone(before);after.room.game.players[1].gems.blue=2;
 for(const prior of [null,before])assert.deepEqual(tableChanges(prior,after),{cards:[],gems:[],dealt:[]});
 after.room.version=4;assert.equal(tableChanges(before,after).gems.length,0);
 after.room.version=2;after.room.code='654321';assert.equal(tableChanges(before,after).gems.length,0);
});
test('payment and discard decreases do not produce gem flights; own replacement still animates',()=>{
 const before=snapshot(),after=structuredClone(before);after.room.version++;
 before.room.game.players[1].gems.blue=3;after.room.game.players[1].gems.blue=1;
 after.room.game.players[0].cards.push({id:'a',level:1});after.room.game.market[1]=[{id:'c',level:1}];
 const changes=tableChanges(before,after);assert.equal(changes.cards.length,0);assert.equal(changes.gems.length,0);assert.equal(changes.dealt[0].id,'c');
});
