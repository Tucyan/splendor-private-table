import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, chooseAIAction } from '../src/ai.js';

const player = { id:'a',name:'A',gems:{white:0},bonuses:{},cards:[],reserved:[],nobles:[],score:0 };
const game = { players:[player,{...player,id:'b',reserved:[{id:'SECRET',level:1}]}],turn:0,round:1,market:{1:[],2:[],3:[]},decks:{1:['DECK_SECRET'],2:[],3:[]},nobles:[],bank:{white:4},pending:null };
const actions = [{type:'take',gems:{white:1}}];
const llmConfig = Object.freeze({
  enabled:true,apiKey:'fixture-secret',apiUrl:'https://llm.example/v1/chat/completions',
  model:'base-model',advancedModel:'advanced-model',reflectionModel:'reflection-model',timeoutMs:321,extraBody:{},
});

test('AI receives the configured score and seat order with the same system prefix',()=>{
  const messages=buildMessages({...game,finishScore:20,turnOrder:['b','a']},'a',actions);
  const table=JSON.parse(messages[1].content).table;
  assert.equal(table.finishScore,20);
  assert.equal(table.seat,1);
  assert.deepEqual(table.turnOrder,['b','a']);
  assert.equal(messages[0].content,buildMessages(game,'a',actions)[0].content);
});

test('AI messages have a stable system prefix, current state only and hide private cards', () => {
  const messages=buildMessages(game,'a',actions);
  assert.equal(messages[0].role,'system');
  assert.match(messages[0].content,/json/i);
  assert.equal(messages[0].content,buildMessages({...game,round:2},'a',actions)[0].content);
  assert.equal(messages.length,2);
  const content=messages[1].content;
  assert.ok(content.indexOf('self') < content.indexOf('table'));
  assert.ok(content.indexOf('table') < content.indexOf('bank'));
  assert.ok(!content.includes('SECRET'));
  assert.ok(content.includes('legalActions'));
});

test('basic LLM uses the injected base model and selects the original supplied action', async () => {
  let calls=0;
  const result=await chooseAIAction(game,'a',actions,{llmConfig,requestJson:async options=>{
    calls++;
    assert.equal(options.config,llmConfig);
    assert.equal(options.model,'base-model');
    assert.equal(options.messages.length,2);
    assert.equal(options.maxTokens,null);
    return {data:{actionIndex:0},usage:null,finishReason:'stop'};
  }});
  assert.equal(result.action,actions[0]);
  assert.equal(result.source,'llm-basic');
  assert.equal(calls,1);
});

test('basic LLM passes correlation context to the shared request logger', async () => {
  let received;
  const logger = { write: async () => {} };
  await chooseAIAction(game, 'a', actions, {
    llmConfig,
    logger,
    gameId: 'game-basic-1',
    turn: 2,
    requestJson: async options => { received = options; return { data: { actionIndex: 0 }, usage: null, finishReason: 'stop' }; },
  });
  assert.equal(received.logger, logger);
  assert.equal(received.gameId, 'game-basic-1');
  assert.equal(received.playerId, 'a');
  assert.equal(received.turn, 2);
  assert.equal(received.phase, 'basic-decision');
});

test('invalid basic output falls back once with a stable reason code and safe notice', async () => {
  for(const actionIndex of [999,-1,0.5,'0',undefined]){
    let calls=0;
    const result=await chooseAIAction(game,'a',actions,{llmConfig,requestJson:async()=>{
      calls++;
      return {data:{actionIndex},usage:null,finishReason:'stop'};
    }});
    assert.equal(result.source,'llm-basic-fallback');
    assert.equal(result.reasonCode,'LLM_INVALID_ACTION');
    assert.deepEqual(result.action,actions[0]);
    assert.match(result.notice,/本地策略/);
    assert.ok(!JSON.stringify(result).includes(llmConfig.apiKey));
    assert.equal(calls,1);
  }
});

test('basic request errors preserve shared error codes and normalize unknown failures', async () => {
  for(const [error,reasonCode] of [
    [Object.assign(new Error(`provider leaked ${llmConfig.apiKey}`),{code:'LLM_TIMEOUT'}),'LLM_TIMEOUT'],
    [new Error(`unknown leaked ${llmConfig.apiKey}`),'LLM_UNKNOWN_ERROR'],
  ]){
    let calls=0;
    const result=await chooseAIAction(game,'a',actions,{llmConfig,requestJson:async()=>{calls++;throw error;}});
    assert.equal(result.source,'llm-basic-fallback');
    assert.equal(result.reasonCode,reasonCode);
    assert.match(result.notice,/本地策略/);
    assert.ok(!JSON.stringify(result).includes(llmConfig.apiKey));
    assert.equal(calls,1);
  }
});

test('unconfigured chooser uses a labelled local strategy without requesting an LLM', async () => {
  let calls=0;
  const result=await chooseAIAction(game,'a',actions,{llmConfig:{enabled:false},requestJson:async()=>{calls++;}});
  assert.equal(result.source,'local');
  assert.deepEqual(result.action,actions[0]);
  assert.equal(calls,0);
});
