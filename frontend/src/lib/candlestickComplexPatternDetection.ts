import type { OhlcBar, PatternMatch, CandlestickPatternKey } from './candlestickPatternDetection';

function bodyRatio(bar: OhlcBar): number {
  const range = bar.high - bar.low;
  return range > 0 ? Math.abs(bar.close - bar.open) / range : 0;
}

// Bullish/Bearish Engulfing (2 bars) - curr's body must fully contain prev's body, with the two
// candles opposite colors. Matches the exact wording already promised in the curated Q&A content
// ("a smaller [bearish/bullish] candle followed by a larger [bullish/bearish] candle whose body
// completely covers the prior candle's body").
export function detectBullishEngulfing(prev: OhlcBar, curr: OhlcBar): boolean {
  return prev.close < prev.open && curr.close > curr.open
    && curr.open <= prev.close && curr.close >= prev.open;
}

export function detectBearishEngulfing(prev: OhlcBar, curr: OhlcBar): boolean {
  return prev.close > prev.open && curr.close < curr.open
    && curr.open >= prev.close && curr.close <= prev.open;
}

// Piercing Line / Dark Cloud Cover (2 bars) - the "didn't fully engulf" sibling of
// Bullish/Bearish Engulfing, matching the curated Q&A content's own framing exactly: a long
// [bearish/bullish] candle, followed by a candle that gaps [down/up] past the first candle's
// [low/high] but recovers to close more than halfway into the first candle's body - "without
// fully closing above/below the first candle's open, which would instead make it a
// [Bullish/Bearish] Engulfing pattern." That last clause (curr.close < / > prev.open) is what
// keeps these mutually exclusive with Engulfing, which requires curr.close >= / <= prev.open -
// checked as the weaker `else if` fallback after Engulfing in detectComplexPatterns() below.
export function detectPiercingLine(prev: OhlcBar, curr: OhlcBar): boolean {
  const midpoint = (prev.open + prev.close) / 2;
  return prev.close < prev.open && bodyRatio(prev) >= 0.5
    && curr.open < prev.low
    && curr.close > curr.open
    && curr.close > midpoint && curr.close < prev.open;
}

export function detectDarkCloudCover(prev: OhlcBar, curr: OhlcBar): boolean {
  const midpoint = (prev.open + prev.close) / 2;
  return prev.close > prev.open && bodyRatio(prev) >= 0.5
    && curr.open > prev.high
    && curr.close < curr.open
    && curr.close < midpoint && curr.close > prev.open;
}

// Bullish/Bearish Harami (2 bars) - the geometric OPPOSITE of Engulfing: curr's body sits fully
// INSIDE prev's body ("Harami" is Japanese for "pregnant" - a smaller candle contained inside the
// larger one), rather than containing it. Matches the curated Q&A content's own wording exactly:
// "a large [bearish/bullish] candle is followed by a smaller [bullish/bearish] candle whose entire
// body sits within the first candle's body." Containment alone already implies curr's body is
// smaller, and the opposite containment direction from Engulfing/Piercing-Dark-Cloud (which both
// require curr's body to reach OUTSIDE prev's range on at least one side) makes this naturally
// mutually exclusive with every other 2-bar pattern already checked in detectComplexPatterns()
// below - order doesn't matter for correctness, only for which `else if` branch it's checked in.
export function detectBullishHarami(prev: OhlcBar, curr: OhlcBar): boolean {
  const prevBodyLow = Math.min(prev.open, prev.close);
  const prevBodyHigh = Math.max(prev.open, prev.close);
  const currBodyLow = Math.min(curr.open, curr.close);
  const currBodyHigh = Math.max(curr.open, curr.close);
  return prev.close < prev.open && bodyRatio(prev) >= 0.5
    && curr.close > curr.open
    && currBodyLow > prevBodyLow && currBodyHigh < prevBodyHigh;
}

export function detectBearishHarami(prev: OhlcBar, curr: OhlcBar): boolean {
  const prevBodyLow = Math.min(prev.open, prev.close);
  const prevBodyHigh = Math.max(prev.open, prev.close);
  const currBodyLow = Math.min(curr.open, curr.close);
  const currBodyHigh = Math.max(curr.open, curr.close);
  return prev.close > prev.open && bodyRatio(prev) >= 0.5
    && curr.close < curr.open
    && currBodyLow > prevBodyLow && currBodyHigh < prevBodyHigh;
}

