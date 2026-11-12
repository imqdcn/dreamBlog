import { describe, expect, it } from 'vitest';
import {
  buildSummarySystemInstruction,
  buildSystemInstruction,
  SUMMARY_INSTRUCTION_SUFFIX,
  toolFailureAnswer,
} from './prompt.js';

describe('buildSystemInstruction', () => {
  const at = Date.UTC(2024, 4, 31, 17, 0, 0); // 上海 2024-06-01 01:00
  it('包含按 TZ 计算的当前日期', () => {
    const s = buildSystemInstruction({ clock: { now: () => at }, tz: 'Asia/Shanghai' });
    expect(s).toContain('今天是 2024-06-01（时区 Asia/Shanghai）');
    expect(buildSystemInstruction({ clock: { now: () => at }, tz: 'UTC' })).toContain('2024-05-31');
  });
  it('包含分隔区约定、引用要求与数据不足说明', () => {
    const s = buildSystemInstruction({ clock: { now: () => at } });
    for (const k of ['<<<DATA', '<<<END_DATA', 'documentId', '数据不足', '语言']) {
      expect(s).toContain(k);
    }
  });
  it('总结指令带后缀', () => {
    expect(buildSummarySystemInstruction('x')).toBe(`x\n${SUMMARY_INSTRUCTION_SUFFIX}`);
    expect(SUMMARY_INSTRUCTION_SUFFIX).toContain('不得再调用工具');
    expect(SUMMARY_INSTRUCTION_SUFFIX).toContain('信息可能不完整');
  });
  it('tool_failure 文案含工具名与失败类型', () => {
    const t = toolFailureAnswer('get_dream', 'timeout');
    expect(t).toContain('get_dream');
    expect(t).toContain('timeout');
  });
});
