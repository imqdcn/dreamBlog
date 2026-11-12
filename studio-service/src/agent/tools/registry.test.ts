import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { dateString, withDateRange, type AgentTool } from './common.js';
import { createToolRegistry } from './registry.js';
import type { ReadOnlyDreamSource } from '../types.js';

const echoTool: AgentTool<{ dateFrom: string; dateTo: string }, number> = {
  name: 'echo',
  description: '返回快照中梦境数量，用于测试注册表。',
  schema: withDateRange(z.object({ dateFrom: dateString, dateTo: dateString }).strict()),
  run: (_a, ctx) => ({ ok: true, data: ctx.dreams.length }),
};

const mkSource = (impl?: () => Promise<any[]>) => {
  const listAll = vi.fn(impl ?? (async () => []));
  const source: ReadOnlyDreamSource = { listAll, getByDocumentId: vi.fn(async () => null) };
  return { source, listAll };
};
const signal = new AbortController().signal;
const reg = () => createToolRegistry([echoTool], { today: () => '2025-01-10' });
const call = (name: string, argumentsJson: string) => ({ id: '1', name, argumentsJson });

describe('tool registry', () => {
  it('生成 ToolSpec 且不含 $schema', () => {
    const [s] = reg().specs();
    expect(s!.name).toBe('echo');
    expect(s!.parameters).not.toHaveProperty('$schema');
    expect(s!.parameters).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('无效参数返回 fields，且不访问数据源', async () => {
    const { source, listAll } = mkSource();
    for (const args of ['{bad', '{"dateFrom":"2024-02-30","dateTo":"2024-03-01"}', '{"dateFrom":"2024-03-02","dateTo":"2024-03-01"}', '{"dateFrom":"2024-03-01","dateTo":"2024-03-02","x":1}']) {
      const r = await reg().execute(call('echo', args), { source, signal });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('invalid_arguments');
        expect(r.error.fields!.length).toBeGreaterThan(0);
      }
    }
    expect(listAll).not.toHaveBeenCalled();
  });

  it('未知工具返回 availableTools', async () => {
    const { source, listAll } = mkSource();
    const r = await reg().execute(call('nope', '{}'), { source, signal });
    expect(r).toMatchObject({ ok: false, error: { code: 'unknown_tool', availableTools: ['echo'] } });
    expect(listAll).not.toHaveBeenCalled();
  });

  it('快照只取一次；失败不缓存', async () => {
    let n = 0;
    const { source, listAll } = mkSource(async () => {
      if (n++ === 0) throw new Error('boom');
      return [{}, {}];
    });
    const r = reg();
    const args = '{"dateFrom":"2024-03-01","dateTo":"2024-03-02"}';
    expect(await r.execute(call('echo', args), { source, signal })).toMatchObject({
      ok: false,
      error: { code: 'backend_unavailable' },
    });
    expect(await r.execute(call('echo', args), { source, signal })).toMatchObject({ ok: true, data: 2 });
    await r.execute(call('echo', args), { source, signal });
    expect(listAll).toHaveBeenCalledTimes(2);
  });
});
