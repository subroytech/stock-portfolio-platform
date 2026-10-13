import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import CandlestickPatternBadge from './CandlestickPatternBadge';

describe('CandlestickPatternBadge', () => {
  test('renders the right 2-char label, full-name tooltip, and data-pattern for each pattern', () => {
    const cases: { pattern: Parameters<typeof CandlestickPatternBadge>[0]['pattern']; label: string; fullName: string }[] = [
      { pattern: 'doji', label: 'D', fullName: 'Doji' },
      { pattern: 'hammer', label: 'Hm', fullName: 'Hammer' },
      { pattern: 'shootingStar', label: 'Ss', fullName: 'Shooting Star' },
      { pattern: 'marubozu', label: 'Mz', fullName: 'Marubozu' },
      { pattern: 'spinningTop', label: 'St', fullName: 'Spinning Top' },
      { pattern: 'dragonflyDoji', label: 'Dd', fullName: 'Doji-Dragonfly' },
      { pattern: 'gravestoneDoji', label: 'Dg', fullName: 'Doji-Gravestone' },
      { pattern: 'longLeggedDoji', label: 'Dl', fullName: 'Doji-LongLegged' },
      { pattern: 'beltHold', label: 'B', fullName: 'Belt Hold' },
      { pattern: 'bullishEngulfing', label: 'E+', fullName: 'Bullish Engulfing' },
      { pattern: 'bearishEngulfing', label: 'E-', fullName: 'Bearish Engulfing' },
      { pattern: 'morningStar', label: 'S+', fullName: 'Morning Star' },
      { pattern: 'eveningStar', label: 'S-', fullName: 'Evening Star' },
      { pattern: 'piercingLine', label: 'P+', fullName: 'Piercing Line' },
      { pattern: 'darkCloudCover', label: 'P-', fullName: 'Dark Cloud Cover' },
      { pattern: 'threeWhiteSoldiers', label: '3+', fullName: 'Three White Soldiers' },
      { pattern: 'threeBlackCrows', label: '3-', fullName: 'Three Black Crows' },
      { pattern: 'bullishHarami', label: 'I+', fullName: 'Bullish Harami' },
      { pattern: 'bearishHarami', label: 'I-', fullName: 'Bearish Harami' },
      { pattern: 'threeInsideUp', label: 'Iu', fullName: 'Three Inside Up' },
      { pattern: 'threeInsideDown', label: 'Id', fullName: 'Three Inside Down' },
      { pattern: 'threeOutsideUp', label: 'Ou', fullName: 'Three Outside Up' },
      { pattern: 'threeOutsideDown', label: 'Od', fullName: 'Three Outside Down' },
      { pattern: 'tweezerBottom', label: 'Tb', fullName: 'Tweezer Bottom' },
      { pattern: 'tweezerTop', label: 'Tt', fullName: 'Tweezer Top' },
      { pattern: 'bullishKicking', label: 'K+', fullName: 'Bullish Kicking' },
      { pattern: 'bearishKicking', label: 'K-', fullName: 'Bearish Kicking' },
      { pattern: 'bullishAbandonedBaby', label: 'A+', fullName: 'Bullish Abandoned Baby' },
      { pattern: 'bearishAbandonedBaby', label: 'A-', fullName: 'Bearish Abandoned Baby' },
      { pattern: 'upsideTasukiGap', label: 'Gu', fullName: 'Upside Tasuki Gap' },
      { pattern: 'downsideTasukiGap', label: 'Gd', fullName: 'Downside Tasuki Gap' },
      { pattern: 'risingThreeMethods', label: 'Rm', fullName: 'Rising Three Methods' },
      { pattern: 'fallingThreeMethods', label: 'Fm', fullName: 'Falling Three Methods' },
    ];

    for (const { pattern, label, fullName } of cases) {
      const { unmount } = render(<CandlestickPatternBadge pattern={pattern} />);
      const badge = screen.getByTestId('pattern-badge');
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute('title', fullName);
      expect(badge).toHaveAttribute('data-pattern', pattern);
      unmount();
    }
  });

  test('each pattern with a fixed, unique color gets a visually distinct one', () => {
    // Marubozu and Belt Hold are deliberately excluded here - neither has a fixed default
    // label/color of its own (both share Doji's neutral fallback), since their real label+color
    // always come from the caller's `variant` override instead. See the dedicated variant tests
    // below. The 24 complex patterns (bullishEngulfing/morningStar/piercingLine/
    // threeWhiteSoldiers/bullishHarami/threeInsideUp/threeOutsideUp/tweezerBottom/bullishKicking/
    // bullishAbandonedBaby/upsideTasukiGap/risingThreeMethods and bearishEngulfing/eveningStar/
    // darkCloudCover/threeBlackCrows/bearishHarami/threeInsideDown/threeOutsideDown/tweezerTop/
    // bearishKicking/bearishAbandonedBaby/downsideTasukiGap/fallingThreeMethods) are also excluded
    // - they deliberately REUSE hammer's/shootingStar's exact green-600/red-600 (see the dedicated
    // color-reuse test below), so they'd fail a "distinct" check by design, not by bug.
    const patterns: Parameters<typeof CandlestickPatternBadge>[0]['pattern'][] = [
      'doji', 'hammer', 'shootingStar', 'spinningTop', 'dragonflyDoji', 'gravestoneDoji', 'longLeggedDoji',
    ];
    const classNames = new Set<string>();
    for (const pattern of patterns) {
      const { container, unmount } = render(<CandlestickPatternBadge pattern={pattern} />);
      classNames.add(container.querySelector('[data-testid="pattern-badge"]')!.className);
      unmount();
    }
    expect(classNames.size).toBe(patterns.length);
  });

  test('the 24 complex patterns deliberately reuse Hammer\'s/Shooting Star\'s exact bullish/bearish color, not a distinct shade', () => {
    // Unlike the Doji family (which gets its own emerald/rose/cyan shades to stay visually
    // distinct from the "main" bullish/bearish hue), none of the complex patterns are Doji-family,
    // so they all follow the same "share the main hue, let the label distinguish the pattern" rule
    // Hammer/Shooting Star themselves established.
    function bgClass(pattern: Parameters<typeof CandlestickPatternBadge>[0]['pattern']): string | undefined {
      const { container, unmount } = render(<CandlestickPatternBadge pattern={pattern} />);
      const bg = container.querySelector('[data-testid="pattern-badge"]')!.className.match(/bg-\S+/)?.[0];
      unmount();
      return bg;
    }

    const hammerBg = bgClass('hammer');
    const shootingStarBg = bgClass('shootingStar');
    for (const bullish of ['bullishEngulfing', 'morningStar', 'piercingLine', 'threeWhiteSoldiers', 'bullishHarami', 'threeInsideUp', 'threeOutsideUp', 'tweezerBottom', 'bullishKicking', 'bullishAbandonedBaby', 'upsideTasukiGap', 'risingThreeMethods'] as const) {
      expect(bgClass(bullish)).toBe(hammerBg);
    }
    for (const bearish of ['bearishEngulfing', 'eveningStar', 'darkCloudCover', 'threeBlackCrows', 'bearishHarami', 'threeInsideDown', 'threeOutsideDown', 'tweezerTop', 'bearishKicking', 'bearishAbandonedBaby', 'downsideTasukiGap', 'fallingThreeMethods'] as const) {
      expect(bgClass(bearish)).toBe(shootingStarBg);
    }
  });

  test('variant overrides both the label and color together (used for Marubozu\'s M+/M- direction-based badges)', () => {
    const { unmount, rerender } = render(<CandlestickPatternBadge pattern="marubozu" variant={{ label: 'M+', className: 'bg-green-600' }} />);
    let badge = screen.getByTestId('pattern-badge');
    expect(badge).toHaveTextContent('M+');
    expect(badge.className).toContain('bg-green-600');
    expect(badge.className).not.toContain('bg-slate-500');

    rerender(<CandlestickPatternBadge pattern="marubozu" variant={{ label: 'M-', className: 'bg-red-600' }} />);
    badge = screen.getByTestId('pattern-badge');
    expect(badge).toHaveTextContent('M-');
    expect(badge.className).toContain('bg-red-600');
    unmount();
  });

  test('variant overrides both the label and color together (used for Belt Hold\'s B+/B- direction-based badges)', () => {
    const { unmount, rerender } = render(<CandlestickPatternBadge pattern="beltHold" variant={{ label: 'B+', className: 'bg-green-600' }} />);
    let badge = screen.getByTestId('pattern-badge');
    expect(badge).toHaveTextContent('B+');
    expect(badge.className).toContain('bg-green-600');

    rerender(<CandlestickPatternBadge pattern="beltHold" variant={{ label: 'B-', className: 'bg-red-600' }} />);
    badge = screen.getByTestId('pattern-badge');
    expect(badge).toHaveTextContent('B-');
    expect(badge.className).toContain('bg-red-600');
    unmount();
  });

  test('forwards the style prop for positioning', () => {
    const { unmount } = render(<CandlestickPatternBadge pattern="doji" style={{ left: '42px' }} />);
    expect(screen.getByTestId('pattern-badge')).toHaveStyle({ left: '42px' });
    unmount();
  });

  test('appends the optional detail string to the tooltip, after the full pattern name', () => {
    const { unmount } = render(<CandlestickPatternBadge pattern="hammer" detail="O $10.00 · H $13.00 · L $6.00 · C $12.00" />);
    expect(screen.getByTestId('pattern-badge')).toHaveAttribute('title', 'Hammer — O $10.00 · H $13.00 · L $6.00 · C $12.00');
    unmount();
  });

  test('without a detail string, the tooltip is just the plain pattern name', () => {
    const { unmount } = render(<CandlestickPatternBadge pattern="hammer" />);
    expect(screen.getByTestId('pattern-badge')).toHaveAttribute('title', 'Hammer');
    unmount();
  });

  test('forwards onMouseEnter/onMouseLeave', async () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const { unmount } = render(<CandlestickPatternBadge pattern="doji" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />);
    const badge = screen.getByTestId('pattern-badge');

    await userEvent.hover(badge);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);

    await userEvent.unhover(badge);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    unmount();
  });
});
