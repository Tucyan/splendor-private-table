import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions } from '../src/game.js';
import { chooseAdvancedAction } from '../src/ai-advanced.js';

const llmConfig = Object.freeze({
  enabled:true,apiKey:'fixture-secret',apiUrl:'https://llm.example/v1/chat/completions',
  model:'base-model',advancedModel:'advanced-model',reflectionModel:'reflection-model',timeoutMs:321,extraBody:{},
});

test('advanced chooser uses the injected advanced model and returns only an original supplied action', async () => {
  const game=createGame([{id:'a'},{id:'b'}]);
  const actions=legalActions(game,'a');
  let request;
  const result=await chooseAdvancedAction(game,'a',actions,{llmConfig,requestJson:async options=>{
    request=options;
    return {data:{actionIndex:0,plan:'x'.repeat(700)},usage:null,finishReason:'stop'};
  }});
  assert.equal(request.config,llmConfig);
  assert.equal(request.model,'advanced-model');
  assert.ok(request.messages[1].content.length < 30000);
  assert.equal(result.action,actions[0]);
  assert.equal(result.source,'llm-advanced');
  assert.equal(result.plan.length,500);
});

test('advanced chooser prefers its tactical action on invalid model output', async () => {
  const game=createGame([{id:'a'},{id:'b'}]);
  const actions=legalActions(game,'a');
  const tactical=actions.at(-1);
  const result=await chooseAdvancedAction(game,'a',actions,{
    llmConfig,analysis:{action:tactical},
    requestJson:async()=>({data:{actionIndex:999},usage:null,finishReason:'stop'}),
  });
  assert.equal(result.action,tactical);
  assert.equal(result.source,'llm-advanced-fallback');
  assert.equal(result.reasonCode,'LLM_INVALID_ACTION');
  assert.match(result.notice,/战术兜底/);
});

test('advanced fallback rejects a tactical action that is not one of the legal candidates', async () => {
  const game=createGame([{id:'a'},{id:'b'}]);
  const actions=legalActions(game,'a');
  const result=await chooseAdvancedAction(game,'a',actions,{
    llmConfig,analysis:{action:{type:'pass'}},
    requestJson:async()=>({data:{actionIndex:999},usage:null,finishReason:'stop'}),
  });
  assert.ok(actions.includes(result.action));
  assert.notDeepEqual(result.action,{type:'pass'});
  assert.equal(result.reasonCode,'LLM_INVALID_ACTION');
});

test('advanced chooser preserves shared errors, hides provider details and normalizes unknown failures', async () => {
  const game=createGame([{id:'a'},{id:'b'}]);
  const actions=legalActions(game,'a');
  for(const [error,reasonCode] of [
    [Object.assign(new Error(`provider leaked ${llmConfig.apiKey}`),{code:'LLM_HTTP_500'}),'LLM_HTTP_500'],
    [new Error(`unknown leaked ${llmConfig.apiKey}`),'LLM_UNKNOWN_ERROR'],
  ]){
    const result=await chooseAdvancedAction(game,'a',actions,{llmConfig,requestJson:async()=>{throw error;}});
    assert.equal(result.source,'llm-advanced-fallback');
    assert.equal(result.reasonCode,reasonCode);
    assert.ok(!JSON.stringify(result).includes(llmConfig.apiKey));
  }
});

test('unconfigured advanced chooser stays local and never requests an LLM', async () => {
  const game=createGame([{id:'a'},{id:'b'}]);
  const actions=legalActions(game,'a');
  let calls=0;
  const result=await chooseAdvancedAction(game,'a',actions,{llmConfig:{enabled:false},requestJson:async()=>{calls++;}});
  assert.ok(actions.includes(result.action));
  assert.equal(result.source,'local');
  assert.equal(calls,0);
});
