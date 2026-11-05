import { describe, expect, test } from 'vitest';
import {
  detectBullishEngulfing, detectBearishEngulfing, detectMorningStar, detectEveningStar,
  detectPiercingLine, detectDarkCloudCover, detectThreeWhiteSoldiers, detectThreeBlackCrows,
  detectBullishHarami, detectBearishHarami, detectTweezerBottom, detectTweezerTop,
  detectBullishKicking, detectBearishKicking,
  detectBullishAbandonedBaby, detectBearishAbandonedBaby,
  detectUpsideTasukiGap, detectDownsideTasukiGap,
  detectRisingThreeMethods, detectFallingThreeMethods,
  detectThreeInsideUp, detectThreeInsideDown, detectThreeOutsideUp, detectThreeOutsideDown,
  detectComplexPatterns,
} from './candlestickComplexPatternDetection';

describe('detectBullishEngulfing', () => {
  test('a smaller bearish candle followed by a larger bullish candle that fully engulfs it', () => {
    const prev = { open: 10, high: 10.2, low: 8.8, close: 9 };
    const curr = { open: 8.5, high: 10.7, low: 8.3, close: 10.5 };
    expect(detectBullishEngulfing(prev, curr)).toBe(true);
  });

  test('not engulfing when curr\'s close doesn\'t reach prev\'s open', () => {
    const prev = { open: 10, high: 10.2, low: 8.8, close: 9 };
    const curr = { open: 9.5, high: 9.9, low: 9.3, close: 9.8 }; // close (9.8) < prev.open (10)
    expect(detectBullishEngulfing(prev, curr)).toBe(false);
  });

  test('not engulfing when prev is bullish, not bearish', () => {
    const prev = { open: 9, high: 10.2, low: 8.8, close: 10 };
    const curr = { open: 8.5, high: 10.7, low: 8.3, close: 10.5 };
    expect(detectBullishEngulfing(prev, curr)).toBe(false);
  });
});

describe('detectBearishEngulfing', () => {
  test('a smaller bullish candle followed by a larger bearish candle that fully engulfs it', () => {
    const prev = { open: 9, high: 10.2, low: 8.8, close: 10 };
    const curr = { open: 10.5, high: 10.7, low: 8.3, close: 8.5 };
    expect(detectBearishEngulfing(prev, curr)).toBe(true);
  });

  test('not engulfing when curr\'s close doesn\'t reach prev\'s open', () => {
    const prev = { open: 9, high: 10.2, low: 8.8, close: 10 };
    const curr = { open: 10.2, high: 10.4, low: 9.2, close: 9.5 }; // close (9.5) > prev.open (9)
    expect(detectBearishEngulfing(prev, curr)).toBe(false);
  });
});

describe('detectMorningStar', () => {
  const a = { open: 20, high: 20.5, low: 15, close: 16 }; // long bearish, bodyRatio ~0.73
  const b = { open: 14, high: 14.5, low: 13.8, close: 14.3 }; // small body, gaps down from a.close
  const c = { open: 14.5, high: 19.2, low: 14.3, close: 19 }; // long bullish, closes past a's midpoint (18)

  test('a long bearish candle, a small gapped-down candle, then a long bullish candle closing past the first candle\'s midpoint', () => {
    expect(detectMorningStar(a, b, c)).toBe(true);
  });

  test('fails when the middle candle doesn\'t actually gap down (its body overlaps a\'s close)', () => {
    const overlappingB = { ...b, open: 16.5, close: 16.8 }; // max(open,close)=16.8, not < a.close(16)
    expect(detectMorningStar(a, overlappingB, c)).toBe(false);
  });

  test('fails when the middle candle\'s body is too large relative to the first candle', () => {
    const bigB = { ...b, open: 10, close: 15 }; // body=5, > 0.3 * a's body (1.2)
    expect(detectMorningStar(a, bigB, c)).toBe(false);
  });

  test('fails when the third candle doesn\'t close past the first candle\'s midpoint', () => {
    const shallowC = { ...c, close: 17.5 }; // midpoint is 18
    expect(detectMorningStar(a, b, shallowC)).toBe(false);
  });
});

describe('detectEveningStar', () => {
  const a = { open: 15, high: 19.5, low: 14.5, close: 19 }; // long bullish, bodyRatio 0.8
  const b = { open: 20.5, high: 21, low: 20.3, close: 20.8 }; // small body, gaps up from a.close
  const c = { open: 20.5, high: 20.7, low: 15.8, close: 16 }; // long bearish, closes past a's midpoint (17)

  test('a long bullish candle, a small gapped-up candle, then a long bearish candle closing past the first candle\'s midpoint', () => {
    expect(detectEveningStar(a, b, c)).toBe(true);
  });

  test('fails when the middle candle doesn\'t actually gap up (its body overlaps a\'s close)', () => {
    const overlappingB = { ...b, open: 18.5, close: 18.8 }; // min(open,close)=18.5, not > a.close(19)
    expect(detectEveningStar(a, overlappingB, c)).toBe(false);
  });
});

