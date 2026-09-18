import test from 'node:test'; import assert from 'node:assert/strict';
import { createGame, legalActions } from '../src/game.js'; import { chooseAdvancedAction } from '../src/ai-advanced.js';
test('advanced chooser sends bounded context and returns only a supplied action', async () => {
  const game = createGame([{id:'a'},{id:'b'}]); const actions = legalActions(game,'a'); let body;
  const result = await chooseAdvancedAction(game,'a',actions,{key:'x',fetchImpl:async(_u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({actionIndex:0,plan:'take resources'})}}]})};}});
  assert.ok(actions.includes(result.action)); assert.equal(body.messages[1].role,'user'); assert.ok(body.messages[1].content.length < 30000);
});
test('advanced chooser falls back on invalid model output', async () => {
  const game = createGame([{id:'a'},{id:'b'}]); const actions = legalActions(game,'a'); const result = await chooseAdvancedAction(game,'a',actions,{key:'x',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{}'}}]})})}); assert.ok(actions.includes(result.action)); assert.equal(result.source,'deepseek-advanced-fallback');
});
