import { buildAdvancedContext } from './ai-advanced-context.js';
import { analyzeAdvancedActions } from './ai-advanced-evaluation.js';
import { localAction } from './ai.js';

const timeout = (signal, ms) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true }); return { controller, timer }; };

export async function chooseAdvancedAction(game, playerId, actions, { key = process.env.deepseekkey || process.env.DEEPSEEK_API_KEY || '', signal, fetchImpl = fetch, model = process.env.DEEPSEEK_ADVANCED_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash', context, analysis, observationMemory, planMemory, gameId = 'current', experiences = [], timeoutMs = 20000 } = {}) {
  const fallback = () => ({ action: analysis?.action || localAction(game, playerId, actions), source: 'deepseek-advanced-fallback', notice: 'DeepSeek 高级本回合使用战术兜底。' });
  if (!key) return fallback();
  const facts = analysis || analyzeAdvancedActions(game, playerId, actions, { observation: context?.observation });
  const advancedContext = context || buildAdvancedContext(game, playerId, { tacticalAnalysis: facts, observationMemory, planMemory, gameId, experiences });
  const { controller, timer } = timeout(signal, timeoutMs);
  try {
    const response = await fetchImpl('https://api.deepseek.com/chat/completions', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: '只返回 JSON：{"actionIndex": number, "plan": string}。actionIndex 必须对应候选动作。' }, { role: 'user', content: JSON.stringify({ context: advancedContext, actions: actions.map((action, index) => ({ index, action })) }) }], response_format: { type: 'json_object' }, max_tokens: 256, temperature: 0.3, stream: false }) });
    if (!response.ok) throw new Error(`advanced HTTP ${response.status}`);
    const data = await response.json(); const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const index = Number.isInteger(result.actionIndex) ? result.actionIndex : -1;
    if (index < 0 || index >= actions.length) throw new Error('advanced action index invalid');
    return { action: actions[index], source: 'deepseek-advanced', plan: typeof result.plan === 'string' ? result.plan.slice(0, 500) : '' };
  } catch { return fallback(); } finally { clearTimeout(timer); }
}
