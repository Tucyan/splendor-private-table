import { buildAdvancedContext } from './ai-advanced-context.js';
import { analyzeAdvancedActions } from './ai-advanced-evaluation.js';
import { localAction } from './ai.js';
import { requestLlmJson, llmReasonCode } from './llm-client.js';
import { randomUUID } from 'node:crypto';

export async function chooseAdvancedAction(game, playerId, actions, { llmConfig, signal, requestJson = requestLlmJson, logger, context, analysis, observationMemory, planMemory, gameId = 'current', experiences = [], reasoningEffort = 'off' } = {}) {
  const tacticalAction=action=>actions.includes(action)?action:null;
  if (!llmConfig?.enabled) return { action: tacticalAction(analysis?.action) || localAction(game, playerId, actions), source: 'local' };
  const facts = analysis || analyzeAdvancedActions(game, playerId, actions, { observation: context?.observation });
  const advancedContext = context || buildAdvancedContext(game, playerId, { tacticalAnalysis: facts, observationMemory, planMemory, gameId, experiences });
  const reasoningBody = reasoningEffort === 'off'
    ? { thinking: { type: 'disabled' } }
    : { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort };
  const requestConfig = {
    ...llmConfig,
    extraBody: { ...(llmConfig.extraBody || {}), ...reasoningBody },
  };
  const baseMessages=[
    { role:'system',content:'只返回 JSON：{"actionIndex": number, "plan": string}。actionIndex 必须对应候选动作。' },
    { role:'user',content:JSON.stringify({ context:advancedContext,actions:actions.map((action,index)=>({index,action})) }) },
  ];
  let retryMessages=[];
  let lastError;
  const requestIds=[];
  for(let attempt=1;attempt<=3;attempt++){
    const requestId=randomUUID();requestIds.push(requestId);
    try {
      const result = await requestJson({
        config:requestConfig,
        model:llmConfig.advancedModel,
        messages:[...baseMessages,...retryMessages],
        maxTokens:null,
        temperature:0.3,
        signal,
        logger,requestId,attempt,phase:'advanced-decision',gameId,playerId,turn:game.turn,
      });
      const index=result?.data?.actionIndex;
      if(!Number.isInteger(index)||index<0||index>=actions.length){
        const error=new Error(`LLM returned an invalid action index: ${String(index)}`);
        error.code='LLM_INVALID_ACTION';
        error.responseData=result?.data;
        await logger?.write({type:'llm.invalid_action',level:'warn',requestId,gameId,playerId,turn:game.turn,attempt,phase:'advanced-decision',reasonCode:error.code,data:{actionIndex:error.responseData?.actionIndex,allowedActionCount:actions.length}});
        throw error;
      }
      return { action:actions[index],source:'llm-advanced',plan:typeof result.data.plan==='string'?result.data.plan.slice(0,500):'',attempts:attempt,requestIds };
    } catch (error) {
      lastError=error;
      if(error?.code!=='LLM_INVALID_ACTION'||attempt===3) break;
      retryMessages=[
        ...retryMessages,
        { role:'assistant',content:JSON.stringify(error.responseData ?? { actionIndex: null }) },
        { role:'user',content:JSON.stringify({ error:'上一轮输出了非法操作', actionIndex:error.responseData?.actionIndex ?? null, invalidActionIndex:error.responseData?.actionIndex ?? null, attempt, reason:error.message, allowedActionIndexes:actions.map((_,index)=>index) }) },
      ];
    }
  }
  {
    const error=lastError;
    return {
      action:tacticalAction(facts?.action)||localAction(game,playerId,actions),
      source:'llm-advanced-fallback',
      reasonCode:llmReasonCode(error),
      attempts: requestIds.length,
      requestIds,
      lastFailure:{reasonCode:llmReasonCode(error),message:String(error?.message||'').replace(String(llmConfig?.apiKey||''),'[REDACTED]').slice(0,240)},
      notice:'LLM 高级本回合使用战术兜底。',
    };
  }
}