describe('detectBullishAbandonedBaby', () => {
  const a = { open: 20, high: 20.5, low: 15, close: 16 }; // long bearish, same as Morning Star's own a
  const b = { open: 13, high: 13.3, low: 12.8, close: 13.2 }; // small body, gaps completely below a's low (15)
  const c = { open: 13.6, high: 19.2, low: 13.5, close: 19 }; // long bullish, gaps completely above b's high (13.3)

  test('a Morning Star shape where the middle candle also gaps completely clear of both neighbors', () => {
    expect(detectBullishAbandonedBaby(a, b, c)).toBe(true);
  });

  test('fails when the middle candle doesn\'t gap fully clear of candle 1 (even though the weaker Morning Star check still passes)', () => {
    const touchingB = { ...b, high: 15.2 }; // high (15.2) no longer < a's low (15)
    expect(detectMorningStar(a, touchingB, c)).toBe(true); // still a valid (weaker) Morning Star
    expect(detectBullishAbandonedBaby(a, touchingB, c)).toBe(false);
  });

  test('fails when candle 3 doesn\'t gap fully clear of the middle candle (even though the weaker Morning Star check still passes)', () => {
    const overlappingC = { ...c, low: 13.0 }; // low (13.0) no longer > b's high (13.3)
    expect(detectMorningStar(a, b, overlappingC)).toBe(true); // still a valid (weaker) Morning Star
    expect(detectBullishAbandonedBaby(a, b, overlappingC)).toBe(false);
  });
});

describe('detectBearishAbandonedBaby', () => {
  const a = { open: 15, high: 19.5, low: 14.5, close: 19 }; // long bullish, same as Evening Star's own a
  const b = { open: 20, high: 20.3, low: 19.8, close: 20.1 }; // small body, gaps completely above a's high (19.5)
  const c = { open: 19.5, high: 19.7, low: 15.8, close: 16 }; // long bearish, gaps completely below b's low (19.8)

  test('an Evening Star shape where the middle candle also gaps completely clear of both neighbors', () => {
    expect(detectBearishAbandonedBaby(a, b, c)).toBe(true);
  });

  test('fails when the middle candle doesn\'t gap fully clear of candle 1 (even though the weaker Evening Star check still passes)', () => {
    const touchingB = { ...b, low: 19.2 }; // low (19.2) no longer > a's high (19.5)
    expect(detectEveningStar(a, touchingB, c)).toBe(true); // still a valid (weaker) Evening Star
    expect(detectBearishAbandonedBaby(a, touchingB, c)).toBe(false);
  });

  test('fails when candle 3 doesn\'t gap fully clear of the middle candle (even though the weaker Evening Star check still passes)', () => {
    const overlappingC = { ...c, high: 20.0 }; // high (20.0) no longer < b's low (19.8)
    expect(detectEveningStar(a, b, overlappingC)).toBe(true); // still a valid (weaker) Evening Star
    expect(detectBearishAbandonedBaby(a, b, overlappingC)).toBe(false);
  });
});

describe('detectPiercingLine', () => {
  const prev = { open: 20, high: 20.3, low: 15, close: 16 }; // long bearish, bodyRatio ~0.755
  const curr = { open: 14.5, high: 19.2, low: 14.3, close: 19 }; // gaps below prev.low, closes past midpoint (18) but not past prev.open (20)

  test('a long bearish candle, then a candle gapping below its low that recovers more than halfway into its body without fully engulfing it', () => {
    expect(detectPiercingLine(prev, curr)).toBe(true);
  });

  test('fails when curr doesn\'t gap below prev\'s low', () => {
    const noGap = { ...curr, open: 15.5 };
    expect(detectPiercingLine(prev, noGap)).toBe(false);
  });

  test('fails when curr recovers less than halfway into prev\'s body', () => {
    const shallowRecovery = { ...curr, close: 17 }; // midpoint is 18
    expect(detectPiercingLine(prev, shallowRecovery)).toBe(false);
  });

  test('fails once curr fully engulfs prev (that\'s Bullish Engulfing territory instead)', () => {
    const fullEngulf = { ...curr, close: 20 }; // == prev.open
    expect(detectPiercingLine(prev, fullEngulf)).toBe(false);
  });
});

describe('detectDarkCloudCover', () => {
  const prev = { open: 15, high: 20, low: 14.7, close: 19 }; // long bullish, bodyRatio ~0.755
  const curr = { open: 20.5, high: 20.7, low: 15.8, close: 16 }; // gaps above prev.high, closes past midpoint (17) but not past prev.open (15)

  test('a long bullish candle, then a candle gapping above its high that falls more than halfway into its body without fully engulfing it', () => {
    expect(detectDarkCloudCover(prev, curr)).toBe(true);
  });

  test('fails when curr doesn\'t gap above prev\'s high', () => {
    const noGap = { ...curr, open: 19.5 };
    expect(detectDarkCloudCover(prev, noGap)).toBe(false);
  });

  test('fails when curr falls less than halfway into prev\'s body', () => {
    const shallowFall = { ...curr, close: 18 }; // midpoint is 17
    expect(detectDarkCloudCover(prev, shallowFall)).toBe(false);
  });

  test('fails once curr fully engulfs prev (that\'s Bearish Engulfing territory instead)', () => {
    const fullEngulf = { ...curr, close: 15 }; // == prev.open
    expect(detectDarkCloudCover(prev, fullEngulf)).toBe(false);
  });
});

