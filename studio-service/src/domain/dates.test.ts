import { describe, expect, it } from 'vitest';
import { addDays, dreamDateKey, isoWeekday, isValidDateKey, monthKey, validateDateRange, weekStart } from './dates.js';

describe('dates', () => {
  it('dreamDateKey prefers dreamedAt and respects TZ', () => {
    const d = { dreamedAt: '2024-03-10T20:00:00Z', createdAt: '2024-01-01T00:00:00Z' };
    expect(dreamDateKey(d, 'Asia/Shanghai')).toBe('2024-03-11');
    expect(dreamDateKey(d, 'UTC')).toBe('2024-03-10');
    expect(dreamDateKey({ createdAt: '2024-01-01T00:00:00Z' }, 'UTC')).toBe('2024-01-01');
    expect(dreamDateKey({ dreamedAt: 'bad', createdAt: '2024-01-02T00:00:00Z' }, 'UTC')).toBe('2024-01-02');
  });

  it('week starts on Monday and month buckets work', () => {
    expect(isoWeekday('2024-03-10')).toBe(7);
    expect(weekStart('2024-03-10')).toBe('2024-03-04');
    expect(weekStart('2024-03-04')).toBe('2024-03-04');
    expect(weekStart('2024-01-01')).toBe('2024-01-01');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(monthKey('2024-12-31')).toBe('2024-12');
  });

  it('validateDateRange', () => {
    expect(validateDateRange('2024-01-01', '2024-01-01').ok).toBe(true);
    expect(validateDateRange('2024-02-30', '2024-03-01').ok).toBe(false);
    expect(validateDateRange('2024-02-02', '2024-02-01').ok).toBe(false);
    expect(isValidDateKey('2023-02-29')).toBe(false);
    expect(isValidDateKey('2024-02-29')).toBe(true);
  });
});
