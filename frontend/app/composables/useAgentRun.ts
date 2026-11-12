import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { StudioError, MSG_SESSION_EXPIRED, MSG_UNAVAILABLE, useStudio, type StudioClient } from './useStudio';
import { useOwnerSession, type OwnerSession } from './useOwnerSession';

export const AGENT_POLL_INTERVAL_MS = 500;
export const AGENT_CANCEL_TIMEOUT_MS = 10000;
export const MSG_CANCEL_TIMEOUT = '取消请求超时';
export const MSG_QUESTION_EMPTY = '问题不能为空';

export type ToolStatus = 'running' | 'ok' | 'error';

export interface ProgressStep {
  step: number;
  phase: 'thinking' | 'tools';
  /** 被取消中止的步骤（需求 14.6） */
  aborted?: boolean;
  tools: { name: string; status: ToolStatus }[];
}

export interface AgentRunResult {
  answer: string;
  terminationReason: string;
  stepCount: number;
  totalTokens: number;
  estimatedCost: number;
  redacted?: boolean;
}

export interface ProgressSnapshot {
  runId: string;
  state: 'running' | 'finished';
  currentStep: number;
  steps: ProgressStep[];
  result?: AgentRunResult;
}

export interface AgentRunDeps {
  studio: Pick<StudioClient, 'request'>;
  session: Pick<OwnerSession, 'current' | 'clear'>;
  pollIntervalMs?: number;
  cancelTimeoutMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/** 把 Studio 错误转成面向 Owner 的提示；429/5xx 带状态码（需求 14.9） */
function messageFor(e: unknown): string {
  if (e instanceof StudioError) {
    if (e.status === 401) return MSG_SESSION_EXPIRED;
    if (e.status === 429 || e.status >= 500) return `${e.message || '请求失败'}（状态码 ${e.status}）`;
    if (e.status === 0) return MSG_UNAVAILABLE;
    return e.message;
  }
  return MSG_UNAVAILABLE;
}

/** Agent 运行：提交、500ms 轮询、取消（需求 14.2、14.6–14.9） */
export function createAgentRun(deps: AgentRunDeps) {
  const interval = deps.pollIntervalMs ?? AGENT_POLL_INTERVAL_MS;
  const cancelTimeout = deps.cancelTimeoutMs ?? AGENT_CANCEL_TIMEOUT_MS;
  const setT = deps.setTimeout ?? ((...a: Parameters<typeof setTimeout>) => setTimeout(...a));
  const clearT = deps.clearTimeout ?? ((id: any) => clearTimeout(id));

  /** Owner 输入的问题；任何失败都不清空（需求 14.6、14.9） */
  const question = ref('');
  const running = ref(false);
  const cancelling = ref(false);
  const progress = ref<ProgressSnapshot | null>(null);
  const error = ref<string | null>(null);
  const runId = ref<string | null>(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 每次提交/停止递增，使过期的轮询结果被丢弃 */
  let epoch = 0;

  function stopPolling() {
    epoch++;
    if (timer) clearT(timer);
    timer = undefined;
    running.value = false;
    cancelling.value = false;
  }

  function fail(e: unknown) {
    error.value = messageFor(e);
    stopPolling();
  }

  function applySnapshot(s: ProgressSnapshot | null | undefined): boolean {
    if (!s || typeof s !== 'object') return false;
    progress.value = s;
    if (s.state === 'finished') {
      stopPolling();
      return true;
    }
    return false;
  }

  function schedule(myEpoch: number) {
    timer = setT(async () => {
      if (myEpoch !== epoch || !runId.value) return;
      try {
        const s = await deps.studio.request<ProgressSnapshot>(`/v1/agent/runs/${encodeURIComponent(runId.value)}/progress`);
        if (myEpoch !== epoch) return;
        if (!applySnapshot(s)) schedule(myEpoch);
      } catch (e) {
        if (myEpoch !== epoch) return;
        fail(e);
      }
    }, interval);
  }

  async function submit(): Promise<boolean> {
    const q = question.value;
    if (!q.trim()) {
      error.value = MSG_QUESTION_EMPTY;
      return false; // 不发送请求（需求 14.10）
    }
    if (running.value) return false;
    error.value = null;
    progress.value = null;
    runId.value = null;
    stopPolling();
    const myEpoch = epoch;
    running.value = true;
    try {
      const res = await deps.studio.request<{ runId: string }>('/v1/agent/runs', { method: 'POST', body: { question: q } });
      if (myEpoch !== epoch) return false;
      runId.value = res.runId;
      schedule(myEpoch);
      return true;
    } catch (e) {
      if (myEpoch === epoch) fail(e);
      return false;
    }
  }

  async function cancel(): Promise<void> {
    const id = runId.value;
    if (!id || !running.value || cancelling.value) return;
    cancelling.value = true;
    const myEpoch = epoch;
    try {
      const res = await deps.studio.request<ProgressSnapshot | null>(`/v1/agent/runs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        timeoutMs: cancelTimeout,
      });
      if (myEpoch !== epoch) return;
      // 取消响应结束后停止展示进度，并保留已有 Trace（需求 14.6）
      if (res && typeof res === 'object' && Array.isArray((res as ProgressSnapshot).steps)) {
        progress.value = res as ProgressSnapshot;
      }
      stopPolling();
    } catch (e) {
      if (myEpoch !== epoch) return;
      if (e instanceof StudioError && e.status === 0) {
        // 10 秒内无响应（需求 14.7）；保留已展示的 Trace
        error.value = MSG_CANCEL_TIMEOUT;
        stopPolling();
      } else {
        fail(e);
      }
    }
  }

  function dispose() {
    stopPolling();
  }

  return { question, running, cancelling, progress, error, runId, submit, cancel, dispose };
}

export type AgentRun = ReturnType<typeof createAgentRun>;

/** Nuxt composable：每个调用方独立的 Agent 运行状态，共享 Studio 客户端与会话 */
export function useAgentRun(): AgentRun {
  const run = createAgentRun({ studio: useStudio(), session: useOwnerSession() });
  if (getCurrentScope()) onScopeDispose(run.dispose);
  return run;
}
