/**
 * LLM 重试与退避（设计 7.9，需求 10.8）。
 *
 * - 单次尝试 60 秒超时；超时视为瞬时错误。
 * - 瞬时错误最多重试 2 次，重试前依次等待 1000ms、2000ms（clock.sleep，可被 signal 中止）。
 * - 永久错误不重试；signal 已中止则立即抛 AbortError。
 */

import { LlmPermanentError, LlmTransientError } from '../llm/client.js';
import type { ChatResponse, Clock } from './types.js';

export const ATTEMPT_TIMEOUT_MS = 60_000;
export const BACKOFF_MS: readonly number[] = [1000, 2000];

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export async function callWithRetry(
  fn: (signal: AbortSignal) => Promise<ChatResponse>,
  clock: Clock,
  signal: AbortSignal,
  attemptTimeoutMs: number = ATTEMPT_TIMEOUT_MS,
): Promise<ChatResponse> {
  if (signal.aborted) throw abortError();

  for (let attempt = 0; ; attempt++) {
    const timeoutSignal = AbortSignal.timeout(attemptTimeoutMs);
    const combined = AbortSignal.any([signal, timeoutSignal]);
    let transient: unknown;
    try {
      return await fn(combined);
    } catch (err) {
      if (signal.aborted) throw isAbortError(err) ? err : abortError();
      if (err instanceof LlmPermanentError) throw err;
      if (err instanceof LlmTransientError) {
        transient = err;
      } else if (isAbortError(err) && timeoutSignal.aborted) {
        transient = new LlmTransientError(`LLM 请求超时（${attemptTimeoutMs}ms）`);
      } else {
        throw err;
      }
    }

    if (attempt >= BACKOFF_MS.length) throw transient;
    await clock.sleep(BACKOFF_MS[attempt]!, signal);
    if (signal.aborted) throw abortError();
  }
}