describe('detectThreeWhiteSoldiers', () => {
  const a = { open: 10, high: 12.2, low: 9.8, close: 12 }; // long bullish, small upper wick
  const b = { open: 11, high: 13.3, low: 10.8, close: 13 }; // opens within a's body, long bullish
  const c = { open: 12, high: 14.3, low: 11.8, close: 14 }; // opens within b's body, long bullish

  test('three consecutive long bullish candles, each opening within the prior candle\'s body and closing near its own high', () => {
    expect(detectThreeWhiteSoldiers(a, b, c)).toBe(true);
  });

  test('fails when a later candle gaps up instead of opening within the prior body', () => {
    const gappedB = { ...b, open: 12.5 }; // not < a.close (12)
    expect(detectThreeWhiteSoldiers(a, gappedB, c)).toBe(false);
  });

  test('fails when a candle\'s closing wick is too large to read as "closing near its own high"', () => {
    const bigWickC = { ...c, high: 16 }; // upperWick = 16-14 = 2, > 0.15 * (16-11.8) = 0.63
    expect(detectThreeWhiteSoldiers(a, b, bigWickC)).toBe(false);
  });
});

describe('detectThreeBlackCrows', () => {
  const a = { open: 20, high: 20.2, low: 17.8, close: 18 }; // long bearish, small lower wick
  const b = { open: 19, high: 19.2, low: 16.7, close: 17 }; // opens within a's body, long bearish
  const c = { open: 18, high: 18.2, low: 15.7, close: 16 }; // opens within b's body, long bearish

  test('three consecutive long bearish candles, each opening within the prior candle\'s body and closing near its own low', () => {
    expect(detectThreeBlackCrows(a, b, c)).toBe(true);
  });

  test('fails when a later candle gaps down instead of opening within the prior body', () => {
    const gappedB = { ...b, open: 17.5 }; // not > a.close (18)
    expect(detectThreeBlackCrows(a, gappedB, c)).toBe(false);
  });

  test('fails when a candle\'s closing wick is too large to read as "closing near its own low"', () => {
    const bigWickC = { ...c, low: 14 }; // lowerWick = 16-14 = 2, > 0.15 * (18.2-14) = 0.63
    expect(detectThreeBlackCrows(a, b, bigWickC)).toBe(false);
  });
});

describe('detectBullishHarami', () => {
  const prev = { open: 20, high: 20.5, low: 14.5, close: 15 }; // large bearish, bodyRatio ~0.833
  const curr = { open: 17, high: 18.5, low: 16.5, close: 18 }; // smaller bullish, body fully inside prev's body [15,20]

  test('a large bearish candle followed by a smaller bullish candle whose entire body sits within the first candle\'s body', () => {
    expect(detectBullishHarami(prev, curr)).toBe(true);
  });

  test('fails when curr\'s body pokes outside prev\'s body', () => {
    const pokesOut = { ...curr, open: 14 }; // below prev's body low (15)
    expect(detectBullishHarami(prev, pokesOut)).toBe(false);
  });

  test('fails when curr is bearish, not bullish', () => {
    const bearishCurr = { ...curr, open: 18, close: 17 };
    expect(detectBullishHarami(prev, bearishCurr)).toBe(false);
  });
});

describe('detectBearishHarami', () => {
  const prev = { open: 15, high: 20.5, low: 14.5, close: 20 }; // large bullish, bodyRatio ~0.833
  const curr = { open: 18, high: 18.5, low: 16.5, close: 17 }; // smaller bearish, body fully inside prev's body [15,20]

  test('a large bullish candle followed by a smaller bearish candle whose entire body sits within the first candle\'s body', () => {
    expect(detectBearishHarami(prev, curr)).toBe(true);
  });

  test('fails when curr\'s body pokes outside prev\'s body', () => {
    const pokesOut = { ...curr, open: 21 }; // above prev's body high (20)
    expect(detectBearishHarami(prev, pokesOut)).toBe(false);
  });

  test('fails when curr is bullish, not bearish', () => {
    const bullishCurr = { ...curr, open: 17, close: 18 };
    expect(detectBearishHarami(prev, bullishCurr)).toBe(false);
  });
});

