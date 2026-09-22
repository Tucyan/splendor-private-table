import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pid } from 'node:process';

const ALLOWED = new Set(['timestamp', 'pid', 'level', 'type', 'requestId', 'gameId', 'playerId', 'turn', 'attempt', 'phase', 'durationMs', 'status', 'reasonCode', 'data']);
const FORBIDDEN = /^(prompt|messages|authorization|apiKey|content|body|stack|raw)$/i;
const scalar = value => value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

function safeValue(value, apiKey, depth = 0) {
  if (depth > 3 || value === undefined || typeof value === 'function') return undefined;
  if (scalar(value)) {
    const text = typeof value === 'string' ? value.replace(apiKey || '\u0000', '[REDACTED]').slice(0, 500) : value;
    return text;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(item, apiKey, depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value).slice(0, 40)) {
      if (FORBIDDEN.test(key)) continue;
      const safe = safeValue(child, apiKey, depth + 1);
      if (safe !== undefined) result[key.slice(0, 80)] = safe;
    }
    return result;
  }
  return undefined;
}

export class LlmLogger {
  constructor({ directory, enabled = true, apiKey = '', maxBytes = 10 * 1024 * 1024 } = {}) {
    this.directory = directory;
    this.enabled = enabled !== false && typeof directory === 'string' && directory.length > 0;
    this.apiKey = apiKey;
    this.maxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 10 * 1024 * 1024;
    this.path = directory ? join(directory, 'llm-events.jsonl') : null;
    this.previousPath = directory ? join(directory, 'llm-events.previous.jsonl') : null;
    this.queue = Promise.resolve();
  }

  write(input = {}) {
    if (!this.enabled) return Promise.resolve();
    const task = this.queue.then(() => this._write(input));
    this.queue = task.catch(error => {
      console.error(`[llm-log] write failed: ${error?.code || error?.message || 'unknown'}`);
    });
    return this.queue;
  }

  flush() { return this.queue; }

  async _write(input) {
    const event = { timestamp: new Date().toISOString(), pid };
    for (const key of ALLOWED) {
      if (!Object.hasOwn(input, key) || key === 'timestamp' || key === 'pid') continue;
      if (key === 'data') {
        event.data = safeValue(input.data, this.apiKey);
      } else if (!FORBIDDEN.test(key)) {
        const value = safeValue(input[key], this.apiKey);
        if (value !== undefined) event[key] = value;
      }
    }
    const line = `${JSON.stringify(event)}\n`;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let size = 0;
    try { size = (await stat(this.path)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) {
      await rm(this.previousPath, { force: true });
      await rename(this.path, this.previousPath);
    }
    await appendFile(this.path, line, { encoding: 'utf8', mode: 0o600 });
  }
}
