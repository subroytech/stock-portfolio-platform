import { describe, expect, test } from 'vitest';
import { detectPatterns, detectSingleBarPattern } from './candlestickPatternDetection';

describe('detectSingleBarPattern', () => {
  test('a zero-range bar (high === low) is never a pattern', () => {
    expect(detectSingleBarPattern({ open: 10, high: 10, low: 10, close: 10 })).toBeNull();
  });

  test('open === close (zero body) with moderate, asymmetric-but-not-extreme wicks falls into the generic Doji bucket', () => {
    // range = 10, upperWick = 2, lowerWick = 8 - too big on the lower side for Dragonfly
    // (upperWick > 0.1*range) and too small on the upper side for Long-Legged (upperWick < 0.3*
    // range), so this lands in the residual "plain Doji" bucket rather than any of the 3 sub-types.
    expect(detectSingleBarPattern({ open: 10, high: 12, low: 2, close: 10 })).toBe('doji');
  });

  test('bodyRatio exactly at the 0.1 boundary, with asymmetric wicks, is the generic Doji (inclusive <=)', () => {
    // range = 10, body = 1 -> bodyRatio = 0.1 exactly; upperWick = 2, lowerWick = 7 - same
    // reasoning as above, neither wick is extreme enough to trigger a sub-type.
    expect(detectSingleBarPattern({ open: 15, high: 18, low: 8, close: 16 })).toBe('doji');
  });

  test('a Hammer at its exact boundary ratios (lowerWick == 2*body, upperWick == 0.5*body)', () => {
    // body = 2 (open 10 -> close 12), upperWick = 1 (== 0.5*body), lowerWick = 4 (== 2*body)
    // range = upperWick + body + lowerWick = 1 + 2 + 4 = 7, bodyRatio = 2/7 > 0.1 so not Doji
    expect(detectSingleBarPattern({ open: 10, high: 13, low: 6, close: 12 })).toBe('hammer');
  });

  test('a Shooting Star at its exact boundary ratios (upperWick == 2*body, lowerWick == 0.5*body)', () => {
    // body = 2 (open 10 -> close 8), lowerWick = 1 (== 0.5*body), upperWick = 4 (== 2*body)
    expect(detectSingleBarPattern({ open: 10, high: 14, low: 7, close: 8 })).toBe('shootingStar');
  });

  test('a large body with modest, non-negligible wicks on both sides is not a pattern', () => {
    // body = 7, range = 8 -> bodyRatio = 0.875 (too big for Doji/Spinning Top), upperWick = 0.5
    // and lowerWick = 0.5 - both too small for Hammer/Shooting Star's 2x-wick requirement, but
    // too large (> 5% of range) to qualify as Marubozu's near-zero wicks either.
    expect(detectSingleBarPattern({ open: 10, high: 17.5, low: 9.5, close: 17 })).toBeNull();
  });

  test('a moderate, lopsided-but-not-extreme bar fails every threshold', () => {
    // body = 4, range = 12, bodyRatio = 0.333 -> too big for Spinning Top (> 0.3) and Doji;
    // upperWick = 2, lowerWick = 6 - lopsided but neither wick is 2x the body (Hammer/Shooting
    // Star) nor negligible (Marubozu), and the two wicks aren't comparable either (Spinning Top).
    expect(detectSingleBarPattern({ open: 10, high: 16, low: 4, close: 14 })).toBeNull();
  });

  test('the Doji family takes priority over a bar that would also satisfy Hammer wick ratios', () => {
    // body = 0.05, range = 9.75 -> bodyRatio well under 0.1 (Doji family), even though this same
    // shape (tiny body near the top, long lower wick, near-zero upper wick) would also satisfy
    // Hammer's own wick ratios if checked - the Doji-family check runs first. The near-zero upper
    // wick specifically makes this a Dragonfly Doji, not just the generic bucket.
    expect(detectSingleBarPattern({ open: 9.7, high: 9.75, low: 0, close: 9.75 })).toBe('dragonflyDoji');
  });

  test('a Marubozu at its exact boundary (each wick == 5% of range)', () => {
    // range = 10, upperWick = 0.5, lowerWick = 0.5, body = 9 -> bodyRatio = 0.9, too big for
    // Hammer/Shooting Star's wick-to-body ratios (0.5 is nowhere near 2*9), correctly falling
    // through to Marubozu instead.
    expect(detectSingleBarPattern({ open: 10, high: 19.5, low: 9.5, close: 19 })).toBe('marubozu');
  });

  test('a bullish and a bearish Marubozu are both detected as the same pattern key', () => {
    // Direction (which of open/close is higher) is deliberately not part of the pattern key
    // itself - CandlestickPopup.tsx's PatternPanel derives the badge's actual bullish/bearish
    // color from the bar's own open/close separately, since a Marubozu's real-world meaning
    // genuinely depends on that, unlike Hammer/Shooting Star's fixed interpretation.
    expect(detectSingleBarPattern({ open: 10, high: 20.2, low: 9.8, close: 20 })).toBe('marubozu'); // bullish
    expect(detectSingleBarPattern({ open: 20, high: 20.2, low: 9.8, close: 10 })).toBe('marubozu'); // bearish
  });

  test('a bullish Belt Hold at its exact boundary (bodyRatio == 0.6, no lower wick)', () => {
    // range = 10, body = 6, lowerWick = 0, upperWick = 4 - too big a body for Spinning Top/Doji,
    // and the wick ratio is nowhere near Hammer/Shooting Star's 2x-body requirement, correctly
    // falling through to Belt Hold instead.
    expect(detectSingleBarPattern({ open: 0, high: 10, low: 0, close: 6 })).toBe('beltHold');
  });

  test('a bearish Belt Hold at its exact boundary (bodyRatio == 0.6, no upper wick)', () => {
    expect(detectSingleBarPattern({ open: 6, high: 10, low: 0, close: 0 })).toBe('beltHold');
  });

  test('Marubozu takes priority over Belt Hold when BOTH sides are negligible', () => {
    // Belt Hold's own condition (bodyRatio >= 0.6 and at least one side negligible) would also be
    // satisfied by a Marubozu-shaped bar, since Marubozu is strictly the more extreme "both sides
    // negligible" case - Marubozu is checked first, so it always wins for that overlap.
    expect(detectSingleBarPattern({ open: 10, high: 19.5, low: 9.5, close: 19 })).toBe('marubozu');
  });

  test('a moderately-sized body with a real wick on both sides is not a Belt Hold', () => {
    // bodyRatio = 0.5, just under Belt Hold's own 0.6 floor.
    expect(detectSingleBarPattern({ open: 10, high: 17.5, low: 7.5, close: 15 })).toBeNull();
  });

  test('a Spinning Top at its exact boundary (bodyRatio == 0.3, wicks exactly equal)', () => {
    // range = 10, body = 3 -> bodyRatio = 0.3 exactly; upperWick = lowerWick = 3.5 (equal, so
    // trivially satisfies the "neither wick more than 2x the other" balance check).
    expect(detectSingleBarPattern({ open: 10, high: 16.5, low: 6.5, close: 13 })).toBe('spinningTop');
  });

  test('a small body with one wick more than twice the other is not a Spinning Top', () => {
    // bodyRatio = 0.15 (small enough), but lowerWick(1) is well under half of upperWick(7) - too
    // lopsided to read as "balanced indecision," and also doesn't meet Shooting Star's own
    // upperWick >= 2*body(1.5) here anyway (7 >= 3 is true, but lowerWick(1) <= 0.5*body(0.75) is
    // false), so this correctly falls through to no pattern rather than any of the 8.
    expect(detectSingleBarPattern({ open: 10, high: 18.5, low: 8.5, close: 11.5 })).toBeNull();
  });

  test('a Dragonfly Doji at its exact boundary (upperWick == 10% of range)', () => {
    // range = 10, upperWick = 1 exactly (== 0.1*range) - the mathematical identity
    // upperWick+body+lowerWick=range guarantees lowerWick is long (8.9) as a consequence, not
    // something that needs its own separate check.
    expect(detectSingleBarPattern({ open: 10, high: 11.1, low: 1.1, close: 10.1 })).toBe('dragonflyDoji');
  });

  test('a Gravestone Doji at its exact boundary (lowerWick == 10% of range)', () => {
    // Mirror of the Dragonfly boundary test above - range = 10, lowerWick = 1 exactly.
    expect(detectSingleBarPattern({ open: 100, high: 108, low: 98, close: 99 })).toBe('gravestoneDoji');
  });

  test('a Long-Legged Doji requires BOTH wicks genuinely long, not just non-negligible', () => {
    // range = 10, body = 0.5 -> bodyRatio = 0.05 (Doji family); upperWick = 3.5, lowerWick = 6 -
    // both well past the 0.1*range threshold (so neither Dragonfly nor Gravestone) and both
    // >= 0.3*range (so genuinely long on both sides, not just "not negligible").
    expect(detectSingleBarPattern({ open: 10, high: 13.9, low: 3.9, close: 10.5 })).toBe('longLeggedDoji');
  });

  test('a lopsided-but-not-quite-Dragonfly/Gravestone Doji falls to the generic bucket, not Long-Legged', () => {
    // range = 10, body tiny -> Doji family; upperWick = 0.15*range (just past Dragonfly's 0.1
    // cutoff) but lowerWick = 0.75*range (well past Gravestone's cutoff too) - one wick fails
    // Long-Legged's own 0.3*range floor, so this correctly falls through to plain Doji instead of
    // being misclassified as either a directional sub-type or Long-Legged.
    expect(detectSingleBarPattern({ open: 10, high: 11.55, low: 2.5, close: 10.1 })).toBe('doji');
  });
});

describe('detectPatterns', () => {
  test('returns index-tagged matches only for bars that match, preserving array order', () => {
    const bars = [
      { open: 10, high: 12, low: 8, close: 12 }, // no pattern (bodyRatio too large)
      { open: 10, high: 12, low: 2, close: 10 }, // doji (moderate, asymmetric wicks - not a sub-type)
      { open: 10, high: 11, low: 9, close: 10.5 }, // spinning top
      { open: 10, high: 13, low: 6, close: 12 }, // hammer
    ];

    expect(detectPatterns(bars)).toEqual([
      { index: 1, pattern: 'doji' },
      { index: 2, pattern: 'spinningTop' },
      { index: 3, pattern: 'hammer' },
    ]);
  });

  test('an empty bar array returns an empty match list', () => {
    expect(detectPatterns([])).toEqual([]);
  });
});
