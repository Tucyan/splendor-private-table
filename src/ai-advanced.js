import { buildAdvancedContext } from './ai-advanced-context.js';
import { analyzeAdvancedActions } from './ai-advanced-evaluation.js';
import { localAction } from './ai.js';
import { requestLlmJson, llmReasonCode } from './llm-client.js';

export async function chooseAdvancedAction(game, playerId, actions, { llmConfig, signal, requestJson = requestLlmJson, context, analysis, observationMemory, planMemory, gameId = 'current', experiences = [] } = {}) {
  const tacticalAction=action=>actions.includes(action)?action:null;
  if (!llmConfig?.enabled) return { action: tacticalAction(analysis?.action) || localAction(game, playerId, actions), source: 'local' };
  const facts = analysis || analyzeAdvancedActions(game, playerId, actions, { observation: context?.observation });
  const advancedContext = context || buildAdvancedContext(game, playerId, { tacticalAnalysis: facts, observationMemory, planMemory, gameId, experiences });
  const baseMessages=[
    { role:'system',content:'只返回 JSON：{"actionIndex": number, "plan": string}。actionIndex 必须对应候选动作。' },
    { role:'user',content:JSON.stringify({ context:advancedContext,actions:actions.map((action,index)=>({index,action})) }) },
  ];
  let retryMessages=[];
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try {
      const result = await requestJson({
        config:llmConfig,
        model:llmConfig.advancedModel,
        messages:[...baseMessages,...retryMessages],
        maxTokens:null,
        temperature:0.3,
        signal,
      });
      const index=result?.data?.actionIndex;
      if(!Number.isInteger(index)||index<0||index>=actions.length){
        const error=new Error(`LLM returned an invalid action index: ${String(index)}`);
        error.code='LLM_INVALID_ACTION';
        error.responseData=result?.data;
        throw error;
      }
      return { action:actions[index],source:'llm-advanced',plan:typeof result.data.plan==='string'?result.data.plan.slice(0,500):'' };
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
      notice:'LLM 高级本回合使用战术兜底。',
    };
  }
}
