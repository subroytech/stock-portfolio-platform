import { describe, expect, test } from 'vitest';
import { getPatternDiagram, hasPatternDiagram, DIRECTION_COLORS } from './candlestickPatternDiagrams';

describe('getPatternDiagram', () => {
  test('returns single-candle geometry for a known single-candle pattern', () => {
    const shapes = getPatternDiagram('Doji');
    expect(shapes).not.toBeNull();
    expect(shapes).toHaveLength(1);
    expect(shapes?.[0].direction).toBe('neutral');
  });

  test('returns multi-candle geometry for a known multi-candle pattern', () => {
    const shapes = getPatternDiagram('Morning Star');
    expect(shapes).toHaveLength(3);
  });

  test('returns null for an unrecognized pattern name', () => {
    expect(getPatternDiagram('Not A Real Pattern')).toBeNull();
  });

  test('every shape has a color defined for its direction', () => {
    const shapes = getPatternDiagram('Bullish Engulfing');
    expect(shapes).not.toBeNull();
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
    });
  });
});

describe('hasPatternDiagram', () => {
  test('true for a pattern with geometry defined', () => {
    expect(hasPatternDiagram('Doji')).toBe(true);
  });

  test('false for a pattern with no geometry defined', () => {
    expect(hasPatternDiagram('Not A Real Pattern')).toBe(false);
  });

  // Regression guard for the real gap found live 2026-09-26: the 7 patterns added alongside the
  // Category/relevant-horizons work were seeded with real Q&A content but never got a matching
  // diagram, so their curated answers silently rendered with no picture at all. Keep this list in
  // sync with backend/src/db/seedCandlestickQuestionAnswer.ts's own SEED_PATTERNS whenever a new
  // pattern is added there.
  test('every seeded pattern (all 32) has a diagram defined - no pattern silently missing its picture', () => {
    const seededPatternNames = [
      'Doji', 'Hammer', 'Bullish Engulfing', 'Bearish Engulfing', 'Morning Star', 'Shooting Star',
      'Three White Soldiers', 'Hanging Man', 'Evening Star', 'Bullish Harami', 'Bearish Harami',
      'Piercing Line', 'Dark Cloud Cover', 'Three Black Crows', 'Marubozu', 'Spinning Top',
      'Doji-Dragonfly', 'Doji-Gravestone', 'Doji-LongLegged', 'Belt Hold',
      'Three Inside Up', 'Three Inside Down', 'Three Outside Up', 'Three Outside Down',
      'Tweezer Bottom', 'Tweezer Top', 'Bullish Kicking', 'Bearish Kicking',
      'Bullish Abandoned Baby', 'Bearish Abandoned Baby', 'Upside Tasuki Gap', 'Downside Tasuki Gap',
    ];
    for (const patternName of seededPatternNames) {
      expect(hasPatternDiagram(patternName)).toBe(true);
    }
  });
});

