import { describe, expect, test, vi } from 'vitest';
import { formatElapsedSince, formatDateOnly } from './format';

describe('formatDateOnly', () => {
  // Midday UTC - same calendar day in every real-world timezone this runs under, unlike an
  // early-morning-UTC timestamp (which rolls back a day in US timezones - the exact class of
  // bug this test would otherwise mask).
  test('formats as a medium date with no time of day', () => {
    expect(formatDateOnly('2026-07-14T16:00:24.651Z')).toBe('Jul 14, 2026');
  });
});

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
