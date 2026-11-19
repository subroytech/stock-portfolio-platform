export type CandlestickPatternKey =
  | 'doji' | 'hammer' | 'shootingStar' | 'marubozu' | 'spinningTop' | 'beltHold'
  | 'dragonflyDoji' | 'gravestoneDoji' | 'longLeggedDoji'
  | 'bullishEngulfing' | 'bearishEngulfing' | 'morningStar' | 'eveningStar'
  | 'piercingLine' | 'darkCloudCover' | 'threeWhiteSoldiers' | 'threeBlackCrows'
  | 'bullishHarami' | 'bearishHarami' | 'tweezerBottom' | 'tweezerTop'
  | 'bullishKicking' | 'bearishKicking'
  | 'threeInsideUp' | 'threeInsideDown' | 'threeOutsideUp' | 'threeOutsideDown'
  | 'bullishAbandonedBaby' | 'bearishAbandonedBaby'
  | 'upsideTasukiGap' | 'downsideTasukiGap'
  | 'risingThreeMethods' | 'fallingThreeMethods';

export const PATTERN_KEYS: CandlestickPatternKey[] = [
  'doji', 'dragonflyDoji', 'gravestoneDoji', 'longLeggedDoji', 'hammer', 'shootingStar', 'marubozu', 'spinningTop', 'beltHold',
];

// Complexity tiers (2026-09-27) - the rule is candle count, matching m_candlestick_pattern's own
// complexity_tier column (migration 050) so the chart's picker and the Pattern Q&A page's filter
// agree on which tier a pattern belongs to: Simple = 1 candle (PATTERN_KEYS above, the always-on
// panel), Composite = 2 candles, Advanced = 3 candles, Complex = 5 candles (2026-10-03,
// FIVE_CANDLE_PATTERN_KEYS below). Deliberately a rule a self-directed investor can reason about
// ("more candles to track = harder to use correctly") rather than an arbitrary difficulty label.
// All tiers below are detected by the SAME detectComplexPatterns() pass in
// candlestickComplexPatternDetection.ts - these arrays only decide which on-demand picker/panel
// each key is offered under (see CandlestickPopup.tsx's ComplexPatternPanel/AdvancedPatternPanel/
// Complex5PatternPanel).
export const COMPLEX_PATTERN_KEYS: CandlestickPatternKey[] = [
  'bullishEngulfing', 'bearishEngulfing', 'piercingLine', 'darkCloudCover',
  'bullishHarami', 'bearishHarami', 'tweezerBottom', 'tweezerTop',
  'bullishKicking', 'bearishKicking',
];

export const ADVANCED_PATTERN_KEYS: CandlestickPatternKey[] = [
  'morningStar', 'eveningStar', 'threeWhiteSoldiers', 'threeBlackCrows',
  'threeInsideUp', 'threeInsideDown', 'threeOutsideUp', 'threeOutsideDown',
  'bullishAbandonedBaby', 'bearishAbandonedBaby',
  'upsideTasukiGap', 'downsideTasukiGap',
];

// The Complex tier (2026-10-03) - deliberately NOT named COMPLEX_PATTERN_KEYS, since that
// identifier already means the 2-candle/Composite tier internally (a legacy name mismatch from
// the 2026-09-28 Composite rename, kept to avoid an unnecessary churn-only rename elsewhere). This
// array's own internal name stays candle-count-based to avoid colliding with that existing one,
// even though both now map to a *displayed* tier whose name differs from the key prefix.
export const FIVE_CANDLE_PATTERN_KEYS: CandlestickPatternKey[] = [
  'risingThreeMethods', 'fallingThreeMethods',
];

// Single source of truth for each pattern's display name - reused by both CandlestickPatternBadge
// (its tooltip) and CandlestickPopup.tsx's PatternPicker (its checkbox labels). Every complex
// pattern's label matches backend/src/db/seedCandlestickQuestionAnswer.ts's own patternName value
// exactly, same as every other pattern here, for Q&A consistency.
export const PATTERN_LABELS: Record<CandlestickPatternKey, string> = {
  doji: 'Doji', hammer: 'Hammer', shootingStar: 'Shooting Star', marubozu: 'Marubozu', spinningTop: 'Spinning Top',
  dragonflyDoji: 'Doji-Dragonfly', gravestoneDoji: 'Doji-Gravestone', longLeggedDoji: 'Doji-LongLegged',
  beltHold: 'Belt Hold',
  bullishEngulfing: 'Bullish Engulfing', bearishEngulfing: 'Bearish Engulfing',
  morningStar: 'Morning Star', eveningStar: 'Evening Star',
  piercingLine: 'Piercing Line', darkCloudCover: 'Dark Cloud Cover',
  threeWhiteSoldiers: 'Three White Soldiers', threeBlackCrows: 'Three Black Crows',
  bullishHarami: 'Bullish Harami', bearishHarami: 'Bearish Harami',
  tweezerBottom: 'Tweezer Bottom', tweezerTop: 'Tweezer Top',
  bullishKicking: 'Bullish Kicking', bearishKicking: 'Bearish Kicking',
  threeInsideUp: 'Three Inside Up', threeInsideDown: 'Three Inside Down',
  threeOutsideUp: 'Three Outside Up', threeOutsideDown: 'Three Outside Down',
  bullishAbandonedBaby: 'Bullish Abandoned Baby', bearishAbandonedBaby: 'Bearish Abandoned Baby',
  upsideTasukiGap: 'Upside Tasuki Gap', downsideTasukiGap: 'Downside Tasuki Gap',
  risingThreeMethods: 'Rising Three Methods', fallingThreeMethods: 'Falling Three Methods',
};

