/** Termination_Reason 的中文说明（需求 14.3、14.4） */
export const TERMINATION_LABELS: Record<string, string> = {
  answered: '已完成回答',
  max_steps: '已达到最大推理步数，以现有信息总结作答',
  repeated_call: '检测到重复的工具调用，已提前总结作答',
  token_budget: '已达到 token 预算上限',
  timeout: '运行超时（超过 120 秒）',
  tool_failure: '工具连续失败，已终止',
  llm_failure: 'LLM 服务不可用，已终止',
  cancelled: '已被取消',
};

export function terminationLabel(reason?: string | null): string {
  if (!reason) return '未知原因';
  return TERMINATION_LABELS[reason] ?? `未知原因（${reason}）`;
}

/** 非 answered 时回答可能不完整（需求 14.4） */
export function isIncomplete(reason?: string | null): boolean {
  return reason !== 'answered';
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  ok: '成功',
  error: '失败',
  rejected: '失败（被拒绝）',
  skipped: '已跳过',
};

export function toolStatusLabel(status?: string): string {
  return (status && TOOL_STATUS_LABELS[status]) || '未知';
}

export function formatCost(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(4)}` : '—';
}

export function formatMs(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n)} ms` : '—';
}

export function formatDateTime(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