describe('detectTweezerBottom', () => {
  const prev = { open: 20, high: 20.5, low: 15, close: 17 }; // bearish, continuing the decline
  const curr = { open: 15.2, high: 19, low: 15, close: 18.5 }; // same low as prev, bullish, closes higher

  test('two candles sharing virtually identical lows after a decline', () => {
    expect(detectTweezerBottom(prev, curr)).toBe(true);
  });

  test('still matches when the two candles are the SAME color - opposite colors only affect reliability, not detection', () => {
    const sameColorCurr = { ...curr, open: 18.8, close: 16 }; // bearish like prev, same low
    expect(detectTweezerBottom(prev, sameColorCurr)).toBe(true);
  });

  test('fails when the lows differ by more than the tolerance', () => {
    const farLow = { ...curr, low: 13.5 }; // well below prev's low (15)
    expect(detectTweezerBottom(prev, farLow)).toBe(false);
  });
});

describe('detectTweezerTop', () => {
  const prev = { open: 15, high: 20, low: 14.5, close: 18 }; // bullish, continuing the rally
  const curr = { open: 18.3, high: 20, low: 16, close: 16.5 }; // same high as prev, bearish, closes lower

  test('two candles sharing virtually identical highs after a rally', () => {
    expect(detectTweezerTop(prev, curr)).toBe(true);
  });

  test('still matches when the two candles are the SAME color - opposite colors only affect reliability, not detection', () => {
    const sameColorCurr = { ...curr, open: 16.2, close: 19 }; // bullish like prev, same high
    expect(detectTweezerTop(prev, sameColorCurr)).toBe(true);
  });

  test('fails when the highs differ by more than the tolerance', () => {
    const farHigh = { ...curr, high: 22 }; // well above prev's high (20)
    expect(detectTweezerTop(prev, farHigh)).toBe(false);
  });
});

describe('detectBullishKicking', () => {
  const prev = { open: 20, high: 20, low: 15, close: 15 }; // bearish Marubozu, no wicks
  const curr = { open: 25, high: 30, low: 25, close: 30 }; // bullish Marubozu, no wicks, gaps up past prev's high (20)

  test('a bearish Marubozu followed by a bullish Marubozu that gaps up with zero overlap', () => {
    expect(detectBullishKicking(prev, curr)).toBe(true);
  });

  test('fails when either candle has a real wick (not a true Marubozu)', () => {
    const wickyCurr = { ...curr, high: 31 }; // upper wick now present
    expect(detectBullishKicking(prev, wickyCurr)).toBe(false);
  });

  test('fails when the two candles\' ranges overlap (no real gap)', () => {
    // Still a valid bullish Marubozu (high === close, low === open), just positioned so its
    // range [18,22] overlaps prev's range [15,20] instead of gapping past it.
    const overlappingCurr = { open: 18, high: 22, low: 18, close: 22 };
    expect(detectBullishKicking(prev, overlappingCurr)).toBe(false);
  });

  test('fails when prev is bullish, not bearish', () => {
    const bullishPrev = { ...prev, open: 15, close: 20 };
    expect(detectBullishKicking(bullishPrev, curr)).toBe(false);
  });
});

describe('detectBearishKicking', () => {
  const prev = { open: 15, high: 20, low: 15, close: 20 }; // bullish Marubozu, no wicks
  const curr = { open: 10, high: 10, low: 5, close: 5 }; // bearish Marubozu, no wicks, gaps down past prev's low (15)

  test('a bullish Marubozu followed by a bearish Marubozu that gaps down with zero overlap', () => {
    expect(detectBearishKicking(prev, curr)).toBe(true);
  });

  test('fails when either candle has a real wick (not a true Marubozu)', () => {
    const wickyCurr = { ...curr, low: 4 }; // lower wick now present
    expect(detectBearishKicking(prev, wickyCurr)).toBe(false);
  });

  test('fails when the two candles\' ranges overlap (no real gap)', () => {
    // Still a valid bearish Marubozu (high === open, low === close), just positioned so its
    // range [13,17] overlaps prev's range [15,20] instead of gapping below it.
    const overlappingCurr = { open: 17, high: 17, low: 13, close: 13 };
    expect(detectBearishKicking(prev, overlappingCurr)).toBe(false);
  });
});

describe('detectThreeInsideUp', () => {
  const a = { open: 20, high: 20.5, low: 14.5, close: 15 }; // large bearish (Bullish Harami's prev)
  const b = { open: 17, high: 18.5, low: 16.5, close: 18 }; // smaller bullish, contained in a's body (Harami's curr)
  const c = { open: 18, high: 21, low: 17.8, close: 20.5 }; // bullish, closes past a's own open (20)

  test('a Bullish Harami confirmed by a third bullish candle closing past the first candle\'s open', () => {
    expect(detectThreeInsideUp(a, b, c)).toBe(true);
  });

  test('fails when a/b isn\'t a valid Bullish Harami at all', () => {
    const pokesOut = { ...b, open: 14 }; // b's body no longer contained in a's
    expect(detectThreeInsideUp(a, pokesOut, c)).toBe(false);
  });

  test('fails when c doesn\'t close back past a\'s own open (still just a bare Harami)', () => {
    const shallowC = { ...c, close: 19 }; // < a.open (20)
    expect(detectThreeInsideUp(a, b, shallowC)).toBe(false);
  });
});