// Which patterns belong to the "Doji family" for CandlestickPopup.tsx's 2-row Pattern Detection
// panel (2026-09-26, explicit direction: the panel was getting crowded with 8 patterns sharing
// one row, so Doji + its 3 sub-types get their own row, the remaining 4 stay on the original one).
export const DOJI_FAMILY_PATTERN_KEYS: CandlestickPatternKey[] = ['doji', 'dragonflyDoji', 'gravestoneDoji', 'longLeggedDoji'];

export interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PatternMatch {
  index: number;
  pattern: CandlestickPatternKey;
}

// Single-bar geometric detection only (no multi-bar trend lookback) - a deliberate POC scope.
// Checked in this fixed priority order so a bar never carries two badges: a near-zero-body bar
// always satisfies Doji's bodyRatio check first, so the Hammer/Shooting Star branches below
// never see a zero body to divide against.
export function detectSingleBarPattern(bar: OhlcBar): CandlestickPatternKey | null {
  const { open, high, low, close } = bar;
  const range = high - low;
  if (range <= 0) return null;

  const body = Math.abs(close - open);
  const bodyRatio = body / range;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  // Doji and its 3 sub-types (2026-09-26) - within the same bodyRatio<=0.1 bucket, sub-classify
  // by wick shape. The identity upperWick + body + lowerWick === range always holds, so once
  // body <= 0.1*range, the two wicks together must sum to >= 0.9*range - meaning it's
  // mathematically impossible for BOTH wicks to be negligible at once here, so Dragonfly/
  // Gravestone's own checks only need to test their own near-zero side (the other side is
  // guaranteed long as a consequence, not something that needs its own separate check).
  if (bodyRatio <= 0.1) {
    if (upperWick <= 0.1 * range) return 'dragonflyDoji';
    if (lowerWick <= 0.1 * range) return 'gravestoneDoji';
    // Long-Legged Doji requires BOTH wicks to be genuinely long (not just "not negligible") -
    // a lopsided-but-not-quite-Dragonfly/Gravestone case (e.g. wicks of 0.15*range and
    // 0.75*range) falls through to plain Doji instead, since it doesn't show the "conviction on
    // both sides" a true Long-Legged Doji represents.
    if (upperWick >= 0.3 * range && lowerWick >= 0.3 * range) return 'longLeggedDoji';
    return 'doji';
  }
  if (lowerWick >= 2 * body && upperWick <= 0.5 * body) return 'hammer';
  if (upperWick >= 2 * body && lowerWick <= 0.5 * body) return 'shootingStar';
  // Marubozu - a long body with virtually no wick on either side. Mirrors Doji's own 0.1
  // threshold, inverted: the two wicks combined make up at most 10% of the range.
  if (upperWick <= 0.05 * range && lowerWick <= 0.05 * range) return 'marubozu';
  // Belt Hold - a large body with virtually no wick on only ONE side (the opening side), unlike
  // Marubozu which requires both. Checked after Marubozu specifically so the "both sides
  // negligible" extreme case is always classified as the more extreme Marubozu, leaving Belt
  // Hold to catch only the strictly-less-extreme "one side negligible" residual case.
  if (bodyRatio >= 0.6 && (upperWick <= 0.05 * range || lowerWick <= 0.05 * range)) return 'beltHold';
  // Spinning Top - a small-but-real body (bigger than Doji's, well short of a "normal" candle's)
  // with wicks of roughly comparable length on both sides (neither wick more than 2x the other) -
  // the residual "real indecision, not a directional signal" shape left once the checks above
  // have already claimed the one-sided-wick (Hammer/Shooting Star) and no-wick (Marubozu) cases.
  if (bodyRatio <= 0.3 && Math.min(upperWick, lowerWick) >= 0.5 * Math.max(upperWick, lowerWick)) return 'spinningTop';
  return null;
}

// `chronologicalBars` must already be oldest-first (this codebase's own toChronological() order)
// - the returned `index` is the same shared x-axis index every panel in CandlestickPopup.tsx uses.
export function detectPatterns(chronologicalBars: OhlcBar[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  chronologicalBars.forEach((bar, index) => {
    const pattern = detectSingleBarPattern(bar);
    if (pattern) matches.push({ index, pattern });
  });
  return matches;
}
