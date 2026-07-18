import { describe, expect, test } from 'vitest';
import { calcKellySizing } from './kelly';

// Mirrors backend/tests/momentum.service.test.ts's calcKellySizing suite —
// this client-side copy must stay behaviorally identical to the backend's.
describe('calcKellySizing (client port)', () => {
  test('score below 6 => no position, regardless of R:R', () => {
    const s = calcKellySizing(3, 50000, 100, 5);
    expect(s.noEntry).toBe(true);
    expect(s.hk).toBe(0);
    expect(s.pos).toBe(0);
    expect(s.sh).toBe(0);
  });

  test('score 6 => sized, but NO 10% floor applied', () => {
    const s = calcKellySizing(1.0, 100000, 100, 6);
    expect(s.noEntry).toBe(false);
    expect(s.kF).toBeCloseTo(0.10, 6);
    expect(s.hk).toBeCloseTo(0.05, 6);
  });

  test('score 7+ => 10% floor kicks in', () => {
    const s = calcKellySizing(1.0, 100000, 100, 7);
    expect(s.hk).toBeCloseTo(0.10, 6);
  });

  test('caps Half-Kelly at 20% for a strong R:R', () => {
    const s = calcKellySizing(5, 50000, 100, 8);
    expect(s.hk).toBeCloseTo(0.20, 6);
    expect(s.pos).toBeCloseTo(10000, 6);
    expect(s.sh).toBe(100);
  });

  test('entryMid of 0 yields 0 shares without throwing', () => {
    const s = calcKellySizing(1.0, 100000, 0, 7);
    expect(s.sh).toBe(0);
  });
});
