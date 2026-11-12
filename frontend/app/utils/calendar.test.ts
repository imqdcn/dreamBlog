import { describe, it, expect } from 'vitest';
import { buildMonthGrid } from './calendar';
import type { Dream } from '../types/dream';

const d = (p: Partial<Dream>) => ({ title: 't', ...p }) as Dream;

describe('buildMonthGrid', () => {
  it('每天一格，闰年二月 29 天', () => {
    expect(buildMonthGrid([], 2024, 2)).toHaveLength(29);
    expect(buildMonthGrid([], 2025, 2)).toHaveLength(28);
  });

  it('count 等于 dreams.length，空日为 0，跨月不计入', () => {
    const dreams = [
      d({ dreamedAt: '2026-03-05T10:00:00' }),
      d({ dreamedAt: '2026-03-05T20:00:00' }),
      d({ createdAt: '2026-03-07T10:00:00' }),
      d({ dreamedAt: '2026-04-01T10:00:00' }),
    ];
    const grid = buildMonthGrid(dreams, 2026, 3);
    const byDate = Object.fromEntries(grid.map((c) => [c.date, c]));
    expect(byDate['2026-03-05'].count).toBe(2);
    expect(byDate['2026-03-07'].count).toBe(1);
    expect(byDate['2026-03-06'].count).toBe(0);
    expect(grid.every((c) => c.count === c.dreams.length)).toBe(true);
    expect(grid.reduce((s, c) => s + c.count, 0)).toBe(3);
  });
});