describe('detectThreeInsideDown', () => {
  const a = { open: 15, high: 20.5, low: 14.5, close: 20 }; // large bullish (Bearish Harami's prev)
  const b = { open: 18, high: 18.5, low: 16.5, close: 17 }; // smaller bearish, contained in a's body (Harami's curr)
  const c = { open: 17, high: 17.2, low: 14.3, close: 14.5 }; // bearish, closes past a's own open (15)

  test('a Bearish Harami confirmed by a third bearish candle closing past the first candle\'s open', () => {
    expect(detectThreeInsideDown(a, b, c)).toBe(true);
  });

  test('fails when c doesn\'t close back past a\'s own open (still just a bare Harami)', () => {
    const shallowC = { ...c, close: 16 }; // > a.open (15)
    expect(detectThreeInsideDown(a, b, shallowC)).toBe(false);
  });
});

describe('detectThreeOutsideUp', () => {
  const a = { open: 10, high: 10.2, low: 8.8, close: 9 }; // Bullish Engulfing's prev
  const b = { open: 8.5, high: 10.7, low: 8.3, close: 10.5 }; // Bullish Engulfing's curr
  const c = { open: 10.6, high: 11.5, low: 10.4, close: 11.2 }; // bullish, closes past b's own close

  test('a Bullish Engulfing confirmed by a third bullish candle closing past the engulfing candle\'s close', () => {
    expect(detectThreeOutsideUp(a, b, c)).toBe(true);
  });

  test('fails when a/b isn\'t a valid Bullish Engulfing at all', () => {
    const shallowB = { ...b, close: 9.5 }; // doesn't reach a.open (10)
    expect(detectThreeOutsideUp(a, shallowB, c)).toBe(false);
  });

  test('fails when c doesn\'t close past b\'s own close (no second session of confirmed buying)', () => {
    const shallowC = { ...c, close: 10.3 }; // < b.close (10.5)
    expect(detectThreeOutsideUp(a, b, shallowC)).toBe(false);
  });

  test('c doesn\'t need to engulf b\'s own body, only close past b\'s close', () => {
    // c's open sits WITHIN b's body (no engulf of b), but c still closes past b's close.
    const notEngulfingC = { ...c, open: 9, close: 10.6 };
    expect(detectThreeOutsideUp(a, b, notEngulfingC)).toBe(true);
  });
});

describe('detectThreeOutsideDown', () => {
  const a = { open: 9, high: 10.2, low: 8.8, close: 10 }; // Bearish Engulfing's prev
  const b = { open: 10.5, high: 10.7, low: 8.3, close: 8.5 }; // Bearish Engulfing's curr
  const c = { open: 8.4, high: 8.6, low: 7.5, close: 7.8 }; // bearish, closes past b's own close

  test('a Bearish Engulfing confirmed by a third bearish candle closing past the engulfing candle\'s close', () => {
    expect(detectThreeOutsideDown(a, b, c)).toBe(true);
  });

  test('fails when c doesn\'t close past b\'s own close (no second session of confirmed selling)', () => {
    const shallowC = { ...c, close: 8.7 }; // > b.close (8.5)
    expect(detectThreeOutsideDown(a, b, shallowC)).toBe(false);
  });
});

describe('detectUpsideTasukiGap', () => {
  const a = { open: 20, high: 25.5, low: 19.5, close: 25 }; // first bullish candle
  const b = { open: 27, high: 32, low: 26, close: 31 }; // second bullish candle, gaps up (low 26 > a's high 25.5)
  const c = { open: 29, high: 29.5, low: 25.3, close: 25.5 }; // opens within b's body, pulls back into the gap but closes (25.5) above a's own close (25)

  test('two bullish candles gapping up, then a third that opens inside the second candle\'s body and pulls back into the gap without fully filling it', () => {
    expect(detectUpsideTasukiGap(a, b, c)).toBe(true);
  });

  test('fails when candle 2 doesn\'t actually gap up (its range overlaps candle 1\'s)', () => {
    const overlappingB = { ...b, low: 24 }; // low (24) now below a's high (25.5)
    expect(detectUpsideTasukiGap(a, overlappingB, c)).toBe(false);
  });

  test('fails when candle 3 fully closes the gap (closes at or below candle 1\'s own close)', () => {
    const fullFillC = { ...c, close: 24 }; // <= a's close (25)
    expect(detectUpsideTasukiGap(a, b, fullFillC)).toBe(false);
  });

  test('fails when candle 3 doesn\'t open within candle 2\'s body', () => {
    const gappedC = { ...c, open: 32.5 }; // above b's own body (27-31)
    expect(detectUpsideTasukiGap(a, b, gappedC)).toBe(false);
  });
});