// Tweezer Bottom/Top (2 bars) - matches the curated Q&A content's own framing exactly: "both
// candles' lows [highs] are virtually identical." Deliberately does NOT require the two candles
// to be opposite colors - the curated Reliability answer frames that as what makes the pattern
// MORE reliable ("not just two down days that happened to share a low"), not a requirement of the
// pattern's own existence, so the base detector only checks the shared low/high. Tolerance is
// relative to the larger candle's own range (consistent with this file's own bodyRatio-style
// normalization) rather than an absolute price difference, so it works the same way regardless of
// a symbol's price scale. Checked as the weakest `else if` fallback after Harami in
// detectComplexPatterns() below, per the curated content's own "a comparatively weaker signal...
// don't treat it with the same weight as an Engulfing pattern" framing.
export function detectTweezerBottom(prev: OhlcBar, curr: OhlcBar): boolean {
  const tolerance = 0.1 * Math.max(prev.high - prev.low, curr.high - curr.low);
  return Math.abs(prev.low - curr.low) <= tolerance;
}

export function detectTweezerTop(prev: OhlcBar, curr: OhlcBar): boolean {
  const tolerance = 0.1 * Math.max(prev.high - prev.low, curr.high - curr.low);
  return Math.abs(prev.high - curr.high) <= tolerance;
}

// Bullish/Bearish Kicking (2 bars) - matches the curated Q&A content's own framing exactly: two
// Marubozu candles (no wicks at all) with a genuine gap between them so clean the two candles'
// ranges don't overlap in the slightest - "structurally the 'no overlap whatsoever' extreme of the
// Engulfing/Harami family." isMarubozu() reuses the exact 0.05*range wick threshold
// candlestickPatternDetection.ts's own single-bar detectSingleBarPattern() uses for 'marubozu', so
// this never drifts from what "Marubozu" already means elsewhere in this codebase. The zero-overlap
// requirement (curr's entire range past prev's entire range) is what distinguishes this from every
// other 2-bar pattern here, all of which require the two candles' ranges to touch or overlap -
// naturally mutually exclusive with Engulfing/Harami/Piercing-DarkCloud/Tweezer, so checked as a
// further `else if` in detectComplexPatterns() below (order doesn't matter for correctness).
function isMarubozu(bar: OhlcBar): boolean {
  const range = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  return range > 0 && upperWick <= 0.05 * range && lowerWick <= 0.05 * range;
}

export function detectBullishKicking(prev: OhlcBar, curr: OhlcBar): boolean {
  return prev.close < prev.open && isMarubozu(prev)
    && curr.close > curr.open && isMarubozu(curr)
    && curr.low > prev.high;
}

export function detectBearishKicking(prev: OhlcBar, curr: OhlcBar): boolean {
  return prev.close > prev.open && isMarubozu(prev)
    && curr.close < curr.open && isMarubozu(curr)
    && curr.high < prev.low;
}

// Morning/Evening Star (3 bars) - matches the curated content's own wording exactly: a long
// [bearish/bullish] candle, a small-bodied candle that gaps [down/up], then a long
// [bullish/bearish] candle closing well into the first candle's body (past its midpoint).
export function detectMorningStar(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  const aBody = Math.abs(a.close - a.open);
  return a.close < a.open && bodyRatio(a) >= 0.5
    && Math.abs(b.close - b.open) <= 0.3 * aBody
    && Math.max(b.open, b.close) < a.close
    && c.close > c.open && bodyRatio(c) >= 0.5
    && c.close > (a.open + a.close) / 2;
}

export function detectEveningStar(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  const aBody = Math.abs(a.close - a.open);
  return a.close > a.open && bodyRatio(a) >= 0.5
    && Math.abs(b.close - b.open) <= 0.3 * aBody
    && Math.min(b.open, b.close) > a.close
    && c.close < c.open && bodyRatio(c) >= 0.5
    && c.close < (a.open + a.close) / 2;
}

// Bullish/Bearish Abandoned Baby (3 bars) - the stricter, rarer sibling of Morning/Evening Star,
// matching the curated Q&A content's own framing exactly: the same shape, but requiring genuine
// price gaps (wick-to-wick, not just body-to-close) on BOTH sides of the small middle candle - a
// true island reversal. Deliberately reuses detectMorningStar/detectEveningStar as a base
// requirement rather than re-deriving their own long-candle/small-middle-candle/closes-past-
// midpoint checks, same reuse-the-existing-detector precedent as Three Inside/Outside Up/Down
// reusing Harami/Engulfing. The extra gap checks here are strictly STRONGER than what Morning/
// Evening Star already require (b.high < a.low implies max(b.open,b.close) < a.close, since
// a.close >= a.low for a bearish candle and b.high >= max(b.open,b.close) always - the mirror
// argument holds for the bearish version), so whenever this fires, the base Morning/Evening Star
// call is guaranteed to also return true - checked as the earlier, more specific `else if` branch
// in detectComplexPatterns()'s 3-bar chain below, with plain Morning/Evening Star as the fallback
// for the more common, only-partially-gapped case.
export function detectBullishAbandonedBaby(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return detectMorningStar(a, b, c) && b.high < a.low && c.low > b.high;
}

