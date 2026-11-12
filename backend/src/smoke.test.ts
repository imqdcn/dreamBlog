import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('backend test infrastructure', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs fast-check properties', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 20 }
    );
  });
});
