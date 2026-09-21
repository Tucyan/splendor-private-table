import { buildAdvancedContext } from './ai-advanced-context.js';
import { analyzeAdvancedActions } from './ai-advanced-evaluation.js';
import { localAction } from './ai.js';
import { requestLlmJson } from './llm-client.js';

const reasonCodeOf = error => (
  typeof error?.code === 'string' && /^LLM_[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : 'LLM_UNKNOWN_ERROR'
);

export async function chooseAdvancedAction(game, playerId, actions, { llmConfig, signal, requestJson = requestLlmJson, context, analysis, observationMemory, planMemory, gameId = 'current', experiences = [] } = {}) {
  const tacticalAction=action=>actions.includes(action)?action:null;
  if (!llmConfig?.enabled) return { action: tacticalAction(analysis?.action) || localAction(game, playerId, actions), source: 'local' };
  const facts = analysis || analyzeAdvancedActions(game, playerId, actions, { observation: context?.observation });
  const advancedContext = context || buildAdvancedContext(game, playerId, { tacticalAnalysis: facts, observationMemory, planMemory, gameId, experiences });
  try {
    const result = await requestJson({
      config:llmConfig,
      model:llmConfig.advancedModel,
      messages:[
        { role:'system',content:'只返回 JSON：{"actionIndex": number, "plan": string}。actionIndex 必须对应候选动作。' },
        { role:'user',content:JSON.stringify({ context:advancedContext,actions:actions.map((action,index)=>({index,action})) }) },
      ],
      maxTokens:256,
      temperature:0.3,
      signal,
    });
    const index=result?.data?.actionIndex;
    if(!Number.isInteger(index)||index<0||index>=actions.length){
      const error=new Error('LLM returned an invalid action index');
      error.code='LLM_INVALID_ACTION';
      throw error;
    }
    return { action:actions[index],source:'llm-advanced',plan:typeof result.data.plan==='string'?result.data.plan.slice(0,500):'' };
  } catch (error) {
    return {
      action:tacticalAction(facts?.action)||localAction(game,playerId,actions),
      source:'llm-advanced-fallback',
      reasonCode:reasonCodeOf(error),
      notice:'LLM 高级本回合使用战术兜底。',
    };
  }
}
