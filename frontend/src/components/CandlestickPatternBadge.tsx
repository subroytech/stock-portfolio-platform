import type { CSSProperties } from 'react';
import { PATTERN_LABELS, type CandlestickPatternKey } from '../lib/candlestickPatternDetection';

// bg-green-600/bg-red-600 are Tailwind's exact matches for CandlestickPopup.tsx's own existing
// up/down candle colors (#16a34a/#dc2626) - reusing the bullish/bearish hue already used
// elsewhere in this exact chart rather than picking a different green/red shade. bg-slate-500 is
// neutral, distinct from anything CategoryBadge already uses for its own palette. bg-amber-500
// (Spinning Top) and bg-cyan-600 (Long-Legged Doji) are two more distinct neutral-leaning tones
// so the "indecision family" badges don't all read as identical gray at a glance. Marubozu's own
// entry here is just a fallback (see `variant` below) - unlike Hammer/Shooting Star, a Marubozu's
// real bullish/bearish meaning genuinely depends on that specific bar's own close-vs-open
// direction, so both its label AND color are computed by the caller (CandlestickPopup.tsx's
// PatternPanel, which already has the bar) rather than fixed. Dragonfly/Gravestone Doji DO get
// fixed colors despite being Doji sub-types - like Hammer/Shooting Star, their bullish/bearish
// lean comes from the wick shape itself (which side is negligible), not from the bar's own
// close-vs-open (which is near-arbitrary for any Doji, by definition) - but they get their OWN
// green/red shade (emerald/rose, not the exact green-600/red-600 Hammer/Shooting Star use), so a
// Doji-family badge never looks identical to a non-Doji one despite sharing the same bullish/
// bearish lean.
// Labels for the Doji family (2026-09-26 follow-up, explicit direction) all lead with "D" to
// match the "Doji-" name prefix: Doji itself is just "D", its 3 sub-types are "D" + their own
// initial (Dd/Dg/Dl) - so the label alone hints at Doji-family membership at a glance. Belt
// Hold's own entry here is just a fallback (see `variant` below) - like Marubozu, its real
// bullish/bearish meaning depends on that specific bar's own close-vs-open direction (a Belt
// Hold's defining large body necessarily makes open !== close), so both its label (B+/B-) and
// color are computed by the caller instead of fixed here.
//
// The 14 complex (multi-candle) patterns (2026-09-27, expanded from 4 to 8 to 10 to 14 the same
// day) reuse the same +/- language (E+/E-, S+/S-, P+/P-, 3+/3-, I+/I-) where the pattern is a
// direct bullish/bearish mirror pair, but DON'T need a `variant` override the way Marubozu/Belt
// Hold do - each match's bullish-or-bearish identity is fixed by which detector fired, not derived
// from the anchor bar's own direction, so it's a plain fixed entry here like Hammer/Shooting Star.
// They deliberately reuse the exact same bg-green-600/bg-red-600 pair Hammer/Shooting Star use (not
// a distinct shade like the Doji family gets) - they're not Doji-family, so the same "non-Doji
// bullish/bearish patterns share the main hue, only the label distinguishes which pattern" rule
// applies. P+/P- (Piercing Line/Dark Cloud Cover) and 3+/3- (Three White Soldiers/Three Black
// Crows) follow the same pairing convention as E+/E- and S+/S- even though each pair's two pattern
// names don't share a root word, since the curated Q&A content itself frames each pair as
// bullish/bearish mirrors of one another ("the bearish mirror of Piercing Line", "the mirror image
// of Three White Soldiers"). I+/I- (Bullish/Bearish Harami) uses "I" for Harami's common English
// name, "Inside bar" - "H" was already taken by Hammer's "Hm".
//
// Three Inside Up/Down and Three Outside Up/Down break the +/- convention (Iu/Id, Ou/Od instead)
// because each pair's own bullish/bearish identity IS its name's Up/Down suffix - reusing +/- on
// top of that would be redundant, not clarifying, the way it is for e.g. Engulfing (whose name
// carries no direction at all). "I"/"O" for Inside/Outside follow the same first-letter-of-the-
// name shorthand every other 2-char label here already uses (Hm, Ss, Mz, St); "I" here is a
// different pattern from Harami's own "I+/I-" but the two are never shown as ambiguous since the
// full pattern name is always available in the badge's tooltip.
//
// Tweezer Bottom/Top (2026-09-28) follow the same "name's own suffix already encodes direction"
// reasoning as Three Inside/Outside Up/Down - "Bottom"/"Top" already say bullish/bearish, so no
// +/- needed. "T" + the distinguishing second letter (Tb/Tt) matches Doji's own Dd/Dg/Dl shorthand.
// Same bg-green-600/bg-red-600 hue as every other non-Doji-family pair.
//
// Bullish/Bearish Kicking (2026-09-28) go back to the +/- convention (K+/K-), like Engulfing/Star/
// Piercing-DarkCloud/Soldiers-Crows/Harami above - "Kicking" itself carries no bullish/bearish
// direction the way "Bottom/Top" or "Up/Down" do, so +/- is what actually distinguishes the pair.
//
// Bullish/Bearish Abandoned Baby (2026-09-29) also use +/- (A+/A-) for the same reason - "Abandoned
// Baby" carries no inherent direction. "A" was free (not "B", already Belt Hold's fallback).
//
// Upside/Downside Tasuki Gap (2026-09-29) break the +/- convention again (Gu/Gd), like Three
// Inside/Outside Up/Down - "Upside"/"Downside" already encode the pair's own direction, so +/-
// would be redundant. "G" for "Gap" (the name's own distinguishing second word) since "T" was
// already taken by Tweezer's own Tb/Tt.
//
// Rising/Falling Three Methods (2026-10-03, the Complex/5-candle tier) also break the +/-
// convention - "Rising"/"Falling" already encode direction. "R"/"F" + "m" for "Methods" (the
// name's own distinguishing second word, same reasoning as Tasuki Gap's own "G").
const PATTERN_BADGE: Record<CandlestickPatternKey, { label: string; className: string }> = {
  doji: { label: 'D', className: 'bg-slate-500' },
  hammer: { label: 'Hm', className: 'bg-green-600' },
  shootingStar: { label: 'Ss', className: 'bg-red-600' },
  marubozu: { label: 'Mz', className: 'bg-slate-500' },
  spinningTop: { label: 'St', className: 'bg-amber-500' },
  dragonflyDoji: { label: 'Dd', className: 'bg-emerald-600' },
  gravestoneDoji: { label: 'Dg', className: 'bg-rose-600' },
  longLeggedDoji: { label: 'Dl', className: 'bg-cyan-600' },
  beltHold: { label: 'B', className: 'bg-slate-500' },
  bullishEngulfing: { label: 'E+', className: 'bg-green-600' },
  bearishEngulfing: { label: 'E-', className: 'bg-red-600' },
  morningStar: { label: 'S+', className: 'bg-green-600' },
  eveningStar: { label: 'S-', className: 'bg-red-600' },
  piercingLine: { label: 'P+', className: 'bg-green-600' },
  darkCloudCover: { label: 'P-', className: 'bg-red-600' },
  threeWhiteSoldiers: { label: '3+', className: 'bg-green-600' },
  threeBlackCrows: { label: '3-', className: 'bg-red-600' },
  bullishHarami: { label: 'I+', className: 'bg-green-600' },
  bearishHarami: { label: 'I-', className: 'bg-red-600' },
  threeInsideUp: { label: 'Iu', className: 'bg-green-600' },
  threeInsideDown: { label: 'Id', className: 'bg-red-600' },
  threeOutsideUp: { label: 'Ou', className: 'bg-green-600' },
  threeOutsideDown: { label: 'Od', className: 'bg-red-600' },
  tweezerBottom: { label: 'Tb', className: 'bg-green-600' },
  tweezerTop: { label: 'Tt', className: 'bg-red-600' },
  bullishKicking: { label: 'K+', className: 'bg-green-600' },
  bearishKicking: { label: 'K-', className: 'bg-red-600' },
  bullishAbandonedBaby: { label: 'A+', className: 'bg-green-600' },
  bearishAbandonedBaby: { label: 'A-', className: 'bg-red-600' },
  upsideTasukiGap: { label: 'Gu', className: 'bg-green-600' },
  downsideTasukiGap: { label: 'Gd', className: 'bg-red-600' },
  risingThreeMethods: { label: 'Rm', className: 'bg-green-600' },
  fallingThreeMethods: { label: 'Fm', className: 'bg-red-600' },
};

export default function CandlestickPatternBadge({ pattern, style, detail, variant, onMouseEnter, onMouseLeave }: {
  pattern: CandlestickPatternKey;
  style?: CSSProperties;
  // Optional extra detail (e.g. the matched bar's OHLC) appended to the tooltip - keeps this
  // component ignorant of where that detail comes from, same as its plain `pattern`/`style` props.
  detail?: string;
  // Overrides PATTERN_BADGE's own fixed {label, className} pair - used for patterns (currently
  // just Marubozu) whose label/color genuinely depend on that specific bar's own direction, not
  // just its pattern type. Bundled as one pair (not two independent overrides) so a caller can't
  // accidentally mismatch a green color with a "-" label or vice versa. Left undefined for every
  // pattern whose label+color are always the same regardless of the bar.
  variant?: { label: string; className: string };
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const { label, className } = variant ?? PATTERN_BADGE[pattern];
  const title = detail ? `${PATTERN_LABELS[pattern]} — ${detail}` : PATTERN_LABELS[pattern];
  return (
    <span
      title={title}
      data-testid="pattern-badge"
      data-pattern={pattern}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`absolute flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${className}`}
    >
      {label}
    </span>
  );
}
