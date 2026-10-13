// Candlestick Pattern Q&A - a hand-authored geometry description per pattern, rendered as plain
// SVG (see CandlestickPatternDiagram.tsx), not a stored image. Candlestick pattern shapes are
// exactly this simple (1-3 rectangles-with-wicks) - describing them as geometry avoids any image
// asset pipeline, DB storage, or hosting concern entirely, and scales to any future pattern by
// just adding an entry here, not sourcing/uploading a picture.
//
// Frontend-only, keyed by pattern_name (matching m_candlestick_pattern's own natural key) - a
// pattern added via the Admin Console's own "New Pattern" form has no diagram until a developer
// also adds an entry here (a deliberate, accepted asymmetry for Phase 1: genuinely new
// candlestick patterns are rare, and CandlestickPatternDiagram.tsx renders nothing rather than
// erroring when a pattern has no geometry defined - fails open, never broken).

// y runs top-to-bottom on a fixed 0-100 scale per candle "cell", matching SVG's own convention.
// `bodyTop` is always the smaller (higher-on-screen) value - which end is the open vs. close is
// implied by `direction`, not by which of bodyTop/bodyBottom is listed first.
export interface CandleShape {
  high: number; // upper wick tip
  bodyTop: number;
  bodyBottom: number;
  low: number; // lower wick tip
  direction: 'up' | 'down' | 'neutral'; // neutral = a Doji-like negligible body, drawn gray
}

// Reuses the exact same up/down/neutral colors CandlestickPopup.tsx's real price chart already
// uses, so a pattern diagram and an actual chart read as visually consistent.
export const DIRECTION_COLORS: Record<CandleShape['direction'], string> = {
  up: '#16a34a', down: '#dc2626', neutral: '#94a3b8',
};