describe('Three Inside/Outside Up/Down (2026-09-28, live-seeded content catching up on diagrams)', () => {
  test.each([
    ['Three Inside Up', 3], ['Three Inside Down', 3], ['Three Outside Up', 3], ['Three Outside Down', 3],
  ] as const)('%s has %i candles, each with a valid direction/color and well-formed geometry', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });

  test('Three Inside Up/Down reuse Bullish/Bearish Harami\'s own first two candles exactly', () => {
    const threeInsideUp = getPatternDiagram('Three Inside Up')!;
    const bullishHarami = getPatternDiagram('Bullish Harami')!;
    expect(threeInsideUp.slice(0, 2)).toEqual(bullishHarami);

    const threeInsideDown = getPatternDiagram('Three Inside Down')!;
    const bearishHarami = getPatternDiagram('Bearish Harami')!;
    expect(threeInsideDown.slice(0, 2)).toEqual(bearishHarami);
  });

  test('Three Outside Up/Down reuse Bullish/Bearish Engulfing\'s own two candles exactly', () => {
    const threeOutsideUp = getPatternDiagram('Three Outside Up')!;
    const bullishEngulfing = getPatternDiagram('Bullish Engulfing')!;
    expect(threeOutsideUp.slice(0, 2)).toEqual(bullishEngulfing);

    const threeOutsideDown = getPatternDiagram('Three Outside Down')!;
    const bearishEngulfing = getPatternDiagram('Bearish Engulfing')!;
    expect(threeOutsideDown.slice(0, 2)).toEqual(bearishEngulfing);
  });

  test('the 3rd candle in each closes past the specific confirmation level its own curated content names', () => {
    // Three Inside Up/Down: 3rd candle closes past candle 1's own OPEN.
    const threeInsideUp = getPatternDiagram('Three Inside Up')!;
    expect(threeInsideUp[2].bodyTop).toBeLessThan(threeInsideUp[0].bodyTop); // candle1 (down) open = bodyTop
    const threeInsideDown = getPatternDiagram('Three Inside Down')!;
    expect(threeInsideDown[2].bodyBottom).toBeGreaterThan(threeInsideDown[0].bodyBottom); // candle1 (up) open = bodyBottom

    // Three Outside Up/Down: 3rd candle closes past candle 2's own CLOSE.
    const threeOutsideUp = getPatternDiagram('Three Outside Up')!;
    expect(threeOutsideUp[2].bodyTop).toBeLessThan(threeOutsideUp[1].bodyTop); // candle2 (up) close = bodyTop
    const threeOutsideDown = getPatternDiagram('Three Outside Down')!;
    expect(threeOutsideDown[2].bodyBottom).toBeGreaterThan(threeOutsideDown[1].bodyBottom); // candle2 (down) close = bodyBottom
  });
});

describe('Tweezer Bottom/Top (2026-09-28)', () => {
  test.each([
    ['Tweezer Bottom', 2], ['Tweezer Top', 2],
  ] as const)('%s has %i candles, each with a valid direction/color and well-formed geometry', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });

  test('Tweezer Bottom draws both candles with the exact same low', () => {
    const shapes = getPatternDiagram('Tweezer Bottom')!;
    expect(shapes[0].low).toBe(shapes[1].low);
  });

  test('Tweezer Top draws both candles with the exact same high', () => {
    const shapes = getPatternDiagram('Tweezer Top')!;
    expect(shapes[0].high).toBe(shapes[1].high);
  });
});

describe('Bullish/Bearish Kicking (2026-09-28)', () => {
  test.each([
    ['Bullish Kicking', 2], ['Bearish Kicking', 2],
  ] as const)('%s has %i candles, each with a valid direction/color and well-formed geometry', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });

  test('both candles in each pair are Marubozu shapes - no wicks at all (high === bodyTop, low === bodyBottom)', () => {
    for (const patternName of ['Bullish Kicking', 'Bearish Kicking'] as const) {
      const shapes = getPatternDiagram(patternName)!;
      for (const shape of shapes) {
        expect(shape.high).toBe(shape.bodyTop);
        expect(shape.low).toBe(shape.bodyBottom);
      }
    }
  });

  test('Bullish Kicking: candle 2 gaps up with zero overlap - its low sits above candle 1\'s high', () => {
    const shapes = getPatternDiagram('Bullish Kicking')!;
    expect(shapes[1].low).toBeLessThan(shapes[0].high);
  });

  test('Bearish Kicking: candle 2 gaps down with zero overlap - its high sits below candle 1\'s low', () => {
    const shapes = getPatternDiagram('Bearish Kicking')!;
    expect(shapes[1].high).toBeGreaterThan(shapes[0].low);
  });
});

