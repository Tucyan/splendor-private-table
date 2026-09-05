import test from 'node:test';
import assert from 'node:assert/strict';
import {canAffordCard,purchaseGap,discountedCost} from '../public/player-view.js';

test('affordability includes permanent discounts without requiring the player turn',()=>{
  const player={bonuses:{green:2},gems:{blue:2}};
  assert.equal(canAffordCard(player,{cost:{green:2,blue:2}}),true);
  assert.equal(canAffordCard(player,{cost:{green:3,blue:2}}),false);
});
test('gold covers the total shortfall across colors, not each color independently',()=>{
  const card={cost:{blue:2,red:2}};
  assert.equal(canAffordCard({bonuses:{},gems:{blue:1,red:1,gold:1}},card),false);
  assert.equal(canAffordCard({bonuses:{},gems:{blue:1,red:1,gold:2}},card),true);
});
test('fully discounted cards are free and checking does not change resources',()=>{
  const player={bonuses:{white:4},gems:{gold:1}};
  const before=structuredClone(player);
  assert.equal(canAffordCard(player,{cost:{white:3}}),true);
  assert.deepEqual(player,before);
  assert.equal(canAffordCard(null,{cost:{}}),false);
});

test('hover shortfall explains colors before gold and the remaining total after gold',()=>{
  assert.deepEqual(purchaseGap({bonuses:{blue:1},gems:{blue:1,red:1,gold:2}},{cost:{blue:4,red:2}}),{
    colors:{blue:2,red:1},goldUsed:2,remaining:1,
  });
  assert.equal(purchaseGap({bonuses:{blue:2},gems:{gold:2}},{cost:{blue:4}}).remaining,0);
});

test('displayed price only subtracts permanent bonuses, never holdings or gold',()=>{
  const player={bonuses:{green:1},gems:{white:1,blue:0,gold:5}};
  assert.deepEqual(discountedCost(player,{cost:{white:2,blue:1,green:1}}),{white:2,blue:1,green:0,red:0,black:0});
});