const PATTERN_DIAGRAMS: Record<string, CandleShape[]> = {
  Doji: [
    // A single candle's own width is much narrower than a multi-candle pattern's, so a wick
    // spanning nearly the full 0-100 height (as this one originally did) reads as oddly tall/
    // stretched once scaled up to fill a real-size box (2026-09-21 sizing pass) - shrunk to a
    // more proportionate span, still centered on the same near-50 body.
    { high: 30, bodyTop: 47, bodyBottom: 53, low: 70, direction: 'neutral' },
  ],
  Hammer: [
    // Small body near the top, long lower wick, no upper wick - exactly the seeded description.
    // Lower wick shortened (same reason as Doji above) so the whole shape doesn't stretch nearly
    // to the bottom of its box.
    { high: 18, bodyTop: 18, bodyBottom: 30, low: 65, direction: 'up' },
  ],
  'Bullish Engulfing': [
    { high: 35, bodyTop: 40, bodyBottom: 55, low: 60, direction: 'down' },
    { high: 15, bodyTop: 25, bodyBottom: 60, low: 68, direction: 'up' }, // engulfs candle 1's body (40-55)
  ],
  'Bearish Engulfing': [
    { high: 30, bodyTop: 40, bodyBottom: 55, low: 62, direction: 'up' },
    { high: 18, bodyTop: 25, bodyBottom: 65, low: 75, direction: 'down' }, // engulfs candle 1's body (40-55)
  ],
  'Morning Star': [
    { high: 15, bodyTop: 20, bodyBottom: 70, low: 75, direction: 'down' },
    { high: 78, bodyTop: 80, bodyBottom: 85, low: 90, direction: 'neutral' }, // small, gapped down
    { high: 20, bodyTop: 25, bodyBottom: 65, low: 70, direction: 'up' }, // closes into candle 1's body
  ],
  'Shooting Star': [
    // Small body near the bottom, long upper wick, no lower wick. Upper wick shortened
    // (same reason as Doji/Hammer above) so the shape doesn't stretch nearly to the top.
    { high: 40, bodyTop: 70, bodyBottom: 82, low: 82, direction: 'down' },
  ],
  'Three White Soldiers': [
    { high: 58, bodyTop: 60, bodyBottom: 85, low: 88, direction: 'up' },
    { high: 38, bodyTop: 40, bodyBottom: 65, low: 68, direction: 'up' }, // opens within candle 1's body
    { high: 18, bodyTop: 20, bodyBottom: 45, low: 48, direction: 'up' }, // opens within candle 2's body
  ],
  // 2026-09-26 - the 7 patterns added alongside this session's Category/relevant-horizons work.
  // Each mirrors its already-drawn counterpart's geometry where one exists, rather than being
  // designed from scratch.
  'Hanging Man': [
    // Identical shape to Hammer - same small-body-near-top, long-lower-wick geometry - but drawn
    // red (direction: 'down') rather than green, the common illustrative convention for
    // distinguishing the two despite the shape itself being indistinguishable without knowing the
    // preceding trend.
    { high: 18, bodyTop: 18, bodyBottom: 30, low: 65, direction: 'down' },
  ],
  'Evening Star': [
    // Mirrors Morning Star's 3-candle shape/positions, not a raw vertical flip - candle 1 is the
    // long bullish candle ending the prior uptrend (Morning Star's own candle 3 shape, recolored
    // 'up'), candle 2 gaps UP near the top instead of down near the bottom, candle 3 is the long
    // bearish reversal candle closing back into candle 1's body (Morning Star's own candle 1
    // shape, recolored 'down').
    { high: 15, bodyTop: 20, bodyBottom: 70, low: 75, direction: 'up' },
    { high: 5, bodyTop: 8, bodyBottom: 13, low: 15, direction: 'neutral' }, // small, gapped up
    { high: 20, bodyTop: 25, bodyBottom: 65, low: 70, direction: 'down' }, // closes into candle 1's body
  ],
  'Bullish Harami': [
    { high: 15, bodyTop: 20, bodyBottom: 75, low: 80, direction: 'down' }, // large bearish candle
    { high: 38, bodyTop: 40, bodyBottom: 55, low: 58, direction: 'up' }, // small, contained within candle 1's body (20-75)
  ],
  'Bearish Harami': [
    { high: 20, bodyTop: 25, bodyBottom: 80, low: 85, direction: 'up' }, // large bullish candle
    { high: 42, bodyTop: 45, bodyBottom: 60, low: 62, direction: 'down' }, // small, contained within candle 1's body (25-80)
  ],
  'Piercing Line': [
    { high: 15, bodyTop: 20, bodyBottom: 70, low: 75, direction: 'down' }, // long bearish candle
    { high: 35, bodyTop: 35, bodyBottom: 78, low: 80, direction: 'up' }, // opens below candle 1's low (gap down), closes well past its midpoint (45)
  ],
  'Dark Cloud Cover': [
    { high: 20, bodyTop: 25, bodyBottom: 75, low: 80, direction: 'up' }, // long bullish candle
    { high: 8, bodyTop: 12, bodyBottom: 62, low: 65, direction: 'down' }, // opens above candle 1's high (gap up), closes well past its midpoint (50)
  ],
  'Three Black Crows': [
    // The exact same 3 candles as Three White Soldiers, in reverse order and recolored 'down' -
    // a descending staircase (each candle opens within the prior one's body and closes lower)
    // instead of an ascending one.
    { high: 18, bodyTop: 20, bodyBottom: 45, low: 48, direction: 'down' },
    { high: 38, bodyTop: 40, bodyBottom: 65, low: 68, direction: 'down' }, // opens within candle 1's body
    { high: 58, bodyTop: 60, bodyBottom: 85, low: 88, direction: 'down' }, // opens within candle 2's body
  ],
  // Marubozu/Spinning Top (2026-09-26) - added alongside the Stock Analysis Pattern Detection
  // panel gaining these same two patterns, so their "Ask about patterns" curated answers get a
  // diagram like every other pattern's does.
  Marubozu: [
    // Long body, no wicks at all (high === bodyTop, low === bodyBottom) - drawn 'up' as the
    // bullish variant; the bearish variant is the same shape recolored 'down', same convention
    // Hanging Man/Evening Star already use for their own recolored counterparts.
    { high: 12, bodyTop: 12, bodyBottom: 88, low: 88, direction: 'up' },
  ],
  'Spinning Top': [
    // A small but real body (unlike Doji's near-zero one) roughly centered, with wicks of
    // comparable length on both sides - deliberately a visibly larger body than Doji's own
    // (47-53) so the two read as distinct shapes, not near-duplicates.
    { high: 15, bodyTop: 42, bodyBottom: 58, low: 85, direction: 'neutral' },
  ],
  // The 3 Doji sub-types (2026-09-26) - added alongside the Pattern Detection panel gaining
  // them, same precedent as Marubozu/Spinning Top above. Keyed by the "Doji-" prefixed names
  // (renamed the same day so all 4 Doji-family patterns sort/group together everywhere) - must
  // match backend/src/db/seedCandlestickQuestionAnswer.ts's own patternName values exactly, since
  // this lookup is keyed by pattern_name.
  'Doji-Dragonfly': [
    // Body at the very top (high === bodyTop, no upper wick at all), long lower wick - shaped
    // like a capital T.
    { high: 8, bodyTop: 8, bodyBottom: 14, low: 88, direction: 'neutral' },
  ],
  'Doji-Gravestone': [
    // The mirror of Doji-Dragonfly - body at the very bottom (low === bodyBottom, no lower wick
    // at all), long upper wick - shaped like an upside-down T.
    { high: 12, bodyTop: 86, bodyBottom: 92, low: 92, direction: 'neutral' },
  ],
  'Doji-LongLegged': [
    // Same tiny centered body as plain Doji (47-53), but with noticeably longer wicks on both
    // sides (8/92 vs. Doji's own 30/70) to visually read as "more extreme" indecision.
    { high: 8, bodyTop: 47, bodyBottom: 53, low: 92, direction: 'neutral' },
  ],
  // Belt Hold (2026-09-26) - drawn as the bullish variant (no wick on the opening/low side, a
  // real wick on the closing/high side) - the bearish variant is the same shape flipped and
  // recolored 'down', same convention Hanging Man/Evening Star already use for their own
  // recolored counterparts. The real distinguishing feature vs. Marubozu is exactly this one
  // remaining wick - Marubozu has none at all on either side.
  'Belt Hold': [
    { high: 8, bodyTop: 15, bodyBottom: 88, low: 88, direction: 'up' },
  ],
  // Three Inside/Outside Up/Down (2026-09-28) - each pair's first two candles reuse the exact
  // shape of the bare pattern they confirm (Bullish/Bearish Harami, Bullish/Bearish Engulfing),
  // per this file's own "mirror an already-drawn counterpart" convention - the third candle is
  // the only new geometry, drawn closing decisively past the specific level the curated content
  // itself names as the confirmation threshold.
  'Three Inside Up': [
    { high: 15, bodyTop: 20, bodyBottom: 75, low: 80, direction: 'down' }, // = Bullish Harami candle 1
    { high: 38, bodyTop: 40, bodyBottom: 55, low: 58, direction: 'up' }, // = Bullish Harami candle 2, contained in candle 1's body
    { high: 5, bodyTop: 10, bodyBottom: 37, low: 40, direction: 'up' }, // closes past candle 1's own open (20)
  ],
  'Three Inside Down': [
    { high: 20, bodyTop: 25, bodyBottom: 80, low: 85, direction: 'up' }, // = Bearish Harami candle 1
    { high: 42, bodyTop: 45, bodyBottom: 60, low: 62, direction: 'down' }, // = Bearish Harami candle 2, contained in candle 1's body
    { high: 75, bodyTop: 78, bodyBottom: 92, low: 95, direction: 'down' }, // closes past candle 1's own open (80)
  ],
  'Three Outside Up': [
    { high: 35, bodyTop: 40, bodyBottom: 55, low: 60, direction: 'down' }, // = Bullish Engulfing candle 1
    { high: 15, bodyTop: 25, bodyBottom: 60, low: 68, direction: 'up' }, // = Bullish Engulfing candle 2 (the engulfing candle)
    { high: 5, bodyTop: 8, bodyBottom: 30, low: 35, direction: 'up' }, // closes past candle 2's own close (25) - a 2nd session of confirmed buying
  ],
  'Three Outside Down': [
    { high: 30, bodyTop: 40, bodyBottom: 55, low: 62, direction: 'up' }, // = Bearish Engulfing candle 1
    { high: 18, bodyTop: 25, bodyBottom: 65, low: 75, direction: 'down' }, // = Bearish Engulfing candle 2 (the engulfing candle)
    { high: 60, bodyTop: 70, bodyBottom: 90, low: 95, direction: 'down' }, // closes past candle 2's own close (65) - a 2nd session of confirmed selling
  ],
  // Tweezer Bottom/Top (2026-09-28) - the defining feature is the two candles sharing the exact
  // same low (Bottom) or high (Top), drawn identically on both candles so the "virtually
  // identical" reading is visually obvious, not approximate.
  'Tweezer Bottom': [
    { high: 20, bodyTop: 25, bodyBottom: 65, low: 70, direction: 'down' }, // bearish, continuing the decline
    { high: 40, bodyTop: 45, bodyBottom: 65, low: 70, direction: 'up' }, // same low (70) as candle 1, closes higher
  ],
  'Tweezer Top': [
    { high: 30, bodyTop: 35, bodyBottom: 75, low: 80, direction: 'up' }, // bullish, continuing the rally
    { high: 30, bodyTop: 35, bodyBottom: 55, low: 58, direction: 'down' }, // same high (30) as candle 1, closes lower
  ],
  // Bullish/Bearish Kicking (2026-09-28) - both candles are Marubozu (no wicks at all, same
  // high===bodyTop/low===bodyBottom shape as the plain Marubozu entry above), with the second
  // candle's entire range gapping cleanly past the first candle's - zero overlap between the two,
  // the defining feature that distinguishes Kicking from Engulfing/Harami (which always overlap).
  'Bullish Kicking': [
    { high: 55, bodyTop: 55, bodyBottom: 90, low: 90, direction: 'down' }, // bearish Marubozu
    { high: 10, bodyTop: 10, bodyBottom: 45, low: 45, direction: 'up' }, // bullish Marubozu, gaps up - entirely above candle 1's high (55)
  ],
  'Bearish Kicking': [
    { high: 10, bodyTop: 10, bodyBottom: 45, low: 45, direction: 'up' }, // bullish Marubozu
    { high: 55, bodyTop: 55, bodyBottom: 90, low: 90, direction: 'down' }, // bearish Marubozu, gaps down - entirely below candle 1's low (45)
  ],
  // Bullish/Bearish Abandoned Baby (2026-09-29) - reuse Morning/Evening Star's own candle 1 and
  // candle 3 shapes exactly (the stricter version doesn't change the long outer candles, only the
  // middle one), but the middle candle is redrawn with a REAL gap on both sides (no touching,
  // unlike Morning/Evening Star's own middle candle, which only gaps on one side and can touch the
  // other) - the one geometric difference that actually distinguishes this pattern from its more
  // common sibling.
  'Bullish Abandoned Baby': [
    { high: 15, bodyTop: 20, bodyBottom: 70, low: 75, direction: 'down' }, // = Morning Star candle 1
    { high: 85, bodyTop: 87, bodyBottom: 89, low: 91, direction: 'neutral' }, // gaps completely below candle 1's low (75) - no touching
    { high: 20, bodyTop: 25, bodyBottom: 65, low: 70, direction: 'up' }, // = Morning Star candle 3, gaps completely above candle 2's high (85) - no touching
  ],
  'Bearish Abandoned Baby': [
    { high: 15, bodyTop: 20, bodyBottom: 70, low: 75, direction: 'up' }, // = Evening Star candle 1
    { high: 3, bodyTop: 5, bodyBottom: 8, low: 10, direction: 'neutral' }, // gaps completely above candle 1's high (15) - no touching
    { high: 20, bodyTop: 25, bodyBottom: 65, low: 70, direction: 'down' }, // = Evening Star candle 3, gaps completely below candle 2's low (10) - no touching
  ],
  // Upside/Downside Tasuki Gap (2026-09-29) - the defining feature is candle 3 opening inside
  // candle 2's body and pulling back into the gap between candles 1 and 2, but its close stops
  // short of candle 1's own close - drawn so candle 3's body visibly sits inside that gap zone
  // without reaching all the way back to candle 1's own close level.
  'Upside Tasuki Gap': [
    { high: 55, bodyTop: 60, bodyBottom: 85, low: 90, direction: 'up' }, // first bullish candle
    { high: 15, bodyTop: 20, bodyBottom: 40, low: 45, direction: 'up' }, // second bullish candle, gaps up - entirely above candle 1's high (55)
    { high: 25, bodyTop: 30, bodyBottom: 50, low: 55, direction: 'down' }, // opens within candle 2's body, pulls back into the gap but closes (50) above candle 1's own close (60) - the gap isn't fully filled
  ],
  'Downside Tasuki Gap': [
    { high: 10, bodyTop: 15, bodyBottom: 40, low: 45, direction: 'down' }, // first bearish candle
    { high: 55, bodyTop: 60, bodyBottom: 80, low: 85, direction: 'down' }, // second bearish candle, gaps down - entirely below candle 1's low (45)
    { high: 45, bodyTop: 50, bodyBottom: 70, low: 75, direction: 'up' }, // opens within candle 2's body, bounces back into the gap but closes (50) below candle 1's own close (40) - the gap isn't fully filled
  ],
  // Rising/Falling Three Methods (2026-09-29, drafted ahead of the Complex 5-candle tier itself
  // existing - see Requirements/Candlestick-Pattern-Q&A-Module-Requirements.md Section 13) - three
  // small candles drifting away from the first candle's own close while staying fully contained
  // within its high/low range, then a fifth candle matching the first candle's own long shape and
  // closing past its close. Not yet reachable from any live pattern list (no complexity_tier value
  // exists for it yet) - this entry is dormant until that tier is scoped, same "no live UI path
  // yet, but the geometry is ready" precedent as this file's own doc-comment above.
  'Rising Three Methods': [
    { high: 10, bodyTop: 15, bodyBottom: 75, low: 80, direction: 'up' }, // long bullish candle
    { high: 25, bodyTop: 30, bodyBottom: 45, low: 50, direction: 'down' }, // small, contained within candle 1's range [10,80]
    { high: 35, bodyTop: 40, bodyBottom: 55, low: 60, direction: 'down' }, // small, contained, drifting lower
    { high: 45, bodyTop: 50, bodyBottom: 65, low: 70, direction: 'down' }, // small, contained, drifting lower still
    { high: 5, bodyTop: 8, bodyBottom: 68, low: 72, direction: 'up' }, // long bullish candle, closes (8) above candle 1's own close (15)
  ],
  'Falling Three Methods': [
    { high: 5, bodyTop: 10, bodyBottom: 70, low: 75, direction: 'down' }, // long bearish candle
    { high: 35, bodyTop: 40, bodyBottom: 55, low: 60, direction: 'up' }, // small, contained within candle 1's range [5,75]
    { high: 25, bodyTop: 30, bodyBottom: 45, low: 50, direction: 'up' }, // small, contained, drifting higher
    { high: 15, bodyTop: 20, bodyBottom: 35, low: 40, direction: 'up' }, // small, contained, drifting higher still
    { high: 12, bodyTop: 18, bodyBottom: 78, low: 82, direction: 'down' }, // long bearish candle, closes (78) below candle 1's own close (70)
  ],
};

export function getPatternDiagram(patternName: string): CandleShape[] | null {
  return PATTERN_DIAGRAMS[patternName] ?? null;
}

// Lets a caller decide whether to reserve layout space for a diagram (e.g. a fixed-width column
// next to the answer text) before rendering CandlestickPatternDiagram itself, so a pattern with
// no geometry defined never leaves a blank, empty-looking gap.
export function hasPatternDiagram(patternName: string): boolean {
  return patternName in PATTERN_DIAGRAMS;
}