describe('detectDownsideTasukiGap', () => {
  const a = { open: 25, high: 25.5, low: 19.5, close: 20 }; // first bearish candle
  const b = { open: 18, high: 19, low: 13, close: 14 }; // second bearish candle, gaps down (high 19 < a's low 19.5)
  const c = { open: 16, high: 19.7, low: 15.5, close: 19.5 }; // opens within b's body, bounces back into the gap but closes (19.5) below a's own close (20)

  test('two bearish candles gapping down, then a third that opens inside the second candle\'s body and bounces back into the gap without fully filling it', () => {
    expect(detectDownsideTasukiGap(a, b, c)).toBe(true);
  });

  test('fails when candle 2 doesn\'t actually gap down (its range overlaps candle 1\'s)', () => {
    const overlappingB = { ...b, high: 20 }; // high (20) now above a's low (19.5)
    expect(detectDownsideTasukiGap(a, overlappingB, c)).toBe(false);
  });

  test('fails when candle 3 fully closes the gap (closes at or above candle 1\'s own close)', () => {
    const fullFillC = { ...c, close: 20.5 }; // >= a's close (20)
    expect(detectDownsideTasukiGap(a, b, fullFillC)).toBe(false);
  });

  test('fails when candle 3 doesn\'t open within candle 2\'s body', () => {
    const gappedC = { ...c, open: 12.5 }; // below b's own body (14-18)
    expect(detectDownsideTasukiGap(a, b, gappedC)).toBe(false);
  });
});

describe('detectRisingThreeMethods', () => {
  const a = { open: 10, high: 20.5, low: 9.5, close: 20 }; // long bullish candle
  const b = { open: 18, high: 18.5, low: 15.5, close: 16 }; // small, contained within a's range [9.5,20.5]
  const c = { open: 16, high: 16.5, low: 13.5, close: 14 }; // small, contained, drifting lower
  const d = { open: 14, high: 14.5, low: 11.5, close: 12 }; // small, contained, drifting lower still
  const e = { open: 12, high: 22.5, low: 11.5, close: 22 }; // long bullish, closes past a's own close (20)

  test('a long bullish candle, three contained candles drifting lower, then a long bullish candle closing past the first candle\'s close', () => {
    expect(detectRisingThreeMethods(a, b, c, d, e)).toBe(true);
  });

  test('fails when a middle candle breaks below the first candle\'s own low', () => {
    const brokenD = { ...d, low: 9 }; // < a's low (9.5)
    expect(detectRisingThreeMethods(a, b, c, brokenD, e)).toBe(false);
  });

  test('fails when the fifth candle doesn\'t close past the first candle\'s own close', () => {
    const shallowE = { ...e, close: 19 }; // < a's close (20)
    expect(detectRisingThreeMethods(a, b, c, d, shallowE)).toBe(false);
  });
});

describe('detectFallingThreeMethods', () => {
  const a = { open: 20, high: 20.5, low: 9.5, close: 10 }; // long bearish candle
  const b = { open: 12, high: 14.5, low: 11.5, close: 14 }; // small, contained within a's range [9.5,20.5]
  const c = { open: 14, high: 16.5, low: 13.5, close: 16 }; // small, contained, drifting higher
  const d = { open: 16, high: 18.5, low: 15.5, close: 18 }; // small, contained, drifting higher still
  const e = { open: 18, high: 18.5, low: 7.5, close: 8 }; // long bearish, closes past a's own close (10)

  test('a long bearish candle, three contained candles drifting higher, then a long bearish candle closing past the first candle\'s close', () => {
    expect(detectFallingThreeMethods(a, b, c, d, e)).toBe(true);
  });

  test('fails when a middle candle breaks above the first candle\'s own high', () => {
    const brokenD = { ...d, high: 21 }; // > a's high (20.5)
    expect(detectFallingThreeMethods(a, b, c, brokenD, e)).toBe(false);
  });

  test('fails when the fifth candle doesn\'t close past the first candle\'s own close', () => {
    const shallowE = { ...e, close: 11 }; // > a's close (10)
    expect(detectFallingThreeMethods(a, b, c, d, shallowE)).toBe(false);
  });
});

