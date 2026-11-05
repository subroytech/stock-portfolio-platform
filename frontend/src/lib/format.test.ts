import { describe, expect, test, vi } from 'vitest';
import { formatElapsedSince } from './format';

describe('formatElapsedSince', () => {
  const NOW = new Date('2026-10-29T20:45:00.000Z').getTime();

  test('less than an hour => "less than an hour ago"', () => {
    vi.setSystemTime(NOW);
    expect(formatElapsedSince(new Date(NOW - 30 * 60_000).toISOString())).toBe('less than an hour ago');
    vi.useRealTimers();
  });

  test('hours only, singular', () => {
    vi.setSystemTime(NOW);
    expect(formatElapsedSince(new Date(NOW - 1 * 3_600_000).toISOString())).toBe('1 hour ago');
    vi.useRealTimers();
  });

  test('hours only, plural', () => {
    vi.setSystemTime(NOW);
    expect(formatElapsedSince(new Date(NOW - 7 * 3_600_000).toISOString())).toBe('7 hours ago');
    vi.useRealTimers();
  });

  test('days and hours, both plural', () => {
    vi.setSystemTime(NOW);
    const threeDaysSevenHoursMs = (3 * 24 + 7) * 3_600_000;
    expect(formatElapsedSince(new Date(NOW - threeDaysSevenHoursMs).toISOString())).toBe('3 days and 7 hours ago');
    vi.useRealTimers();
  });

  test('exactly one day, no remainder hours => days only', () => {
    vi.setSystemTime(NOW);
    expect(formatElapsedSince(new Date(NOW - 24 * 3_600_000).toISOString())).toBe('1 day ago');
    vi.useRealTimers();
  });

  test('a future timestamp (clock skew) => "just now", not negative', () => {
    vi.setSystemTime(NOW);
    expect(formatElapsedSince(new Date(NOW + 60_000).toISOString())).toBe('just now');
    vi.useRealTimers();
  });
});
