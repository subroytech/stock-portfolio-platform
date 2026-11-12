import { getPatternDiagram, DIRECTION_COLORS } from '../lib/candlestickPatternDiagrams';

interface CandlestickPatternDiagramProps {
  patternName: string;
}

const CELL_WIDTH = 40;
// Tightened 16 -> 8 (2026-09-21, explicit direction) - a 2-3 candle pattern's bodies were
// reading as spaced too far apart from each other.
const CELL_GAP = 8;
const BODY_WIDTH = 22;

// Renders a candlestick pattern's shape as plain SVG, drawn from a small hand-authored geometry
// description (candlestickPatternDiagrams.ts) rather than any stored/uploaded image - see that
// file's own comment for why. Renders nothing (not an error state) when the given pattern name
// has no geometry defined - fails open, matching this app's established "graceful degradation"
// precedent elsewhere (e.g. Long-Term Analysis's Forward P/E showing null rather than crashing
// when FMP's own data is unavailable).
//
// Sizing (redesigned 2026-09-26, real bug found live): an earlier pass used
// preserveAspectRatio="none" plus a fixed CSS height to stop single-candle diagrams (Doji/Hammer/
// Shooting Star) from rendering too tall - but that STRETCHES the x and y axes by two completely
// different factors whenever the box it's forced to fill doesn't match the viewBox's own aspect
// ratio, which is worst for exactly the narrowest (1-candle) diagrams - the reported symptom
// ("looks nothing like a candlestick") was real distortion, not a styling nitpick.
//
// Fixed properly instead: the viewBox is computed to TIGHTLY bound each pattern's own actual
// candle geometry (its real high/low span, not a shared 0-100 domain most patterns don't fill),
// so there's never wasted internal whitespace regardless of how tall or short a given pattern's
// wicks are. The rendered size is then capped by max-height with width left auto - the browser
// scales the correctly-proportioned shape uniformly (default preserveAspectRatio, never
// distorted) up to that cap, however wide that naturally makes it. Callers give this a
// wide-enough box to center in (see CandlestickQuestionAnswerPage.tsx's justify-center wrapper);
// it deliberately no longer stretches to fill that box's exact width, since doing so at all is
// what caused the distortion in the first place - a correctly-shaped candlestick and "exactly
// 25% of an arbitrary row's width" cannot both be guaranteed at once for a fixed aspect ratio.
export default function CandlestickPatternDiagram({ patternName }: CandlestickPatternDiagramProps) {
  const candles = getPatternDiagram(patternName);
  if (!candles) return null;

  const width = candles.length * CELL_WIDTH + (candles.length - 1) * CELL_GAP;
  const minY = Math.min(...candles.map((c) => c.high));
  const maxY = Math.max(...candles.map((c) => c.low));
  const margin = (maxY - minY) * 0.15 || 5; // guards a degenerate all-flat span
  const viewBoxY = minY - margin;
  const viewBoxHeight = (maxY - minY) + margin * 2;

  return (
    <svg
      viewBox={`0 ${viewBoxY} ${width} ${viewBoxHeight}`}
      className="max-h-20 w-auto"
      role="img"
      aria-label={`${patternName} candlestick pattern diagram`}
      data-testid="candlestick-pattern-diagram"
    >
      {candles.map((c, i) => {
        const cx = i * (CELL_WIDTH + CELL_GAP) + CELL_WIDTH / 2;
        const color = DIRECTION_COLORS[c.direction];
        return (
          <g key={i}>
            <line x1={cx} y1={c.high} x2={cx} y2={c.low} stroke={color} strokeWidth={2} />
            <rect
              x={cx - BODY_WIDTH / 2}
              y={c.bodyTop}
              width={BODY_WIDTH}
              height={Math.max(c.bodyBottom - c.bodyTop, 2)}
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}