describe('detectComplexPatterns', () => {
  test('anchors each match at the last bar of its window, in chronological order', () => {
    const bearishBar = { open: 10, high: 10.2, low: 8.8, close: 9 };
    const bullishEngulfBar = { open: 8.5, high: 10.7, low: 8.3, close: 10.5 };
    // Bearish and closing below bullishEngulfBar's own close (10.5) - deliberately doesn't ALSO
    // complete a Three Outside Up (which needs a bullish 3rd candle closing past 10.5), now that
    // that detector exists too. high raised to 11.2 (was 10.6) so it also doesn't coincidentally
    // match bullishEngulfBar's own high (10.7) closely enough to trigger Tweezer Top. Keeps this
    // test's own purpose (anchoring/ordering) isolated from the newer patterns.
    const neutral = { open: 10.5, high: 11.2, low: 10.2, close: 10.3 };

    const bars = [bearishBar, bullishEngulfBar, neutral];
    expect(detectComplexPatterns(bars)).toEqual([{ index: 1, pattern: 'bullishEngulfing' }]);
  });

  test('an empty or too-short bar array returns no matches', () => {
    expect(detectComplexPatterns([])).toEqual([]);
    expect(detectComplexPatterns([{ open: 10, high: 11, low: 9, close: 10.5 }])).toEqual([]);
  });

  test('a single index can carry both a 2-bar and a 3-bar match at once (independent pattern types)', () => {
    // A: long bearish (Morning Star's first candle). B: small, bearish (Morning Star's gapped
    // middle candle) - which is ALSO a valid "prev" for a Bullish Engulfing against C. C: long
    // bullish, closing past A's midpoint (completes Morning Star) and fully engulfing B's tiny
    // body (completes Bullish Engulfing) - both fire at C's own index.
    const a = { open: 20, high: 20.5, low: 15, close: 16 };
    const b = { open: 14.3, high: 14.5, low: 13.8, close: 14 };
    const c = { open: 13.9, high: 19.2, low: 13.7, close: 19 };

    expect(detectComplexPatterns([a, b, c])).toEqual([
      { index: 2, pattern: 'bullishEngulfing' },
      { index: 2, pattern: 'morningStar' },
    ]);
  });

  test('a partial-recovery pair is classified as Piercing Line, not left unmatched', () => {
    const prev = { open: 20, high: 20.3, low: 15, close: 16 };
    const curr = { open: 14.5, high: 19.2, low: 14.3, close: 19 };
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'piercingLine' }]);
  });

  test('the same pair, once curr fully engulfs prev, is classified as Bullish Engulfing instead of Piercing Line', () => {
    const prev = { open: 20, high: 20.3, low: 15, close: 16 };
    const fullEngulfCurr = { open: 14.5, high: 20.7, low: 14.3, close: 20 };
    expect(detectComplexPatterns([prev, fullEngulfCurr])).toEqual([{ index: 1, pattern: 'bullishEngulfing' }]);
  });

  test('anchors a Three White Soldiers match at the last (3rd) bar of its window', () => {
    const a = { open: 10, high: 12.2, low: 9.8, close: 12 };
    const b = { open: 11, high: 13.3, low: 10.8, close: 13 };
    const c = { open: 12, high: 14.3, low: 11.8, close: 14 };
    expect(detectComplexPatterns([a, b, c])).toEqual([{ index: 2, pattern: 'threeWhiteSoldiers' }]);
  });

  test('a Bullish Harami pair is classified as bullishHarami, distinct from Engulfing\'s opposite containment direction', () => {
    const prev = { open: 20, high: 20.5, low: 14.5, close: 15 };
    const curr = { open: 17, high: 18.5, low: 16.5, close: 18 };
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'bullishHarami' }]);
  });

  test('a Three Inside Up window carries both its own bare bullishHarami match (at the Harami\'s own index) and the threeInsideUp confirmation (at the window\'s last index)', () => {
    const a = { open: 20, high: 20.5, low: 14.5, close: 15 };
    const b = { open: 17, high: 18.5, low: 16.5, close: 18 };
    const c = { open: 18, high: 21, low: 17.8, close: 20.5 };
    expect(detectComplexPatterns([a, b, c])).toEqual([
      { index: 1, pattern: 'bullishHarami' },
      { index: 2, pattern: 'threeInsideUp' },
    ]);
  });

  test('anchors a Three Outside Down match at the last (3rd) bar of its window', () => {
    const a = { open: 9, high: 10.2, low: 8.8, close: 10 };
    const b = { open: 10.5, high: 10.7, low: 8.3, close: 8.5 };
    const c = { open: 8.4, high: 8.6, low: 7.5, close: 7.8 };
    expect(detectComplexPatterns([a, b, c])).toEqual([
      { index: 1, pattern: 'bearishEngulfing' },
      { index: 2, pattern: 'threeOutsideDown' },
    ]);
  });

  test('a Tweezer Bottom pair is classified as tweezerBottom', () => {
    const prev = { open: 20, high: 20.5, low: 15, close: 17 };
    const curr = { open: 15.2, high: 19, low: 15, close: 18.5 };
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'tweezerBottom' }]);
  });

  test('a Tweezer Top pair is classified as tweezerTop', () => {
    const prev = { open: 15, high: 20, low: 14.5, close: 18 };
    const curr = { open: 18.3, high: 20, low: 16, close: 16.5 };
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'tweezerTop' }]);
  });

  test('a pair that qualifies as both Bullish Harami and matching-lows is classified as bullishHarami, since Tweezer is checked last as the weaker fallback', () => {
    const prev = { open: 20, high: 20.5, low: 14.5, close: 15 }; // large bearish
    const curr = { open: 17, high: 18.5, low: 14.5, close: 18 }; // small bullish, contained in prev's body, low deliberately matches prev's own low (14.5)
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'bullishHarami' }]);
  });

  test('a Bullish Kicking pair is classified as bullishKicking', () => {
    const prev = { open: 20, high: 20, low: 15, close: 15 };
    const curr = { open: 25, high: 30, low: 25, close: 30 };
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'bullishKicking' }]);
  });

  test('a Bearish Kicking pair is classified as bearishKicking', () => {
    const prev = { open: 15, high: 20, low: 15, close: 20 };
    const curr = { open: 10, high: 10, low: 5, close: 5 };
    expect(detectComplexPatterns([prev, curr])).toEqual([{ index: 1, pattern: 'bearishKicking' }]);
  });

  test('a Morning Star window that also meets Abandoned Baby\'s stricter double gap is classified as bullishAbandonedBaby, not the weaker morningStar', () => {
    const a = { open: 20, high: 20.5, low: 15, close: 16 };
    const b = { open: 13, high: 13.3, low: 12.8, close: 13.2 };
    const c = { open: 13.6, high: 19.2, low: 13.5, close: 19 };
    expect(detectComplexPatterns([a, b, c])).toEqual([{ index: 2, pattern: 'bullishAbandonedBaby' }]);
  });

  test('a Evening Star window that also meets Abandoned Baby\'s stricter double gap is classified as bearishAbandonedBaby, not the weaker eveningStar', () => {
    const a = { open: 15, high: 19.5, low: 14.5, close: 19 };
    const b = { open: 20, high: 20.3, low: 19.8, close: 20.1 };
    const c = { open: 19.5, high: 19.7, low: 15.8, close: 16 };
    expect(detectComplexPatterns([a, b, c])).toEqual([{ index: 2, pattern: 'bearishAbandonedBaby' }]);
  });

  test('a Morning Star window that only partially gaps (the common case) is still classified as morningStar', () => {
    const a = { open: 20, high: 20.5, low: 15, close: 16 };
    const b = { open: 14, high: 14.5, low: 13.8, close: 14.3 };
    const c = { open: 14.5, high: 19.2, low: 14.3, close: 19 };
    expect(detectComplexPatterns([a, b, c])).toEqual([{ index: 2, pattern: 'morningStar' }]);
  });

  test('an Upside Tasuki Gap window is classified as upsideTasukiGap', () => {
    const a = { open: 20, high: 25.5, low: 19.5, close: 25 };
    const b = { open: 27, high: 32, low: 26, close: 31 };
    const c = { open: 29, high: 29.5, low: 25.3, close: 25.5 };
    expect(detectComplexPatterns([a, b, c])).toEqual([{ index: 2, pattern: 'upsideTasukiGap' }]);
  });

  test('a Downside Tasuki Gap window is classified as downsideTasukiGap', () => {
    const a = { open: 25, high: 25.5, low: 19.5, close: 20 };
    const b = { open: 18, high: 19, low: 13, close: 14 };
    const c = { open: 16, high: 19.7, low: 15.5, close: 19.5 };
    expect(detectComplexPatterns([a, b, c])).toEqual([{ index: 2, pattern: 'downsideTasukiGap' }]);
  });

  // The next two tests use toContainEqual rather than an exact toEqual, unlike every test above -
  // a genuine 5-bar window's own adjacent pairs (a,b)/(b,c)/(c,d) can legitimately ALSO satisfy a
  // weaker 2-bar containment check (e.g. Harami) purely as a structural side effect of "b/c/d sit
  // inside a's own range," which is exactly the same "independent pattern types, not deduped"
  // precedent already established above - this just makes that explicit rather than hand-auditing
  // every adjacent pair to force a fixture with zero incidental matches.
  test('a Rising Three Methods window is classified as risingThreeMethods, anchored at the 5th bar', () => {
    const a = { open: 10, high: 20.5, low: 9.5, close: 20 };
    const b = { open: 18, high: 18.5, low: 15.5, close: 16 };
    const c = { open: 16, high: 16.5, low: 13.5, close: 14 };
    const d = { open: 14, high: 14.5, low: 11.5, close: 12 };
    const e = { open: 13, high: 22.5, low: 10, close: 22 };
    expect(detectComplexPatterns([a, b, c, d, e])).toContainEqual({ index: 4, pattern: 'risingThreeMethods' });
  });

  test('a Falling Three Methods window is classified as fallingThreeMethods, anchored at the 5th bar', () => {
    const a = { open: 20, high: 20.5, low: 9.5, close: 10 };
    const b = { open: 12, high: 14.5, low: 11.5, close: 14 };
    const c = { open: 14, high: 16.5, low: 13.5, close: 16 };
    const d = { open: 16, high: 18.5, low: 15.5, close: 18 };
    const e = { open: 17, high: 20, low: 7.5, close: 8 };
    expect(detectComplexPatterns([a, b, c, d, e])).toContainEqual({ index: 4, pattern: 'fallingThreeMethods' });
  });
});