export function detectBearishAbandonedBaby(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return detectEveningStar(a, b, c) && b.low > a.high && c.high < b.low;
}

// Three White Soldiers / Three Black Crows (3 bars) - three consecutive long same-direction
// candles, each opening within the prior candle's body and closing near its own high/low (a small
// wick on the "closing" side). 0.6 bodyRatio matches candlestickPatternDetection.ts's own "long
// body" threshold for Belt Hold; 0.15 for "small wick" sits between Marubozu's 0.05 (no wick) and
// Doji's 0.1, consistent with that same file's threshold vocabulary. Structurally mutually
// exclusive with Morning/Evening Star, whose middle candle must be SMALL, not long - checked as
// additional `else if`s alongside them in detectComplexPatterns()'s 3-bar window below.
function isLongBullish(bar: OhlcBar): boolean {
  const range = bar.high - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  return bar.close > bar.open && bodyRatio(bar) >= 0.6 && upperWick <= 0.15 * range;
}

function isLongBearish(bar: OhlcBar): boolean {
  const range = bar.high - bar.low;
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  return bar.close < bar.open && bodyRatio(bar) >= 0.6 && lowerWick <= 0.15 * range;
}

export function detectThreeWhiteSoldiers(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return isLongBullish(a) && isLongBullish(b) && isLongBullish(c)
    && b.open > a.open && b.open < a.close
    && c.open > b.open && c.open < b.close;
}

export function detectThreeBlackCrows(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return isLongBearish(a) && isLongBearish(b) && isLongBearish(c)
    && b.open < a.open && b.open > a.close
    && c.open < b.open && c.open > b.close;
}

// Three Inside Up/Down (3 bars) - a Bullish/Bearish Harami (a,b) confirmed by a third candle (c)
// that closes back past the FIRST candle's own open, matching the curated Q&A content's own
// framing exactly: "that third candle is what turns the Harami's narrowing-into-indecision into an
// actual, confirmed reversal." Deliberately reuses detectBullishHarami/detectBearishHarami rather
// than re-deriving the containment check, so this can never silently drift from what a bare Harami
// means. A genuine Harami match at (a,b) may ALSO already be recorded at index i-1 by the 2-bar
// branch below - that's intentional, not deduped, same "independent pattern types" precedent every
// other multi-match case in this file already follows.
export function detectThreeInsideUp(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return detectBullishHarami(a, b) && c.close > c.open && c.close > a.open;
}

export function detectThreeInsideDown(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return detectBearishHarami(a, b) && c.close < c.open && c.close < a.open;
}

// Three Outside Up/Down (3 bars) - a Bullish/Bearish Engulfing (a,b) confirmed by a third candle
// (c) that closes even further than the engulfing candle's own close, per the curated content:
// "a second consecutive session of confirmed buying/selling... it doesn't need to engulf the
// second candle's body, it only needs to close higher/lower than the second candle's close." Same
// reuse-the-existing-detector approach as Three Inside Up/Down above.
export function detectThreeOutsideUp(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return detectBullishEngulfing(a, b) && c.close > c.open && c.close > b.close;
}

export function detectThreeOutsideDown(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return detectBearishEngulfing(a, b) && c.close < c.open && c.close < b.close;
}

// Upside/Downside Tasuki Gap (3 bars) - the only CONTINUATION pattern in this file's 3-bar tier
// (every other Advanced pattern is a reversal); matches the curated Q&A content's own wording
// exactly: two same-direction candles, the second gapping away from the first with no overlap,
// then a third candle that opens inside the second candle's body and pulls back into the gap -
// but its close stays short of the first candle's own close, so the gap never gets fully filled.
// Structurally incompatible with Engulfing-based Three Outside Up/Down (which require a and b to
// OVERLAP, the opposite of this pattern's defining no-overlap gap), so order doesn't matter for
// correctness - checked as further `else if`s in detectComplexPatterns()'s 3-bar chain below.
export function detectUpsideTasukiGap(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return a.close > a.open
    && b.close > b.open && b.low > a.high
    && c.close < c.open
    && c.open > Math.min(b.open, b.close) && c.open < Math.max(b.open, b.close)
    && c.close < b.low && c.close > a.close;
}

export function detectDownsideTasukiGap(a: OhlcBar, b: OhlcBar, c: OhlcBar): boolean {
  return a.close < a.open
    && b.close < b.open && b.high < a.low
    && c.close > c.open
    && c.open > Math.min(b.open, b.close) && c.open < Math.max(b.open, b.close)
    && c.close > b.high && c.close < a.close;
}