describe('Bullish/Bearish Abandoned Baby (2026-09-29)', () => {
  test.each([
    ['Bullish Abandoned Baby', 3], ['Bearish Abandoned Baby', 3],
  ] as const)('%s has %i candles, each with a valid direction/color and well-formed geometry', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });

  test('Bullish Abandoned Baby: candle 1/3 reuse Morning Star\'s own shapes exactly', () => {
    const abandonedBaby = getPatternDiagram('Bullish Abandoned Baby')!;
    const morningStar = getPatternDiagram('Morning Star')!;
    expect(abandonedBaby[0]).toEqual(morningStar[0]);
    expect(abandonedBaby[2]).toEqual(morningStar[2]);
  });

  test('Bullish Abandoned Baby: the middle candle gaps completely clear of both neighbors (unlike Morning Star, which only needs a one-sided gap)', () => {
    const shapes = getPatternDiagram('Bullish Abandoned Baby')!;
    expect(shapes[1].high).toBeGreaterThan(shapes[0].low); // candle 2 gapped below candle 1
    expect(shapes[2].low).toBeLessThan(shapes[1].high); // candle 3 gapped above candle 2
  });

  test('Bearish Abandoned Baby: candle 1/3 reuse Evening Star\'s own shapes exactly', () => {
    const abandonedBaby = getPatternDiagram('Bearish Abandoned Baby')!;
    const eveningStar = getPatternDiagram('Evening Star')!;
    expect(abandonedBaby[0]).toEqual(eveningStar[0]);
    expect(abandonedBaby[2]).toEqual(eveningStar[2]);
  });

  test('Bearish Abandoned Baby: the middle candle gaps completely clear of both neighbors (unlike Evening Star, which only needs a one-sided gap)', () => {
    const shapes = getPatternDiagram('Bearish Abandoned Baby')!;
    expect(shapes[1].low).toBeLessThan(shapes[0].high); // candle 2 gapped above candle 1
    expect(shapes[2].high).toBeGreaterThan(shapes[1].low); // candle 3 gapped below candle 2
  });
});

describe('Upside/Downside Tasuki Gap (2026-09-29)', () => {
  test.each([
    ['Upside Tasuki Gap', 3], ['Downside Tasuki Gap', 3],
  ] as const)('%s has %i candles, each with a valid direction/color and well-formed geometry', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });

  test('Upside Tasuki Gap: candle 2 gaps up with zero overlap from candle 1', () => {
    const shapes = getPatternDiagram('Upside Tasuki Gap')!;
    expect(shapes[1].low).toBeLessThan(shapes[0].high);
  });

  test('Upside Tasuki Gap: candle 3\'s close stays past (above) candle 1\'s own close - the gap isn\'t fully filled', () => {
    const shapes = getPatternDiagram('Upside Tasuki Gap')!;
    // direction 'down' means close = bodyBottom; direction 'up' means close = bodyTop.
    expect(shapes[2].bodyBottom).toBeLessThan(shapes[0].bodyTop);
  });

  test('Downside Tasuki Gap: candle 2 gaps down with zero overlap from candle 1', () => {
    const shapes = getPatternDiagram('Downside Tasuki Gap')!;
    expect(shapes[1].high).toBeGreaterThan(shapes[0].low);
  });

  test('Downside Tasuki Gap: candle 3\'s close stays past (below) candle 1\'s own close - the gap isn\'t fully filled', () => {
    const shapes = getPatternDiagram('Downside Tasuki Gap')!;
    // direction 'up' means close = bodyTop; direction 'down' means close = bodyBottom.
    expect(shapes[2].bodyTop).toBeGreaterThan(shapes[0].bodyBottom);
  });
});

describe('Rising/Falling Three Methods (2026-09-29, drafted ahead of the Complex 5-candle tier itself existing)', () => {
  test.each([
    ['Rising Three Methods', 5], ['Falling Three Methods', 5],
  ] as const)('%s has %i candles, each with a valid direction/color and well-formed geometry', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });

  test('Rising Three Methods: the 3 middle candles stay fully contained within candle 1\'s own high/low range', () => {
    const shapes = getPatternDiagram('Rising Three Methods')!;
    const [candle1, ...rest] = shapes;
    const middle = rest.slice(0, 3);
    middle.forEach((candle) => {
      expect(candle.high).toBeGreaterThanOrEqual(candle1.high);
      expect(candle.low).toBeLessThanOrEqual(candle1.low);
    });
  });

  test('Rising Three Methods: the 5th candle closes past (above) candle 1\'s own close', () => {
    const shapes = getPatternDiagram('Rising Three Methods')!;
    expect(shapes[4].bodyTop).toBeLessThan(shapes[0].bodyTop); // direction 'up' -> close = bodyTop
  });

  test('Falling Three Methods: the 3 middle candles stay fully contained within candle 1\'s own high/low range', () => {
    const shapes = getPatternDiagram('Falling Three Methods')!;
    const [candle1, ...rest] = shapes;
    const middle = rest.slice(0, 3);
    middle.forEach((candle) => {
      expect(candle.high).toBeGreaterThanOrEqual(candle1.high);
      expect(candle.low).toBeLessThanOrEqual(candle1.low);
    });
  });

  test('Falling Three Methods: the 5th candle closes past (below) candle 1\'s own close', () => {
    const shapes = getPatternDiagram('Falling Three Methods')!;
    expect(shapes[4].bodyBottom).toBeGreaterThan(shapes[0].bodyBottom); // direction 'down' -> close = bodyBottom
  });
});

