const ADVANCED_MODE = 'deepseek-advanced';

const statusSource = room => room?.reflectionStatus ?? room?.reflection ?? room?.aiReflection;
const valueOf = value => typeof value === 'string' ? value : value?.state ?? value?.status;

/**
 * Convert the server's reflection lifecycle snapshot into a bounded UI model.
 * The room may expose the status under any of the supported transitional names
 * while older snapshots omit it entirely.
 */
export function reflectionStatusView(room) {
  if (room?.game?.status !== 'finished') return null;
  if (!room?.players?.some(player => player.ai && player.mode === ADVANCED_MODE)) return null;

  const source = statusSource(room);
  const rawState = String(valueOf(source) || 'syncing').toLowerCase();
  const state = rawState === 'saved' || rawState === 'completed' || rawState === 'success'
    ? 'saved'
    : rawState === 'continue' || rawState === 'fallback' || rawState === 'using_previous'
      ? 'continue'
      : rawState === 'failed' || rawState === 'error'
        ? (source?.continueWithPrevious || source?.usePrevious ? 'continue' : 'failed')
        : 'syncing';

  if (state === 'saved') {
    const lessons = Number(source?.lessons);
    const detail = Number.isInteger(lessons) && lessons >= 0
      ? `本局已保存 ${lessons} 条候选经验，可供后续高级对局参考。`
      : '这局公开信息已整理并保存，可供后续高级对局参考。';
    return { state, kind: 'success', label: '经验已保存', detail };
  }
  if (state === 'failed') {
    return { state, kind: 'error', label: '经验同步失败', detail: '本局经验暂未保存；不会影响刚刚完成的对局。' };
  }
  if (state === 'continue') {
    return { state, kind: 'warning', label: '同步失败，继续使用上次经验', detail: '本局仍可正常进行；新的经验将在下次同步时重试。' };
  }
  return { state: 'syncing', kind: 'pending', label: '经验同步中', detail: '正在整理这局公开信息，稍后保存为长期经验。' };
}