// Rising/Falling Three Methods (5 bars, the Complex tier - 2026-10-03) - matches the curated Q&A
// content's own wording exactly: a long [bullish/bearish] candle, three small candles that stay
// fully contained within that first candle's own high/low range (no strict body-size threshold on
// the three middle candles - the curated content frames "noticeably smaller bodies" as what makes
// the pattern MORE reliable, not part of its own core definition, same "don't encode reliability
// nuances as hard requirements" precedent already used for Tweezer's color check), then a long
// [bullish/bearish] candle closing past the first candle's own close.
export function detectRisingThreeMethods(a: OhlcBar, b: OhlcBar, c: OhlcBar, d: OhlcBar, e: OhlcBar): boolean {
  return a.close > a.open && bodyRatio(a) >= 0.5
    && [b, c, d].every((x) => x.high <= a.high && x.low >= a.low)
    && e.close > e.open && bodyRatio(e) >= 0.5
    && e.close > a.close;
}

export function detectFallingThreeMethods(a: OhlcBar, b: OhlcBar, c: OhlcBar, d: OhlcBar, e: OhlcBar): boolean {
  return a.close < a.open && bodyRatio(a) >= 0.5
    && [b, c, d].every((x) => x.high <= a.high && x.low >= a.low)
    && e.close < e.open && bodyRatio(e) >= 0.5
    && e.close < a.close;
}

// `chronologicalBars` must already be oldest-first, same convention as detectPatterns() in
// candlestickPatternDetection.ts. Each match anchors at the LAST bar of its window (the
// confirmation/completion candle) - index i for a 2-bar match, a 3-bar match, or a 5-bar match
// (added 2026-10-03, the Complex tier), all ending at i. A single index can carry a match from
// each window at once (they're independent pattern types, not mutually exclusive the way the
// single-bar patterns are), so this deliberately doesn't dedupe/prioritize between them.
export function detectComplexPatterns(chronologicalBars: OhlcBar[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  chronologicalBars.forEach((curr, i) => {
    if (i >= 1) {
      const prev = chronologicalBars[i - 1];
      let pattern: CandlestickPatternKey | null = null;
      if (detectBullishEngulfing(prev, curr)) pattern = 'bullishEngulfing';
      else if (detectBearishEngulfing(prev, curr)) pattern = 'bearishEngulfing';
      else if (detectPiercingLine(prev, curr)) pattern = 'piercingLine';
      else if (detectDarkCloudCover(prev, curr)) pattern = 'darkCloudCover';
      else if (detectBullishHarami(prev, curr)) pattern = 'bullishHarami';
      else if (detectBearishHarami(prev, curr)) pattern = 'bearishHarami';
      else if (detectTweezerBottom(prev, curr)) pattern = 'tweezerBottom';
      else if (detectTweezerTop(prev, curr)) pattern = 'tweezerTop';
      else if (detectBullishKicking(prev, curr)) pattern = 'bullishKicking';
      else if (detectBearishKicking(prev, curr)) pattern = 'bearishKicking';
      if (pattern) matches.push({ index: i, pattern });
    }
    if (i >= 2) {
      const a = chronologicalBars[i - 2];
      const b = chronologicalBars[i - 1];
      let pattern: CandlestickPatternKey | null = null;
      if (detectBullishAbandonedBaby(a, b, curr)) pattern = 'bullishAbandonedBaby';
      else if (detectBearishAbandonedBaby(a, b, curr)) pattern = 'bearishAbandonedBaby';
      else if (detectMorningStar(a, b, curr)) pattern = 'morningStar';
      else if (detectEveningStar(a, b, curr)) pattern = 'eveningStar';
      else if (detectThreeWhiteSoldiers(a, b, curr)) pattern = 'threeWhiteSoldiers';
      else if (detectThreeBlackCrows(a, b, curr)) pattern = 'threeBlackCrows';
      else if (detectThreeInsideUp(a, b, curr)) pattern = 'threeInsideUp';
      else if (detectThreeInsideDown(a, b, curr)) pattern = 'threeInsideDown';
      else if (detectThreeOutsideUp(a, b, curr)) pattern = 'threeOutsideUp';
      else if (detectThreeOutsideDown(a, b, curr)) pattern = 'threeOutsideDown';
      else if (detectUpsideTasukiGap(a, b, curr)) pattern = 'upsideTasukiGap';
      else if (detectDownsideTasukiGap(a, b, curr)) pattern = 'downsideTasukiGap';
      if (pattern) matches.push({ index: i, pattern });
    }
    if (i >= 4) {
      const a = chronologicalBars[i - 4];
      const b = chronologicalBars[i - 3];
      const c = chronologicalBars[i - 2];
      const d = chronologicalBars[i - 1];
      let pattern: CandlestickPatternKey | null = null;
      if (detectRisingThreeMethods(a, b, c, d, curr)) pattern = 'risingThreeMethods';
      else if (detectFallingThreeMethods(a, b, c, d, curr)) pattern = 'fallingThreeMethods';
      if (pattern) matches.push({ index: i, pattern });
    }
  });
  return matches;
}