describe('the 7 patterns added 2026-09-26', () => {
  test.each([
    ['Hanging Man', 1], ['Evening Star', 3], ['Bullish Harami', 2], ['Bearish Harami', 2],
    ['Piercing Line', 2], ['Dark Cloud Cover', 2], ['Three Black Crows', 3],
  ] as const)('%s has %i candle(s), each with a valid direction/color', (patternName, candleCount) => {
    const shapes = getPatternDiagram(patternName);
    expect(shapes).toHaveLength(candleCount);
    shapes?.forEach((shape) => {
      expect(DIRECTION_COLORS[shape.direction]).toBeDefined();
      expect(shape.bodyTop).toBeLessThanOrEqual(shape.bodyBottom);
      expect(shape.high).toBeLessThanOrEqual(shape.bodyTop);
      expect(shape.bodyBottom).toBeLessThanOrEqual(shape.low);
    });
  });
});

describe('Marubozu / Spinning Top (2026-09-26, added ahead of the Pattern Detection panel)', () => {
  test('Marubozu is a single candle with no wicks at all (high === bodyTop, low === bodyBottom)', () => {
    const shapes = getPatternDiagram('Marubozu');
    expect(shapes).toHaveLength(1);
    expect(shapes?.[0].high).toBe(shapes?.[0].bodyTop);
    expect(shapes?.[0].low).toBe(shapes?.[0].bodyBottom);
  });

  test('Spinning Top has a visibly larger body than Doji, distinguishing the two shapes', () => {
    const spinningTop = getPatternDiagram('Spinning Top');
    const doji = getPatternDiagram('Doji');
    expect(spinningTop).toHaveLength(1);
    const spinningTopBody = spinningTop![0].bodyBottom - spinningTop![0].bodyTop;
    const dojiBody = doji![0].bodyBottom - doji![0].bodyTop;
    expect(spinningTopBody).toBeGreaterThan(dojiBody);
  });
});

describe('Doji sub-types (2026-09-26, added ahead of the Pattern Detection panel)', () => {
  test('Doji-Dragonfly has no upper wick at all (high === bodyTop) and a long lower wick', () => {
    const shapes = getPatternDiagram('Doji-Dragonfly');
    expect(shapes).toHaveLength(1);
    expect(shapes![0].high).toBe(shapes![0].bodyTop);
    expect(shapes![0].low - shapes![0].bodyBottom).toBeGreaterThan(50);
  });

  test('Doji-Gravestone has no lower wick at all (low === bodyBottom) and a long upper wick', () => {
    const shapes = getPatternDiagram('Doji-Gravestone');
    expect(shapes).toHaveLength(1);
    expect(shapes![0].low).toBe(shapes![0].bodyBottom);
    expect(shapes![0].bodyTop - shapes![0].high).toBeGreaterThan(50);
  });

  test('Doji-LongLegged has noticeably longer wicks on both sides than plain Doji', () => {
    const longLegged = getPatternDiagram('Doji-LongLegged');
    const doji = getPatternDiagram('Doji');
    const longLeggedSpan = longLegged![0].low - longLegged![0].high;
    const dojiSpan = doji![0].low - doji![0].high;
    expect(longLeggedSpan).toBeGreaterThan(dojiSpan);
  });
});

describe('Belt Hold (2026-09-26, added ahead of the Pattern Detection panel)', () => {
  test('has no wick on the opening/low side (low === bodyBottom) but a real wick on the other side, unlike Marubozu', () => {
    const shapes = getPatternDiagram('Belt Hold');
    expect(shapes).toHaveLength(1);
    expect(shapes![0].low).toBe(shapes![0].bodyBottom);
    expect(shapes![0].high).toBeLessThan(shapes![0].bodyTop);
  });
});
