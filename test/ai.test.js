import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, chooseAIAction } from '../src/ai.js';

const player = { id:'a',name:'A',gems:{white:0},bonuses:{},cards:[],reserved:[],nobles:[],score:0 };
const game = { players:[player,{...player,id:'b',reserved:[{id:'SECRET',level:1}]}],turn:0,round:1,market:{1:[],2:[],3:[]},decks:{1:['DECK_SECRET'],2:[],3:[]},nobles:[],bank:{white:4},pending:null };
const actions = [{type:'take',gems:{white:1}}];

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

test('DeepSeek request selects a supplied legal action and has no chat history', async () => {
  let calls=0;
  const result=await chooseAIAction(game,'a',actions,{key:'test-only',fetchImpl:async (url,opts)=>{
    calls++;
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    const body=JSON.parse(opts.body);
    assert.equal(body.response_format.type,'json_object');
    assert.equal(body.messages.length,2);
    return {ok:true,json:async()=>({choices:[{message:{content:'{"actionIndex":0}'}}],usage:{prompt_cache_hit_tokens:64}})};
  }});
  assert.deepEqual(result.action,actions[0]);
  assert.equal(result.source,'deepseek');
  assert.equal(calls,1);
});

test('invalid output and request failure fall back without a retry', async () => {
  for(const content of ['{"actionIndex":999}','not json','']){
    let calls=0;
    const result=await chooseAIAction(game,'a',actions,{key:'test-only',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content}}]})};}});
    assert.equal(result.source,'fallback');
    assert.deepEqual(result.action,actions[0]);
    assert.equal(calls,1);
  }
  let calls=0;
  const result=await chooseAIAction(game,'a',actions,{key:'test-only',fetchImpl:async()=>{calls++;throw new Error('private-secret-error');}});
  assert.equal(result.source,'fallback');
  assert.ok(!JSON.stringify(result).includes('private-secret'));
  assert.equal(calls,1);
});

test('unconfigured AI uses a labelled local strategy', async () => {
  const result=await chooseAIAction(game,'a',actions,{key:''});
  assert.equal(result.source,'local');
  assert.deepEqual(result.action,actions[0]);
});
