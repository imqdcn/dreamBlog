/**
 * 会话历史（需求 11.5）。按 sid 保存最近 3 轮 {question, answer}。
 * - 回答存入时截断到 2000 字符
 * - 最多缓存 50 个会话，超出时淘汰最久未更新的会话
 * - 会话超过 exp 后清理
 * - 不保存工具调用明细
 * 纯逻辑，时钟由调用方注入。
 */
export interface Turn {
  question: string;
  answer: string;
}

export const MAX_TURNS = 3;
export const MAX_SESSIONS = 50;
export const MAX_ANSWER_CHARS = 2000;

interface Entry {
  turns: Turn[];
  /** 会话过期时间（毫秒时间戳）。 */
  expiresAtMs: number;
}

export class SessionMemory {
  private readonly sessions = new Map<string, Entry>();

  /** 取最近至多 3 轮历史（按时间顺序）；会话已过期则清理并返回空数组。 */
  get(sid: string, nowMs: number): Turn[] {
    const entry = this.sessions.get(sid);
    if (!entry) return [];
    if (entry.expiresAtMs <= nowMs) {
      this.sessions.delete(sid);
      return [];
    }
    return entry.turns.map((t) => ({ ...t }));
  }

  /** 追加一轮问答，仅保存问题与最终回答。 */
  append(sid: string, turn: Turn, expiresAtMs: number, nowMs: number): void {
    this.sweep(nowMs);
    const prev = this.sessions.get(sid);
    const turns = prev ? prev.turns.slice() : [];
    turns.push({
      question: turn.question,
      answer: Array.from(turn.answer).slice(0, MAX_ANSWER_CHARS).join(''),
    });
    // 重新插入使 Map 的迭代顺序等于「最近更新」顺序
    this.sessions.delete(sid);
    this.sessions.set(sid, { turns: turns.slice(-MAX_TURNS), expiresAtMs });

    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  /** 清理已过期会话。 */
  sweep(nowMs: number): void {
    for (const [sid, entry] of this.sessions) {
      if (entry.expiresAtMs <= nowMs) this.sessions.delete(sid);
    }
  }

  size(): number {
    return this.sessions.size;
  }
}
