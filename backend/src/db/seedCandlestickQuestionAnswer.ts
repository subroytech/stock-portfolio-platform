// Candlestick Pattern Q&A (Phase 1) - initial curated seed content, drafted for review before
// going live (per the plan's own "Claude drafts an initial ~8-12 entry set" decision). Idempotent
// via ON CONFLICT-free upsert-by-name logic below - safe to re-run after this file changes.
//
// Run via `npm run seed:candlestick-question-answer`. Every entry lands directly at 'Approved'
// (this is admin/seed-authored curated content, the trusted-content path from day one) - see
// migration 047's own comment for why Phase 1 never writes 'Pending Approval' rows.
//
// 2026-09-26: migration 048 moved horizon-relevance from each entry onto its pattern (3 boolean
// columns) and added a Category axis to entries - this file's shape follows suit, matching
// candlestickQuestionAnswer.service.ts's own Horizon/Category types exactly.

import { pool } from './pool';
import type { Horizon, Tier, Category, ComplexityTier } from '../services/candlestickQuestionAnswer.service';

interface SeedPattern {
  patternName: string;
  formationDescription: string;
  relevantHorizons: Horizon[];
  // How many candles the pattern takes to identify (migration 050): Simple = 1, Complex = 2,
  // Advanced = 3. Kept here so a re-run of this seed never silently reverts migration 051's
  // backfill - the upsert below writes this column on every run.
  complexityTier: ComplexityTier;
  entries: { category: Category; tier: Tier; questionText: string; answerText: string }[];
}

const SEED_PATTERNS: SeedPattern[] = [
  {
    patternName: 'Doji',
    formationDescription: "A candle whose open and close prices are virtually equal, producing a very small or nonexistent body with wicks on either side - a visual signal of indecision between buyers and sellers.",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Doji candle and what does it mean for day trading?',
        answerText: "A Doji forms when a candle's open and close prices are virtually equal, producing a very small or nonexistent body with wicks on either side. For day trading, a Doji signals indecision - buyers and sellers reached a stalemate during that candle's timeframe. On its own it isn't a buy or sell signal; day traders typically wait for the next candle to confirm direction, and treat a Doji near a known intraday support/resistance level or VWAP as more significant than one appearing mid-range.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Doji actually tell you about buyers versus sellers?',
        answerText: "A Doji shows that buyers and sellers were evenly matched over that candle's session - price may have moved substantially within the session, but by the close it ended almost exactly where it opened. On its own it doesn't say which side will win next; it only flags that whichever side was in control before the Doji may be losing conviction. The candles immediately before and after a Doji matter more for interpretation than the Doji itself.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Doji as a reversal signal in swing trading?',
        answerText: 'A Doji is a warning sign of a potential reversal, not a confirmed one - its reliability depends heavily on context. A Doji appearing after a strong, extended multi-day trend (especially with declining volume into it) carries more weight than one appearing in a sideways, range-bound market. Swing traders generally wait for the following 1-2 candles to close in the opposite direction before treating a Doji as an actual trend change, since trading it in isolation produces many false signals.',
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How should a Doji be used alongside other signals?',
        answerText: "A Doji is rarely traded on its own - it's most useful as a trigger to pay closer attention rather than to act immediately. Common uses include tightening a stop on an existing position, waiting for the next candle's direction before entering a new one, or treating a Doji at a known support/resistance level or moving average as a more meaningful pause than one appearing in open space. Because a Doji only signals indecision, not direction, it works best combined with a directional confirmation from surrounding price action.",
      },
    ],
  },
  {
    patternName: 'Hammer',
    formationDescription: 'A candle with a small body near the top of its range, a long lower wick (at least twice the body length), and little to no upper wick - appearing after a decline, it suggests a possible bullish reversal.',
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What does a Hammer candlestick pattern look like and signal?',
        answerText: "A Hammer has a small body near the top of its range with a long lower wick (at least twice the body's length) and little to no upper wick - it looks like a hammer. It forms after a decline and signals that sellers pushed price down during the session, but buyers stepped in and drove it back up before the close. For day trading, a Hammer at an intraday low or near a Pivot Point support level suggests a possible short-term bounce, but should be confirmed by the next candle closing higher.",
      },
      {
        category: 'Interpretation', tier: 201,
        questionText: 'Does a Hammer need to appear after a downtrend to be valid for swing trading?',
        answerText: "Yes - a Hammer's bullish-reversal meaning specifically depends on it appearing after a clear downtrend. The identical candle shape appearing during an uptrend or sideways market has no particular reversal implication on its own, or can be confused with a Hanging Man (the same shape, but a bearish reversal signal when it appears at the TOP of an uptrend instead). For swing trading, always check the preceding several candles' trend direction before treating a Hammer-shaped candle as a bullish reversal signal.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Hammer as a bullish reversal signal?',
        answerText: "A bare Hammer has a meaningfully high false-signal rate on its own - the same shape can appear without leading to any real reversal. Reliability improves substantially with confirmation (the next candle closing above the Hammer's high), the pattern forming near an established support level or a round number, and above-average volume on the Hammer candle itself, which shows the rejection of lower prices was backed by real participation rather than thin trading.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically act on a Hammer pattern?',
        answerText: "Many traders wait for the next candle to close above the Hammer's high before entering a long position, using the Hammer's own low as a natural stop-loss level - a break below it would invalidate the reversal thesis. A more aggressive approach enters on the Hammer's own close, accepting more risk for an earlier entry. Either way, the Hammer is usually treated as a starting point for a trade idea rather than a standalone signal to act on immediately.",
      },
    ],
  },
  {
    patternName: 'Bullish Engulfing',
    formationDescription: "A two-candle pattern: a smaller bearish candle followed by a larger bullish candle whose body completely covers the prior candle's body - signaling buyers have decisively overpowered sellers.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bullish Engulfing pattern?',
        answerText: "A Bullish Engulfing pattern is a two-candle formation: a smaller bearish (red/down) candle followed by a larger bullish (green/up) candle whose body completely 'engulfs' the prior candle's body - its open is below the prior candle's close, and its close is above the prior candle's open. It signals that buyers have decisively overpowered sellers within a single session, often marking a short-term trend reversal after a decline.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bullish Engulfing pattern say about the shift in control?',
        answerText: "A Bullish Engulfing pattern shows a decisive, single-session shift in control from sellers to buyers - not just a pause, but buyers actually erasing the entire prior candle's decline and then some. The larger the second candle relative to the first, the more forceful that shift is read to be; a marginal engulf (barely covering the prior body) carries less conviction than one where the second candle is dramatically larger.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Bullish Engulfing pattern more or less reliable?',
        answerText: "A Bullish Engulfing pattern is more reliable when it forms after an extended decline rather than a brief dip, when the engulfing candle's body is meaningfully larger than the one it covers (not just barely engulfing it), and when it's accompanied by higher-than-average volume. One that forms in a sideways, range-bound market carries much less weight than one appearing at the end of a clear, sustained downtrend.",
      },
      {
        category: 'How to Use', tier: 301,
        questionText: 'Is a Bullish Engulfing pattern meaningful for long-term investing decisions?',
        answerText: "On its own, a single Bullish Engulfing pattern on a daily chart carries limited weight for a long-term position - it's a short-term momentum signal, not evidence of a change in the underlying business or valuation. For long-term investors, this pattern is most useful as a secondary confirmation alongside fundamentals-based research (e.g. an already-attractive valuation) rather than a standalone reason to buy. A Bullish Engulfing on a weekly or monthly chart, after a multi-month decline, is a more meaningful long-term signal than the same pattern on a daily chart.",
      },
    ],
  },
  {
    patternName: 'Bearish Engulfing',
    formationDescription: "The mirror image of Bullish Engulfing: a smaller bullish candle followed by a larger bearish candle whose body completely covers the prior candle's body - signaling sellers have taken control.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bearish Engulfing candle pattern?',
        answerText: "A Bearish Engulfing pattern is the mirror image of Bullish Engulfing: a smaller bullish candle followed by a larger bearish candle whose body completely covers the prior candle's body. For day trading, it suggests sellers have taken control within that session, and often appears near an intraday high or resistance level as a signal that an upward move may be running out of steam. As with any single-candle-pair signal, day traders typically want volume confirmation (a Volume MA spike on the engulfing candle) before acting on it.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bearish Engulfing pattern say about the shift in control?',
        answerText: "A Bearish Engulfing pattern shows sellers decisively overpowering buyers within a single session - the second candle doesn't just close lower, its entire body swallows the prior candle's gains. The larger the engulfing candle relative to the one it covers, the stronger the signal is read to be.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Bearish Engulfing pattern more reliable?',
        answerText: "A Bearish Engulfing pattern is more reliable when it forms after an extended rally rather than a brief pop, when the second candle's body is meaningfully larger than the first (not a marginal engulf), and when volume increases on the engulfing candle. One appearing in a choppy, sideways market carries much less weight than one at the end of a clear uptrend.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Bearish Engulfing pattern typically used?',
        answerText: "A Bearish Engulfing pattern is often used as a trigger to exit long positions or initiate a short once the second candle closes, with a stop sometimes placed above the pattern's high. Because it's one of the more decisive two-candle reversal signals, it's frequently traded with less need for additional confirmation than weaker patterns like a Harami - though checking for a genuine prior uptrend and real volume still matters.",
      },
    ],
  },
  {
    patternName: 'Morning Star',
    formationDescription: 'A three-candle bullish reversal pattern: a long bearish candle, a small-bodied candle that gaps down, then a long bullish candle closing well into the first candle\'s body.',
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        // Tier corrected 101 (was 201) - this is the pattern's Definition entry, and every other
        // pattern's Definition lives at 101; this one was a leftover from before the Category
        // system existed and had never been reconciled.
        category: 'Definition', tier: 101,
        questionText: 'What is a Morning Star pattern and how many candles does it need?',
        answerText: "A Morning Star is a three-candle bullish reversal pattern: a long bearish candle, followed by a small-bodied candle (a Doji or spinning top) that gaps down, followed by a long bullish candle that closes well into the first candle's body. It signals a transition from selling pressure to buying pressure over three sessions rather than one. For swing trading, it's considered a stronger, more reliable reversal signal than a single-candle pattern like a Hammer, precisely because it requires three sessions of the market actually turning.",
      },
      {
        category: 'Interpretation', tier: 301,
        questionText: 'How should a long-term investor interpret a Morning Star pattern on a weekly/monthly chart?',
        answerText: "A Morning Star forming on a weekly or monthly chart, after a sustained multi-month or multi-year decline, is one of the more meaningful technical reversal signals a long-term investor can use - it reflects a genuine multi-week shift in buying/selling pressure, not next-session noise. Even so, it should be treated as a timing/confirmation tool alongside fundamental analysis (e.g. checking whether the business's underlying financial health has actually stabilized), not a substitute for it - a technical reversal pattern can't tell you whether a company's fundamentals justify the price.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Morning Star more or less reliable?',
        answerText: "A Morning Star is more reliable when the third candle closes deep into the first candle's body rather than just barely, when the middle candle's gap-down is clear rather than marginal, and when the pattern forms after a well-established downtrend rather than a brief dip. Volume increasing on the third (bullish) candle is also read as a sign of genuine conviction behind the reversal.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically act on a Morning Star pattern?',
        answerText: "Because it takes three sessions to confirm, a Morning Star is often used as a basis for entering a long position once the third candle closes, without necessarily waiting for further confirmation the way a trader might with a single-candle pattern. A stop is commonly placed below the pattern's low (the middle candle's low), since a break below that level would undermine the reversal thesis.",
      },
    ],
  },
  {
    patternName: 'Shooting Star',
    formationDescription: 'A candle with a small body near the bottom of its range, a long upper wick (at least twice the body length), and little to no lower wick - appearing after a rally, it suggests upward momentum may be stalling.',
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What does a Shooting Star candlestick indicate intraday?',
        answerText: "A Shooting Star has a small body near the bottom of its range with a long upper wick (at least twice the body's length) and little to no lower wick. It forms after a rally and signals that buyers pushed price up during the session, but sellers took back control before the close. For day trading, a Shooting Star at an intraday high or resistance level suggests upward momentum may be stalling, though - like a Hammer - it should be confirmed by the next candle closing lower before acting on it.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Shooting Star suggest about a preceding rally?',
        answerText: "A Shooting Star suggests a rally may be running out of steam - the long upper wick shows buyers pushed price to a new high during the session, but sellers took back control and pushed it back down to close near the open. It's read as an early warning of exhaustion among buyers, though unlike a Hammer/Hanging Man pair, a Shooting Star's own shape is unambiguous about which direction it warns of regardless of the preceding trend.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Shooting Star as a bearish reversal signal?',
        answerText: "A bare Shooting Star has a real false-signal rate on its own. Reliability improves with a next-candle close below the Shooting Star's low (confirmation), the pattern forming near a known resistance level, and above-average volume on the Shooting Star candle itself, showing the rejection of higher prices was backed by real participation rather than thin trading.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Shooting Star pattern?',
        answerText: "Many traders wait for the next candle to close below the Shooting Star's low before initiating a short position or exiting a long, using the Shooting Star's own high as a natural stop-loss level. As with a Hammer, some traders accept more risk for an earlier entry by acting on the Shooting Star's own close rather than waiting for confirmation.",
      },
    ],
  },
  {
    patternName: 'Three White Soldiers',
    formationDescription: 'A bullish pattern of three consecutive long bullish candles, each opening within the prior candle\'s body and closing near its own high - suggesting steady, sustained buying pressure.',
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        // Tier corrected 101 (was 201) - same leftover-from-before-Category reason as Morning
        // Star's own Definition entry above.
        category: 'Definition', tier: 101,
        questionText: 'What is the Three White Soldiers pattern and what does it suggest?',
        answerText: "Three White Soldiers is a bullish continuation/reversal pattern of three consecutive long bullish candles, each opening within the prior candle's body and closing at or near its own high, with relatively small wicks. It suggests steady, sustained buying pressure across three full sessions rather than a single sharp spike. For swing trading, it's generally read as a stronger signal of a genuine trend shift than a single bullish candle, though a very rapid, sharply-angled version of the pattern can also indicate an overextended move at risk of a pullback.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does Three White Soldiers suggest about the strength of a rally?',
        answerText: "Three White Soldiers suggests buying pressure is broad and sustained rather than a single burst - each candle closing near its own high, with the next candle opening within the prior body rather than gapping wildly, shows orderly, persistent accumulation rather than a chaotic single-day spike. It's generally read as a stronger bullish continuation or reversal signal than any single bullish candle.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is Three White Soldiers compared to a single bullish candle?',
        answerText: "Because it requires three consecutive sessions of consistent buying, Three White Soldiers is generally considered more reliable than a single-candle bullish pattern. That said, a very rapid, sharply-angled version of the pattern - each candle opening well above, not within, the prior body - can indicate an overextended move at higher risk of a pullback, rather than a stable, sustainable uptrend.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use the Three White Soldiers pattern?',
        answerText: "Three White Soldiers is often used as confirmation to enter or add to long positions, since the pattern's three-session formation gives more confidence than a single candle that the buying is genuine and sustained. Some traders watch for the pattern to form near a known resistance level, since a decisive break through resistance on strong, orderly buying is read as a more meaningful breakout than one on a single large candle.",
      },
    ],
  },
  // 2026-09-26 - 7 new patterns rounding out the catalog to 14, each covering all 5 categories
  // across tier 101 (Definition/Interpretation) and 201 (Reliability/How to Use/Common Mistakes)
  // per the fixed sequence agreed this session. Content is horizon-neutral (an entry can now
  // surface for any of its pattern's relevantHorizons, not just one) rather than framed for a
  // single trading style the way the original 11 entries were.
  {
    patternName: 'Hanging Man',
    formationDescription: "The exact same shape as a Hammer - a small body near the top of its range, a long lower wick (at least twice the body length), and little to no upper wick - but appearing after a rally rather than a decline, making it a bearish reversal signal instead of a bullish one.",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Hanging Man candlestick pattern?',
        answerText: "A Hanging Man has a small body near the top of its range, a long lower wick (at least twice the body's length), and little to no upper wick - the exact same shape as a Hammer. What distinguishes it is where it appears: a Hanging Man forms after an uptrend, signaling that sellers pushed price down significantly during the session even though buyers ultimately regained enough control to close near the open.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Hanging Man suggest is happening in the market?',
        answerText: "A Hanging Man suggests the uptrend that produced it may be losing steam - the long lower wick shows sellers were able to push price meaningfully lower during the session, even though buyers recovered by the close. It's read as an early warning of exhaustion among buyers, not a confirmed reversal on its own; many traders wait for the next candle to close below the Hanging Man's body before treating the top as real.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Hanging Man as a bearish reversal signal?',
        answerText: "On its own, a Hanging Man is one of the weaker reversal signals - the exact same candle shape can appear during an uptrend with no reversal implication if it isn't confirmed. Reliability improves meaningfully with a next-candle close below the Hanging Man's body, the pattern appearing near a known resistance level, and above-average volume on the Hanging Man candle itself. Without confirmation, treating a bare Hanging Man as a sell signal produces frequent false positives.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Hanging Man typically used in a trading approach?',
        answerText: 'Most traders treat a Hanging Man as a trigger to tighten risk management rather than an immediate sell signal - for example, moving a stop-loss closer on an existing long position, or pausing before adding to one. A more aggressive approach waits for a bearish close on the next candle before initiating a new short or exiting a long. Because the pattern only flags increased downside risk rather than a certain reversal, it works best combined with other context (trend strength, resistance, volume) rather than acted on alone.',
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake traders make with the Hanging Man pattern?",
        answerText: "The most common mistake is confusing a Hanging Man with a Hammer - they're the identical candle shape, and mixing them up means reading a bearish warning as a bullish one or vice versa. The only way to tell them apart is the preceding trend: a Hammer follows a decline, a Hanging Man follows a rally. A second common mistake is acting on the Hanging Man itself without waiting for confirmation, since the bare pattern has a meaningfully high false-signal rate.",
      },
    ],
  },
  {
    patternName: 'Evening Star',
    formationDescription: "The bearish mirror of Morning Star: a long bullish candle, a small-bodied candle that gaps up, then a long bearish candle closing well into the first candle's body.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is an Evening Star pattern?',
        answerText: "An Evening Star is a three-candle bearish reversal pattern: a long bullish candle, followed by a small-bodied candle (a Doji or spinning top) that gaps up, followed by a long bearish candle that closes well into the first candle's body. It's the mirror image of a Morning Star, and signals a transition from buying pressure to selling pressure over three sessions rather than a single candle.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does an Evening Star suggest about a preceding uptrend?',
        answerText: "An Evening Star suggests buying momentum has genuinely stalled and reversed, not just paused for one session - the middle candle's gap-up shows a final burst of buying enthusiasm, and the third candle's deep close into the first candle's body shows sellers decisively took over. Because it takes three full sessions to form, it's read as a more deliberate, higher-conviction reversal signal than a single-candle pattern like a Shooting Star.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is an Evening Star compared to a single-candle reversal pattern?',
        answerText: "An Evening Star is generally considered more reliable than a single-candle pattern precisely because it requires three consecutive sessions of the market actually turning, not just one candle's wick. Reliability increases further when the pattern forms after an extended, well-established uptrend, the third candle closes below the midpoint of the first candle's body, and volume increases on the third (bearish) candle. A shallow Evening Star where the third candle barely dips into the first candle's body is a materially weaker version of the pattern.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically act on an Evening Star pattern?',
        answerText: "Because it's a stronger, slower-forming signal, an Evening Star is often used as a basis for exiting long positions or initiating new short positions once the third candle closes, rather than waiting for further confirmation the way a trader might with a single-candle pattern. Some traders place a stop just above the pattern's high (the middle candle's gap-up high), since a breach of that level would invalidate the reversal thesis.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake when identifying an Evening Star?",
        answerText: "A common mistake is treating any three-candle sequence with a small middle candle as an Evening Star, without checking that the middle candle actually gaps up from the first candle's close and that the third candle closes well into - not just barely touching - the first candle's body. A shallow, low-conviction version of the shape is sometimes mistaken for a full Evening Star, leading traders to expect a stronger reversal than the pattern actually supports.",
      },
    ],
  },
  {
    patternName: 'Bullish Harami',
    formationDescription: "A two-candle pattern where a large bearish candle is followed by a smaller bullish candle whose entire body sits within the first candle's body - like a smaller candle contained inside the larger one (\"Harami\" is Japanese for \"pregnant\").",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bullish Harami pattern?',
        answerText: "A Bullish Harami is a two-candle pattern where a large bearish candle is followed by a smaller bullish candle whose entire body sits within the first candle's body - like a smaller candle contained inside the larger one (\"Harami\" is Japanese for \"pregnant\"). It signals that the strong selling pressure behind the first candle has abruptly narrowed into indecision.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bullish Harami suggest is happening after a decline?',
        answerText: "A Bullish Harami suggests selling momentum has suddenly stalled - after a large down candle, the market opens and closes within a much narrower range, showing sellers could no longer push price to new lows with the same conviction. It's a signal of indecision and a potential pause in the downtrend, not necessarily a confirmed reversal.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'Is a Bullish Harami as reliable as a Bullish Engulfing pattern?',
        answerText: "A Bullish Harami is generally considered a weaker signal than a Bullish Engulfing pattern - engulfing patterns show buyers decisively overpowering the prior candle's range, while a Harami only shows a narrowing/pause, not an actual takeover. Reliability improves when the second candle's body is very small relative to the first, and when the pattern appears after an extended decline rather than a brief pullback. A next-candle close above the Harami's high adds meaningful confirmation.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Bullish Harami typically used?',
        answerText: "Because it signals only a pause rather than a confirmed reversal, a Bullish Harami is more often used as an early alert to watch a position closely - reducing an existing short, or setting an alert just above the pattern's high - rather than a standalone entry signal. Traders looking for a more decisive setup typically wait for a stronger bullish candle to follow before acting.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Bullish Harami pattern?",
        answerText: "A common mistake is treating a Bullish Harami with the same weight as a Bullish Engulfing pattern - both are two-candle reversal setups, but a Harami's second candle is contained within the first, showing only a narrowing of range, not a takeover. Trading a Harami as aggressively as an Engulfing pattern tends to produce more false starts, since the underlying signal is genuinely weaker.",
      },
    ],
  },
  {
    patternName: 'Bearish Harami',
    formationDescription: "The mirror image of Bullish Harami: a large bullish candle followed by a smaller bearish candle whose entire body is contained within the first candle's body.",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bearish Harami pattern?',
        answerText: "A Bearish Harami is the mirror image of a Bullish Harami: a large bullish candle followed by a smaller bearish candle whose entire body is contained within the first candle's body. It signals that the strong buying pressure behind the first candle has abruptly narrowed into indecision, appearing after a rally.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bearish Harami suggest after an uptrend?',
        answerText: "A Bearish Harami suggests buying momentum has suddenly stalled - after a large up candle, the market trades within a much narrower range on the next candle, showing buyers could no longer push price to new highs with the same conviction. Like its bullish counterpart, it signals indecision and a potential pause rather than a confirmed reversal on its own.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Bearish Harami on its own?',
        answerText: "A Bearish Harami is a comparatively weak signal in isolation - it shows a narrowing of range, not sellers actually taking control the way a Bearish Engulfing pattern would. It becomes more reliable when the second candle's body is very small relative to the first, when it forms after an extended rally rather than a brief pop, and when the next candle closes below the Harami's low.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How should a Bearish Harami be used in a trading approach?',
        answerText: "Similar to its bullish counterpart, a Bearish Harami is most often used as an early warning rather than a standalone sell signal - tightening a stop on an existing long, or watching for a confirming bearish close on the following candle before acting more decisively. It's rarely traded aggressively in isolation given how much weaker it is than an Engulfing-style reversal.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: 'What mistake do traders commonly make with Bearish Harami patterns?',
        answerText: "The most common mistake is over-weighting the signal - since a Harami only shows the market narrowing into indecision, not sellers actually seizing control, treating it as equivalent to a Bearish Engulfing pattern or a confirmed top tends to produce premature short entries that get stopped out on continued strength.",
      },
    ],
  },
  {
    patternName: 'Piercing Line',
    formationDescription: "A two-candle bullish reversal pattern: a long bearish candle, followed by a bullish candle that opens below the first candle's low but closes more than halfway up into the first candle's body - without fully closing above the first candle's open.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Piercing Line pattern?',
        answerText: "A Piercing Line is a two-candle bullish reversal pattern: a long bearish candle, followed by a bullish candle that opens below the first candle's low (a gap down) but then closes more than halfway up into the first candle's body - without fully closing above the first candle's open, which would instead make it a Bullish Engulfing pattern. It shows a sharp intra-session reversal from renewed selling into strong buying.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Piercing Line suggest about buyer conviction?',
        answerText: 'A Piercing Line suggests that despite opening even lower than the prior session\'s close, buyers stepped in forcefully enough to erase more than half of the prior candle\'s decline by the close. That "more than halfway" recovery is the key threshold - it shows real conviction from buyers within a single session, not just a minor bounce.',
      },
      {
        category: 'Reliability', tier: 201,
        questionText: "How does a Piercing Line's reliability compare to a Bullish Engulfing pattern?",
        answerText: "A Piercing Line is generally read as a slightly less decisive signal than a Bullish Engulfing pattern, since it doesn't fully reclaim the prior candle's entire range - only more than half of it. Reliability increases the closer the second candle's close gets to fully engulfing the first candle's body, and when the pattern appears after an extended decline with a notable gap down at the open.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Piercing Line pattern?',
        answerText: "A Piercing Line is often used as an entry trigger for a long position once the second candle closes, sometimes with a stop placed below the pattern's low (the second candle's open, which was also the session low). Because the gap-down-then-recovery can reflect a real shift in sentiment, some traders treat a clean Piercing Line as more actionable than a Harami, though still less definitive than a full Engulfing pattern.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: 'What is a common mistake when identifying a Piercing Line?',
        answerText: "A common mistake is confusing a Piercing Line with a Bullish Engulfing pattern - the key difference is that a Piercing Line's second candle closes only more than halfway into the first candle's body, not above the first candle's open. Mislabeling a shallow, less-than-halfway recovery as a valid Piercing Line leads to inconsistent expectations about how strong the signal actually is.",
      },
    ],
  },
  {
    patternName: 'Dark Cloud Cover',
    formationDescription: "The bearish mirror of Piercing Line: a long bullish candle, followed by a bearish candle that opens above the first candle's high but closes more than halfway down into the first candle's body - without fully closing below the first candle's open.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Dark Cloud Cover pattern?',
        answerText: "Dark Cloud Cover is the bearish mirror of a Piercing Line: a long bullish candle, followed by a bearish candle that opens above the first candle's high (a gap up) but then closes more than halfway down into the first candle's body - without fully closing below the first candle's open, which would instead make it a Bearish Engulfing pattern. It shows a sharp intra-session reversal from renewed buying into strong selling.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does Dark Cloud Cover suggest about seller conviction?',
        answerText: 'Dark Cloud Cover suggests that despite opening even higher than the prior session\'s close, sellers took control forcefully enough to erase more than half of the prior candle\'s gains by the close. That sharp intra-session reversal, from a fresh high to a deep close, is read as a real shift in control from buyers to sellers within a single session.',
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is Dark Cloud Cover as a top signal?',
        answerText: "Dark Cloud Cover is read as a somewhat less decisive signal than a full Bearish Engulfing pattern, since the second candle doesn't fully reclaim the entire prior range - only more than half of it. It becomes more reliable the deeper the second candle closes into the first candle's body, and when it forms after an extended rally with a clear gap up at the open rather than a marginal new high.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is Dark Cloud Cover typically used?',
        answerText: "Dark Cloud Cover is often used as a trigger to exit long positions or initiate shorts once the second candle closes, with a stop sometimes placed above the pattern's high (the second candle's open, which was also the session high). A clean, deep Dark Cloud Cover is generally treated as more actionable than a Harami, though still somewhat less definitive than a full Engulfing pattern.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: 'What mistake commonly happens when reading Dark Cloud Cover?',
        answerText: "The most common mistake is confusing it with a Bearish Engulfing pattern - Dark Cloud Cover's second candle only needs to close more than halfway into the first candle's body, not below the first candle's open. Treating a shallow, barely-halfway close as a full Dark Cloud Cover overstates how much control sellers actually regained.",
      },
    ],
  },
  {
    patternName: 'Three Black Crows',
    formationDescription: "The bearish mirror of Three White Soldiers: three consecutive long bearish candles, each opening within the prior candle's body and closing near its own low - suggesting steady, sustained selling pressure.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is the Three Black Crows pattern?',
        answerText: "Three Black Crows is a bearish continuation/reversal pattern of three consecutive long bearish candles, each opening within the prior candle's body and closing at or near its own low, with relatively small wicks. It's the mirror image of Three White Soldiers, and suggests steady, sustained selling pressure across three full sessions rather than a single sharp drop.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does Three Black Crows suggest about the strength of a decline?',
        answerText: "Three Black Crows suggests selling pressure is broad and sustained rather than a single panic-driven session - each candle closing near its own low, with the next candle opening within the prior body rather than gapping wildly, shows orderly, persistent distribution rather than a chaotic single-day crash. It's generally read as a stronger bearish continuation or reversal signal than any single bearish candle.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is Three Black Crows compared to a single bearish candle?',
        answerText: "Because it requires three consecutive sessions of consistent selling, Three Black Crows is generally considered more reliable than a single-candle bearish pattern. That said, a very rapid, sharply-angled version of the pattern - each candle opening well below, not within, the prior body - can indicate an overextended, exhausted move at higher risk of a snap-back bounce, rather than a stable, sustainable downtrend.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use the Three Black Crows pattern?',
        answerText: "Three Black Crows is often used as confirmation to exit long positions or add to/initiate short positions, since the pattern's three-session formation gives more confidence than a single candle that the selling is genuine and sustained. Some traders watch for the pattern to form near a known support level, since strong, orderly selling into support that still holds can also set up a sharper reversal once selling exhausts itself.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Three Black Crows pattern?",
        answerText: "A common mistake is treating every three-in-a-row bearish candle sequence as Three Black Crows without checking the specific formation criteria - each candle should open within the prior candle's real body and close near its own low. A sequence of three down candles with large gaps between them, or long wicks showing significant intra-session reversals, doesn't carry the same steady-selling implication the true pattern does.",
      },
    ],
  },
  // Marubozu/Spinning Top (2026-09-26) - added ahead of the Stock Analysis Pattern Detection
  // panel gaining these same two patterns, so "Ask about patterns" always has real curated
  // content behind any badge the detection panel can show, matching the precedent every other
  // detected pattern (Doji/Hammer/Shooting Star) already followed.
  {
    patternName: 'Marubozu',
    formationDescription: 'A candle with a long body and virtually no upper or lower wick - the open sits at (or very near) one extreme of the session\'s range and the close sits at the other, showing one side was in control for the entire session with no meaningful pushback.',
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Marubozu candlestick pattern?',
        answerText: "A Marubozu is a candle with a long body and virtually no upper or lower wick - the open sits at (or very near) one extreme of the session's range and the close sits at the other. A bullish Marubozu opens at its low and closes at its high; a bearish Marubozu opens at its high and closes at its low. Either way, it shows one side controlled the entire session from open to close with essentially no pushback from the other side.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Marubozu tell you about who was in control during the session?',
        answerText: "A Marubozu shows one-sided conviction for the full length of the session - unlike most candles, there's no meaningful wick showing price was ever pushed the other way and recovered. A bullish Marubozu suggests buyers were in complete control from the opening bell to the close; a bearish Marubozu shows the same for sellers. It's read as a strong momentum signal in whichever direction the body points, though on its own it doesn't say whether that momentum will continue into the next session.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Marubozu as a continuation or reversal signal?',
        answerText: "A Marubozu's reliability depends heavily on where it appears. Appearing early in a new trend or as a breakout candle through a known resistance/support level, it's read as a strong continuation signal. Appearing after an already-extended move, the same one-sided conviction can instead mark exhaustion - a climactic, unsustainable push that reverses shortly after. Volume matters too: a Marubozu on unusually high volume carries more weight than one on thin trading.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Marubozu typically used in a trading approach?',
        answerText: "Traders often use a Marubozu as a momentum or breakout confirmation - for example, treating a bullish Marubozu that closes above a resistance level as stronger confirmation of the breakout than an ordinary candle would provide, since there's no wick suggesting the breakout was ever in doubt during the session. Because the pattern shows no rejection at all, some traders also use the candle's own open (not its wick, since there is none) as a natural stop-loss reference for a new position.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake when trading a Marubozu?",
        answerText: "A common mistake is treating a Marubozu as automatically bullish or bearish continuation without checking where it appears in the broader trend - the exact same one-sided, no-wick candle can mark healthy continuation early in a move or climactic exhaustion late in one. A second mistake is requiring a perfectly wick-less candle; in practice, a candle with a very small (not literally zero) wick on one side is still commonly read as a Marubozu.",
      },
    ],
  },
  {
    patternName: 'Spinning Top',
    formationDescription: "A candle with a small body positioned roughly in the middle of the session's range, with upper and lower wicks of comparable length on both sides - showing price moved meaningfully in both directions during the session but neither buyers nor sellers held control by the close.",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Spinning Top candlestick pattern?',
        answerText: "A Spinning Top has a small body positioned roughly in the middle of the candle's overall range, with upper and lower wicks of comparable length on both sides. It looks similar to a Doji but with a slightly larger (still small) body - price was pushed meaningfully higher and lower during the session, but neither buyers nor sellers held onto that move by the close.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'How is a Spinning Top different from a Doji?',
        answerText: "Both signal indecision, but a Doji's open and close are nearly identical (essentially zero body), while a Spinning Top has a small but real body - meaning one side did end the session slightly ahead, even though neither side controlled the full range. In practice a Spinning Top is read the same way as a Doji: a pause in conviction rather than a confirmed reversal, with the surrounding candles mattering more than the Spinning Top itself.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Spinning Top as a reversal warning?',
        answerText: "A Spinning Top is one of the weaker standalone signals in candlestick analysis - by itself it only shows indecision, not direction. It carries more weight appearing after an extended trend (suggesting that trend's momentum is fading) or at a well-established support/resistance level, and much less weight appearing in the middle of a range where indecision is unremarkable. Traders generally wait for a directional confirmation candle before treating a Spinning Top as an actual turning point.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Spinning Top?',
        answerText: "Because it only signals indecision, a Spinning Top is rarely traded on its own - it's more often used as a cue to tighten a stop on an existing position or wait for the next candle's direction before adding to one. Appearing at a known support or resistance level, it can add some weight to that level actually holding, but traders typically look for a confirming close in one direction before acting.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake when reading a Spinning Top?",
        answerText: "A common mistake is confusing a Spinning Top with a Doji and expecting the same near-total indecision - a Spinning Top's real (if small) body means one side did edge out the other, so treating it as perfectly balanced overstates the indecision. Another common mistake is trading a Spinning Top in isolation as a reversal signal, when its real value is only as a warning to watch the next candle, not a standalone entry trigger.",
      },
    ],
  },
  // Doji-Dragonfly/Doji-Gravestone/Doji-LongLegged (2026-09-26) - the 3 Doji sub-types, added
  // ahead of the Pattern Detection panel gaining them, same precedent as Marubozu/Spinning Top.
  // Named with the "Doji-" prefix (not the traditional "Dragonfly Doji" word order) so all 4
  // Doji-family patterns sort/group together by name everywhere they're listed - explicit
  // direction, 2026-09-26 follow-up. Existing DB rows were renamed via a one-time UPDATE rather
  // than re-seeded under the new name (which would have upserted new rows and left the
  // old-named ones as orphaned duplicates, since this file's own upsert keys on pattern_name).
  {
    patternName: 'Doji-Dragonfly',
    formationDescription: 'A Doji variant where the open, close, and high are all virtually equal, producing a long lower wick and little to no upper wick - the body sits at the very top of the candle\'s range, shaped like a capital T.',
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Dragonfly Doji candlestick pattern?',
        answerText: "A Dragonfly Doji is a Doji variant where the open, close, and high are all virtually equal, producing a long lower wick and little to no upper wick - the body sits at the very top of the candle's range, shaped like a capital T. It shows sellers pushed price sharply lower during the session, but buyers fully recovered it by the close, right back near the open.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'How is a Dragonfly Doji different from a regular Doji?',
        answerText: "A regular Doji only requires the open and close to be nearly equal, with no requirement on where the wicks fall - it could have long wicks on both sides, short wicks on both sides, or a wick concentrated on one side. A Dragonfly Doji is the specific case where nearly all of that movement happened below the open/close level (a long lower wick, virtually no upper wick), which reads as a more clearly bullish-leaning signal than a plain Doji, especially after a downtrend.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Dragonfly Doji as a bullish reversal signal?',
        answerText: "Like most single-candle patterns, a Dragonfly Doji is more reliable with context: appearing after an extended downtrend, at a known support level, or with above-average volume all add weight. A Dragonfly Doji appearing in a sideways or uptrending market carries much less reversal significance, since there's no prior selling pressure for the pattern to be reversing.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Dragonfly Doji?',
        answerText: "Similar to a Hammer, many traders wait for the next candle to close above the Dragonfly Doji's body before treating it as a real reversal, using the pattern's own low as a natural stop-loss reference. Because the shape shows a full round-trip within a single session, some traders view it as a slightly stronger signal than an ordinary Doji at the same location.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Dragonfly Doji pattern?",
        answerText: "A common mistake is treating any Doji with a somewhat longer lower wick as a Dragonfly Doji - the defining feature is that the upper wick is negligible, not just smaller than the lower one. A Doji with a moderate wick on both sides is a different (and generally weaker) signal than a true Dragonfly Doji, which requires virtually no upper wick at all.",
      },
    ],
  },
  {
    patternName: 'Doji-Gravestone',
    formationDescription: "The mirror image of a Dragonfly Doji: the open, close, and low are all virtually equal, producing a long upper wick and little to no lower wick - the body sits at the very bottom of the candle's range, shaped like an upside-down T.",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Gravestone Doji candlestick pattern?',
        answerText: "A Gravestone Doji is the mirror image of a Dragonfly Doji: the open, close, and low are all virtually equal, producing a long upper wick and little to no lower wick - the body sits at the very bottom of the candle's range. It shows buyers pushed price sharply higher during the session, but sellers fully reversed it by the close, right back near the open.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'How is a Gravestone Doji different from a regular Doji?',
        answerText: "A regular Doji only requires the open and close to be nearly equal, with no requirement on wick shape. A Gravestone Doji is the specific case where nearly all of the session's price movement happened above the open/close level (a long upper wick, virtually no lower wick), which reads as a more clearly bearish-leaning signal than a plain Doji, especially after an uptrend.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Gravestone Doji as a bearish reversal signal?',
        answerText: "Like the Dragonfly Doji, a Gravestone Doji is more reliable with supporting context - appearing after an extended uptrend, at a known resistance level, or with above-average volume all strengthen the signal. The same shape appearing in a sideways or downtrending market carries little reversal significance, since there's no prior buying pressure for it to be reversing.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Gravestone Doji?',
        answerText: "Similar to a Shooting Star, many traders wait for the next candle to close below the Gravestone Doji's body before treating it as a real reversal, using the pattern's own high as a natural stop-loss reference for a new short position. Because the shape shows a full intra-session round-trip, it's sometimes viewed as a slightly stronger signal than an ordinary Doji in the same spot.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Gravestone Doji pattern?",
        answerText: "A common mistake is treating any Doji with a somewhat longer upper wick as a Gravestone Doji - the defining feature is that the lower wick is negligible, not just smaller than the upper one. A Doji with a moderate wick on both sides is a materially different (and generally weaker) signal than a true Gravestone Doji.",
      },
    ],
  },
  {
    patternName: 'Doji-LongLegged',
    formationDescription: 'A Doji variant with unusually long wicks on both the upper and lower side - price swung significantly in both directions during the session before closing almost exactly where it opened, showing extreme indecision rather than a lean in either direction.',
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Long-Legged Doji candlestick pattern?',
        answerText: "A Long-Legged Doji is a Doji variant with unusually long wicks on both the upper and lower side - price swung significantly in both directions during the session before closing almost exactly where it opened. Unlike a Dragonfly or Gravestone Doji, neither side dominates; it represents extreme indecision rather than a lean toward either buyers or sellers.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Long-Legged Doji suggest, compared to a Dragonfly or Gravestone Doji?',
        answerText: "A Dragonfly or Gravestone Doji leans toward a specific side (bullish or bearish) because one wick is negligible while the other dominates. A Long-Legged Doji has substantial wicks on BOTH sides, so it doesn't lean either way - it simply shows an unusually volatile, high-conviction-on-both-sides session that still ended in a stalemate. It's read as a sign of significant uncertainty, sometimes right before an outsized move once that uncertainty resolves.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Long-Legged Doji as a trading signal?',
        answerText: "A Long-Legged Doji is even less directionally reliable than a plain Doji, since it explicitly shows conviction on both sides rather than just indecision - it doesn't suggest which way the resolution will go. It's most useful as a volatility flag (the session's range was unusually wide relative to its net movement) rather than a directional reversal signal, and is generally not traded on its own.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Long-Legged Doji?',
        answerText: "Because it doesn't lean bullish or bearish, a Long-Legged Doji is mostly used as a caution flag - a sign that volatility has picked up and the next few candles may be needed to reveal genuine direction. Some traders widen stops or reduce position size after seeing one, rather than treating it as an entry signal in either direction.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Long-Legged Doji pattern?",
        answerText: "A common mistake is treating a Long-Legged Doji like a Dragonfly or Gravestone Doji and assuming it leans bullish or bearish - by definition it doesn't, since both wicks are substantial. Reading directional bias into a pattern that specifically represents two-sided indecision is a misapplication of what the shape actually shows.",
      },
    ],
  },
  // Belt Hold (2026-09-26) - added ahead of the Pattern Detection panel gaining it, same
  // precedent as every other pattern this session. One entry covers both the bullish and bearish
  // forms (like Marubozu's own content), since the direction is symmetric and the badge itself
  // (Bh+/Bh-) is what distinguishes them at a glance, not separate curated patterns.
  {
    patternName: 'Belt Hold',
    formationDescription: "A candle with a large body and virtually no wick on the side where it opened - a bullish Belt Hold opens at/near its low and closes strongly higher; a bearish Belt Hold opens at/near its high and closes strongly lower. Unlike a Marubozu, only the opening side needs to be wick-free; the other side can carry a real wick.",
    relevantHorizons: ['dayTrading', 'mediumTerm'],
    complexityTier: 'Simple',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Belt Hold candlestick pattern?',
        answerText: "A Belt Hold is a candle with a large body and virtually no wick on the side where it opened. A bullish Belt Hold opens at or very near its low and closes strongly higher, with little to no lower wick; a bearish Belt Hold opens at or very near its high and closes strongly lower, with little to no upper wick. Unlike a Marubozu, only the opening side needs to be wick-free - the closing side can carry a real wick.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'How is a Belt Hold different from a Marubozu?',
        answerText: "A Marubozu requires virtually no wick on both sides - the entire session's range is the body. A Belt Hold only requires the opening side to be wick-free; the closing side can have a real wick, showing that price pulled back somewhat from its extreme before the close, but the session still opened decisively at one end and pushed hard toward the other. It's a slightly less extreme version of the same one-sided-conviction idea.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'How reliable is a Belt Hold as a signal?',
        answerText: "Like a Marubozu, a Belt Hold is more meaningful with context: appearing at the start of a new trend or breaking through a known support/resistance level adds weight, while the same shape late in an already-extended move can instead signal exhaustion. A larger body and a smaller wick on the closing side both make the signal more convincing - a Belt Hold with a long wick on the closing side is a weaker, more hesitant version of the pattern.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Belt Hold pattern?',
        answerText: "Similar to a Marubozu, a bullish Belt Hold breaking above resistance is often treated as stronger breakout confirmation than an ordinary candle, since there's no opening-side wick suggesting hesitation. The candle's own open (the wick-free side) is a natural stop-loss reference, since a move back through it would undo the pattern's entire premise.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Belt Hold pattern?",
        answerText: "A common mistake is confusing a Belt Hold with a Marubozu - a Marubozu requires both sides to be wick-free, while a Belt Hold only requires the opening side to be. Treating a Belt Hold as if it had the same total-conviction strength as a Marubozu overstates the signal, since the real wick on the closing side shows the move wasn't quite as absolute.",
      },
    ],
  },
  // Drafted 2026-09-27, per direct request, for review before any detection/seed work - 6 more
  // patterns rounding the catalog out to 20, following the same 5-category/tier-101-201 structure
  // established for every pattern since Hanging Man above. Two pairs build directly on existing
  // patterns already in this file (Three Inside Up/Down confirm a Bullish/Bearish Harami with a
  // third candle; Three Outside Up/Down confirm a Bullish/Bearish Engulfing the same way) - their
  // content deliberately cross-references Harami/Engulfing's own established reliability framing
  // rather than repeating it from scratch. Tweezer Top/Bottom is a genuinely new 2-candle shape
  // (matching highs/lows, not a body-containment check) not related to any existing pattern here.
  {
    patternName: 'Tweezer Bottom',
    formationDescription: "A two-candle pattern where both candles' lows are virtually identical, appearing after a decline - the first candle is typically bearish, continuing the downtrend, and the second tests the same low but fails to break meaningfully below it.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Tweezer Bottom pattern?',
        answerText: "A Tweezer Bottom is a two-candle pattern where both candles' lows are virtually identical, appearing after a decline. The first candle is typically bearish, continuing the downtrend; the second candle tests that same low but fails to push meaningfully below it, often closing higher. The matching lows show a specific price level that sellers couldn't break through twice in a row.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Tweezer Bottom suggest is happening at that price level?',
        answerText: "A Tweezer Bottom suggests a real, specific support level has been tested and defended twice within two consecutive sessions - not just a single candle's wick, but the same low surviving a second attempt to break it. It works like a miniature double-bottom compressed into two candles, and is generally read as a sign that sellers are running out of room to push price lower at that exact level.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Tweezer Bottom more or less reliable?',
        answerText: "A Tweezer Bottom is more reliable when the two candles are opposite colors (bearish then bullish, showing an actual shift, not just two down days that happened to share a low), when it forms after an extended decline rather than a shallow dip, and when the matching lows also line up with a known support level or prior swing low. Two candles with only loosely similar (not virtually identical) lows are a much weaker version of the pattern.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Tweezer Bottom typically used?',
        answerText: "A Tweezer Bottom is often used as confirmation that a specific support level is holding, with the shared low itself serving as a natural stop-loss reference - a subsequent close below it invalidates the pattern. Because it only confirms a level is holding rather than showing decisive buying the way an Engulfing pattern does, many traders wait for an additional bullish candle afterward before treating it as a full reversal rather than just a defended low.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Tweezer Bottom pattern?",
        answerText: "A common mistake is calling any two candles with roughly similar lows a Tweezer Bottom - the lows need to be virtually identical, not just close, for the \"double-tested support\" reading to actually hold. Another is treating it with the same weight as a Bullish Engulfing pattern; a Tweezer only shows a level being defended, not buyers actively taking control, so it's a comparatively weaker signal.",
      },
    ],
  },
  {
    patternName: 'Tweezer Top',
    formationDescription: "The bearish mirror of Tweezer Bottom: a two-candle pattern where both candles' highs are virtually identical, appearing after a rally - the first candle is typically bullish, continuing the uptrend, and the second tests the same high but fails to break meaningfully above it.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Tweezer Top pattern?',
        answerText: "A Tweezer Top is the bearish mirror of a Tweezer Bottom: a two-candle pattern where both candles' highs are virtually identical, appearing after a rally. The first candle is typically bullish, continuing the uptrend; the second candle tests that same high but fails to push meaningfully above it, often closing lower. The matching highs show a specific price level that buyers couldn't break through twice in a row.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Tweezer Top suggest is happening at that price level?',
        answerText: "A Tweezer Top suggests a real, specific resistance level has been tested and held twice within two consecutive sessions - the same high surviving a second attempt to break it. It works like a miniature double-top compressed into two candles, and is generally read as a sign that buyers are running out of room to push price higher at that exact level.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Tweezer Top more or less reliable?',
        answerText: "A Tweezer Top is more reliable when the two candles are opposite colors (bullish then bearish, showing an actual shift, not just two up days that happened to share a high), when it forms after an extended rally rather than a shallow bounce, and when the matching highs also line up with a known resistance level or prior swing high. Two candles with only loosely similar (not virtually identical) highs are a much weaker version of the pattern.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Tweezer Top typically used?',
        answerText: "A Tweezer Top is often used as confirmation that a specific resistance level is holding, with the shared high itself serving as a natural stop-loss reference for a short position - a subsequent close above it invalidates the pattern. Because it only confirms a level is holding rather than showing decisive selling the way an Engulfing pattern does, many traders wait for an additional bearish candle afterward before treating it as a full reversal rather than just a defended high.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Tweezer Top pattern?",
        answerText: "A common mistake is calling any two candles with roughly similar highs a Tweezer Top - the highs need to be virtually identical, not just close, for the \"double-tested resistance\" reading to actually hold. Another is treating it with the same weight as a Bearish Engulfing pattern; a Tweezer only shows a level being defended, not sellers actively taking control, so it's a comparatively weaker signal.",
      },
    ],
  },
  {
    patternName: 'Bullish Kicking',
    formationDescription: "A two-candle reversal where a bearish Marubozu (no wicks) is immediately followed by a bullish Marubozu that gaps up so cleanly the two candles' price ranges don't overlap at all - a complete, instantaneous reversal in sentiment with no committed wick on either candle.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bullish Kicking pattern?',
        answerText: "A Bullish Kicking pattern is a two-candle reversal where a bearish Marubozu (a long down candle with no upper or lower wick) is immediately followed by a bullish Marubozu that gaps up so sharply the second candle's entire range sits above the first candle's entire range, with no overlap at all. Both candles show full-body conviction in their own direction - no wick to suggest any hesitation - which is what makes the abrupt reversal between them so striking.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bullish Kicking pattern suggest happened to sentiment?',
        answerText: "A Bullish Kicking pattern suggests sentiment flipped essentially overnight, with no gradual transition - sellers were fully in control through the first candle's entire session, then buyers took over so completely that trading resumed well above where the sellers had left off. The total lack of overlap between the two candles' ranges is what marks this as a clean break rather than a contested tug-of-war.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Bullish Kicking pattern more or less reliable?',
        answerText: "A Bullish Kicking pattern is more reliable the larger and cleaner the gap between the two candles - a wider gap with zero overlap reads as more decisive than one where the ranges barely miss touching. It's also strengthened by heavier-than-usual volume on the second (bullish) candle, confirming real buying interest rather than a thin, easily-reversed gap. Because the pattern depends entirely on a genuine price gap, it's far more common in markets that trade with real overnight gaps (like stocks) than in markets that trade nearly continuously with few true gaps.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Bullish Kicking pattern typically used?',
        answerText: "A Bullish Kicking pattern is typically treated as a strong, immediate reversal signal, with the gap itself often used as a support zone and a stop-loss reference - a subsequent close back into the gap (let alone back below the first candle's low) would undercut the pattern's whole premise. Because both candles are full-bodied with no wick evidence of a fight at any price level, traders often act on it more assertively than on softer reversal signals like a Harami.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Bullish Kicking pattern?",
        answerText: "A common mistake is calling a pattern \"Kicking\" when the two candles' ranges actually overlap even slightly, or when either candle has a real wick - the entire signal rests on a true, clean gap between two wickless bodies, and a near-miss is a fundamentally different, weaker setup, not a lesser version of the same one. Another is ignoring volume - a Kicking pattern on unusually light volume is a much less convincing reversal than the classic definition assumes.",
      },
    ],
  },
  {
    patternName: 'Bearish Kicking',
    formationDescription: "The bearish mirror of Bullish Kicking: a bullish Marubozu (no wicks) is immediately followed by a bearish Marubozu that gaps down so cleanly the two candles' price ranges don't overlap at all - a complete, instantaneous reversal in sentiment with no committed wick on either candle.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Composite',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bearish Kicking pattern?',
        answerText: "A Bearish Kicking pattern is the bearish mirror of Bullish Kicking: a two-candle reversal where a bullish Marubozu (a long up candle with no upper or lower wick) is immediately followed by a bearish Marubozu that gaps down so sharply the second candle's entire range sits below the first candle's entire range, with no overlap at all. Both candles show full-body conviction in their own direction - no wick to suggest any hesitation - which is what makes the abrupt reversal between them so striking.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bearish Kicking pattern suggest happened to sentiment?',
        answerText: "A Bearish Kicking pattern suggests sentiment flipped essentially overnight, with no gradual transition - buyers were fully in control through the first candle's entire session, then sellers took over so completely that trading resumed well below where the buyers had left off. The total lack of overlap between the two candles' ranges is what marks this as a clean break rather than a contested tug-of-war.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Bearish Kicking pattern more or less reliable?',
        answerText: "A Bearish Kicking pattern is more reliable the larger and cleaner the gap between the two candles - a wider gap with zero overlap reads as more decisive than one where the ranges barely miss touching. It's also strengthened by heavier-than-usual volume on the second (bearish) candle, confirming real selling pressure rather than a thin, easily-reversed gap. Because the pattern depends entirely on a genuine price gap, it's far more common in markets that trade with real overnight gaps (like stocks) than in markets that trade nearly continuously with few true gaps.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Bearish Kicking pattern typically used?',
        answerText: "A Bearish Kicking pattern is typically treated as a strong, immediate reversal signal, with the gap itself often used as a resistance zone and a stop-loss reference for a short position - a subsequent close back into the gap (let alone back above the first candle's high) would undercut the pattern's whole premise. Because both candles are full-bodied with no wick evidence of a fight at any price level, traders often act on it more assertively than on softer reversal signals like a Harami.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Bearish Kicking pattern?",
        answerText: "A common mistake is calling a pattern \"Kicking\" when the two candles' ranges actually overlap even slightly, or when either candle has a real wick - the entire signal rests on a true, clean gap between two wickless bodies, and a near-miss is a fundamentally different, weaker setup, not a lesser version of the same one. Another is ignoring volume - a Kicking pattern on unusually light volume is a much less convincing reversal than the classic definition assumes.",
      },
    ],
  },
  {
    patternName: 'Bullish Abandoned Baby',
    formationDescription: "The stricter, rarer sibling of Morning Star: a long bearish candle, a small-bodied candle (often a Doji) that gaps completely below the first candle's own low with no overlap at all, then a long bullish candle that gaps back above the middle candle's own high, also with no overlap - a genuine island reversal, not just a body-overlap pause.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bullish Abandoned Baby pattern?',
        answerText: "A Bullish Abandoned Baby is the stricter, rarer sibling of the Morning Star: a long bearish candle, followed by a small-bodied candle (often a Doji) that gaps completely below the first candle's own low with no overlap at all, followed by a long bullish candle that gaps back above the middle candle's own high, also with no overlap. The middle candle sits genuinely isolated on both sides - a true island - rather than merely closing lower with some wick overlap the way a plain Morning Star's middle candle can.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bullish Abandoned Baby suggest about the shift in control?',
        answerText: "A Bullish Abandoned Baby suggests an unusually decisive reversal - the middle candle's total isolation on both sides shows sellers pushed price down so hard it gapped away from the prior close, then buyers reversed so hard the very next session it gapped away again in the other direction, leaving that one candle stranded with no real trading overlap on either side. It reads as a more extreme, more convincing version of the same reversal story a Morning Star already tells.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Bullish Abandoned Baby more or less reliable?',
        answerText: "A Bullish Abandoned Baby is more reliable specifically because the two gaps are genuinely real and don't overlap at all - a lot of what gets loosely called an \"Abandoned Baby\" in practice actually has a middle candle that touches or slightly overlaps one side, which technically makes it a Morning Star instead, a meaningfully weaker signal. It's also stronger when the middle candle's own body is very small (ideally a Doji) and when volume picks up on the third candle, confirming real buying conviction rather than a thin, easily-reversed move. Because true double gaps are uncommon, this pattern shows up rarely.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Bullish Abandoned Baby typically used?',
        answerText: "A Bullish Abandoned Baby is typically treated as a strong reversal signal, similar to a Morning Star but weighted more heavily given how rare and decisive a genuine double gap is. The middle candle's own high (the top of the isolated island) is often used as a tight stop-loss reference, since a close back below it would mean the gap has been filled and the pattern's premise is broken.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Bullish Abandoned Baby pattern?",
        answerText: "The most common mistake is calling a pattern an \"Abandoned Baby\" when one of the two gaps doesn't actually hold - if the middle candle's wick touches or overlaps either neighboring candle's range at all, it's really just a Morning Star, not this stricter, rarer version. Treating a partial-overlap Morning Star as if it carries an Abandoned Baby's extra reliability overstates the signal's real strength.",
      },
    ],
  },
  {
    patternName: 'Bearish Abandoned Baby',
    formationDescription: "The bearish mirror of Bullish Abandoned Baby: a long bullish candle, a small-bodied candle (often a Doji) that gaps completely above the first candle's own high with no overlap at all, then a long bearish candle that gaps back below the middle candle's own low, also with no overlap - a genuine island reversal, not just a body-overlap pause.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Bearish Abandoned Baby pattern?',
        answerText: "A Bearish Abandoned Baby is the bearish mirror of Bullish Abandoned Baby: a long bullish candle, followed by a small-bodied candle (often a Doji) that gaps completely above the first candle's own high with no overlap at all, followed by a long bearish candle that gaps back below the middle candle's own low, also with no overlap. The middle candle sits genuinely isolated on both sides - a true island - rather than merely closing higher with some wick overlap the way a plain Evening Star's middle candle can.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Bearish Abandoned Baby suggest about the shift in control?',
        answerText: "A Bearish Abandoned Baby suggests an unusually decisive reversal - the middle candle's total isolation on both sides shows buyers pushed price up so hard it gapped away from the prior close, then sellers reversed so hard the very next session it gapped away again in the other direction, leaving that one candle stranded with no real trading overlap on either side. It reads as a more extreme, more convincing version of the same reversal story an Evening Star already tells.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Bearish Abandoned Baby more or less reliable?',
        answerText: "A Bearish Abandoned Baby is more reliable specifically because the two gaps are genuinely real and don't overlap at all - a lot of what gets loosely called an \"Abandoned Baby\" in practice actually has a middle candle that touches or slightly overlaps one side, which technically makes it an Evening Star instead, a meaningfully weaker signal. It's also stronger when the middle candle's own body is very small (ideally a Doji) and when volume picks up on the third candle, confirming real selling conviction rather than a thin, easily-reversed move. Because true double gaps are uncommon, this pattern shows up rarely.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Bearish Abandoned Baby typically used?',
        answerText: "A Bearish Abandoned Baby is typically treated as a strong reversal signal, similar to an Evening Star but weighted more heavily given how rare and decisive a genuine double gap is. The middle candle's own low (the bottom of the isolated island) is often used as a tight stop-loss reference for a short position, since a close back above it would mean the gap has been filled and the pattern's premise is broken.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Bearish Abandoned Baby pattern?",
        answerText: "The most common mistake is calling a pattern an \"Abandoned Baby\" when one of the two gaps doesn't actually hold - if the middle candle's wick touches or overlaps either neighboring candle's range at all, it's really just an Evening Star, not this stricter, rarer version. Treating a partial-overlap Evening Star as if it carries an Abandoned Baby's extra reliability overstates the signal's real strength.",
      },
    ],
  },
  {
    patternName: 'Upside Tasuki Gap',
    formationDescription: "A three-candle bullish continuation pattern (not a reversal): two bullish candles in a row, the second gapping up from the first with no overlap, followed by a third bearish candle that opens inside the second candle's body and closes back down into the gap - but doesn't fully close it, leaving the original gap only partially filled.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is an Upside Tasuki Gap pattern?',
        answerText: "An Upside Tasuki Gap is a three-candle bullish continuation pattern found during an uptrend: a bullish candle is followed by a second bullish candle that gaps up with no overlap between the two candles' ranges, then a third candle opens within that second candle's body and pulls back down into the gap - but its close stays above the first candle's own close, meaning the gap never gets fully filled.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does an Upside Tasuki Gap suggest about the ongoing trend?',
        answerText: "Because it's a continuation pattern rather than a reversal, an Upside Tasuki Gap suggests the uptrend that produced the gap is still intact - the pullback on the third candle looks at first like the rally is fading, but as long as it can't close the gap completely, the level the second candle gapped up from is still holding as support, and the original upward move is expected to resume.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes an Upside Tasuki Gap more or less reliable?',
        answerText: "An Upside Tasuki Gap is more reliable when the initial gap between candles one and two is clean and clearly visible (not a thin sliver), when the pullback candle's close stays comfortably above the original gap rather than just barely avoiding it, and when it forms within a genuinely established uptrend rather than a choppy, directionless one. A pullback that fully closes the gap invalidates the pattern entirely rather than just weakening it - it's a binary condition, not a matter of degree.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is an Upside Tasuki Gap typically used?',
        answerText: "An Upside Tasuki Gap is typically used as confirmation to stay in or add to an existing long position through what would otherwise look like a worrying pullback, with the original gap level itself serving as the key stop-loss/invalidation reference - a subsequent close that fully fills the gap is read as the continuation thesis failing, not just weakening.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Upside Tasuki Gap pattern?",
        answerText: "A common mistake is treating any gap-up followed by a red candle as a Tasuki Gap - the defining feature is that the pullback candle's close stays above the original gap; if it closes the gap completely, the pattern doesn't apply at all and the more likely read is that the rally has actually failed, not paused. It's also easy to confuse with a bearish reversal at first glance, since the third candle is visually a down day inside what looks like a topping structure - the gap-based classification is what actually distinguishes the two.",
      },
    ],
  },
  {
    patternName: 'Downside Tasuki Gap',
    formationDescription: "The bearish mirror of Upside Tasuki Gap: a three-candle bearish continuation pattern - two bearish candles in a row, the second gapping down from the first with no overlap, followed by a third bullish candle that opens inside the second candle's body and closes back up into the gap - but doesn't fully close it, leaving the original gap only partially filled.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Downside Tasuki Gap pattern?',
        answerText: "A Downside Tasuki Gap is the bearish mirror of Upside Tasuki Gap: a three-candle bearish continuation pattern found during a downtrend. A bearish candle is followed by a second bearish candle that gaps down with no overlap between the two candles' ranges, then a third candle opens within that second candle's body and pulls back up into the gap - but its close stays below the first candle's own close, meaning the gap never gets fully filled.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Downside Tasuki Gap suggest about the ongoing trend?',
        answerText: "Because it's a continuation pattern rather than a reversal, a Downside Tasuki Gap suggests the downtrend that produced the gap is still intact - the bounce on the third candle looks at first like the decline is fading, but as long as it can't close the gap completely, the level the second candle gapped down from is still holding as resistance, and the original downward move is expected to resume.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Downside Tasuki Gap more or less reliable?',
        answerText: "A Downside Tasuki Gap is more reliable when the initial gap between candles one and two is clean and clearly visible (not a thin sliver), when the bounce candle's close stays comfortably below the original gap rather than just barely avoiding it, and when it forms within a genuinely established downtrend rather than a choppy, directionless one. A bounce that fully closes the gap invalidates the pattern entirely rather than just weakening it - it's a binary condition, not a matter of degree.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Downside Tasuki Gap typically used?',
        answerText: "A Downside Tasuki Gap is typically used as confirmation to stay in or add to an existing short position through what would otherwise look like a worrying bounce, with the original gap level itself serving as the key stop-loss/invalidation reference for that short - a subsequent close that fully fills the gap is read as the continuation thesis failing, not just weakening.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Downside Tasuki Gap pattern?",
        answerText: "A common mistake is treating any gap-down followed by a green candle as a Tasuki Gap - the defining feature is that the bounce candle's close stays below the original gap; if it closes the gap completely, the pattern doesn't apply at all and the more likely read is that the decline has actually failed, not paused. It's also easy to confuse with a bullish reversal at first glance, since the third candle is visually an up day inside what looks like a bottoming structure - the gap-based classification is what actually distinguishes the two.",
      },
    ],
  },
  {
    patternName: 'Rising Three Methods',
    formationDescription: "A five-candle bullish continuation pattern: one long bullish candle, followed by three small consolidating candles that stay contained within the first candle's own high-low range (typically drifting lower), then a fifth long bullish candle that closes above the first candle's own close - confirming the original uptrend has resumed after a brief, contained pause.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Complex',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Rising Three Methods pattern?',
        answerText: "A Rising Three Methods pattern is a five-candle bullish continuation pattern: a long bullish candle, followed by three small candles that drift lower but stay contained within the first candle's own high-low range (never breaking below its low or above its high), then a fifth long bullish candle that closes above the first candle's own close - confirming the uptrend has resumed after a brief, contained pause.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Rising Three Methods pattern suggest is happening during the pause?',
        answerText: "The three small middle candles represent a brief round of profit-taking or mild selling that never actually threatens the broader uptrend - because none of them closes outside the first candle's own range, the buyers who drove that first big move never lose control of the overall structure. The fifth candle's strong close above the first candle's close confirms the pause was just a rest, not the start of a real reversal.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Rising Three Methods pattern more or less reliable?',
        answerText: "A Rising Three Methods pattern is more reliable when the three middle candles have noticeably smaller bodies than the first and fifth candles (a real contrast in conviction, not just three more candles of similar size), when none of them even threatens the first candle's own high/low, and when volume contracts during the pause and picks back up on the fifth candle - a classic \"quiet consolidation, then a real breakout\" volume signature.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Rising Three Methods pattern typically used?',
        answerText: "A Rising Three Methods pattern is typically used as a signal to stay in or add to a long position through what might otherwise look like a stalling rally, with the first candle's own low serving as the key invalidation level - a close below it during the consolidation would break the pattern's core premise well before the fifth candle even confirms.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Rising Three Methods pattern?",
        answerText: "A common mistake is counting any three quiet candles between two bigger up moves as a Rising Three Methods, without checking that all three actually stay contained within the first candle's own range - if even one middle candle pushes below the first candle's low, the pattern doesn't apply and the pullback deserves to be taken more seriously as a possible real reversal, not dismissed as a pause.",
      },
    ],
  },
  {
    patternName: 'Falling Three Methods',
    formationDescription: "The bearish mirror of Rising Three Methods: a five-candle bearish continuation pattern - one long bearish candle, followed by three small consolidating candles that stay contained within the first candle's own high-low range (typically drifting higher), then a fifth long bearish candle that closes below the first candle's own close - confirming the original downtrend has resumed after a brief, contained pause.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Complex',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Falling Three Methods pattern?',
        answerText: "A Falling Three Methods pattern is a five-candle bearish continuation pattern: a long bearish candle, followed by three small candles that drift higher but stay contained within the first candle's own high-low range (never breaking above its high or below its low), then a fifth long bearish candle that closes below the first candle's own close - confirming the downtrend has resumed after a brief, contained pause.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does a Falling Three Methods pattern suggest is happening during the pause?',
        answerText: "The three small middle candles represent a brief round of bargain-hunting or mild buying that never actually threatens the broader downtrend - because none of them closes outside the first candle's own range, the sellers who drove that first big move never lose control of the overall structure. The fifth candle's strong close below the first candle's close confirms the pause was just a rest, not the start of a real reversal.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'What makes a Falling Three Methods pattern more or less reliable?',
        answerText: "A Falling Three Methods pattern is more reliable when the three middle candles have noticeably smaller bodies than the first and fifth candles (a real contrast in conviction, not just three more candles of similar size), when none of them even threatens the first candle's own high/low, and when volume contracts during the pause and picks back up on the fifth candle - a classic \"quiet consolidation, then a real breakdown\" volume signature.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How is a Falling Three Methods pattern typically used?',
        answerText: "A Falling Three Methods pattern is typically used as a signal to stay in or add to a short position through what might otherwise look like a stabilizing decline, with the first candle's own high serving as the key invalidation level - a close above it during the consolidation would break the pattern's core premise well before the fifth candle even confirms.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Falling Three Methods pattern?",
        answerText: "A common mistake is counting any three quiet candles between two bigger down moves as a Falling Three Methods, without checking that all three actually stay contained within the first candle's own range - if even one middle candle pushes above the first candle's high, the pattern doesn't apply and the bounce deserves to be taken more seriously as a possible real reversal, not dismissed as a pause.",
      },
    ],
  },
  {
    patternName: 'Three Inside Up',
    formationDescription: "A three-candle bullish reversal: a Bullish Harami (a large bearish candle followed by a smaller bullish candle contained within its body) confirmed by a third bullish candle that closes above the first candle's open - turning the Harami's mere pause into a confirmed reversal.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Three Inside Up pattern?',
        answerText: "A Three Inside Up pattern is a Bullish Harami (a large bearish candle followed by a smaller bullish candle whose body sits entirely within the first candle's body) confirmed by a third bullish candle that closes above the first candle's open. That third candle is what turns the Harami's narrowing-into-indecision into an actual, confirmed reversal.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does the third candle in a Three Inside Up add that a bare Harami doesn\'t show?',
        answerText: "A bare Bullish Harami only shows selling momentum narrowing into indecision - it doesn't show buyers actually taking control. The third candle in a Three Inside Up does exactly that: by closing back above the first candle's own open, it erases the entire down-move that started the pattern, not just the smaller second candle's range. It's the difference between a pause and a genuine takeover.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'Is a Three Inside Up more reliable than a bare Bullish Harami?',
        answerText: "Yes - a Three Inside Up is considered meaningfully more reliable than a bare Bullish Harami precisely because it already includes the confirming candle that a standalone Harami is missing. Where a bare Harami is often described as needing a trader to \"wait for confirmation\" before acting, a Three Inside Up has that confirmation already built into the pattern itself, removing a large share of the false-positive risk.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Three Inside Up pattern?',
        answerText: "Because the confirming candle is already part of the pattern, a Three Inside Up is often used as a direct entry trigger on the third candle's close, rather than a wait-and-see signal the way a bare Harami is. A stop is commonly placed below the pattern's low - either the middle candle's low or the first candle's low, depending on how much room a trader wants to give the position.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Three Inside Up pattern?",
        answerText: "A common mistake is labeling a pattern \"Three Inside Up\" as soon as the Harami forms, before the third confirming candle has actually closed above the first candle's open. Without that third candle, it's still just an unconfirmed Bullish Harami - a materially weaker signal - and treating the two as interchangeable overstates how far along the reversal actually is.",
      },
    ],
  },
  {
    patternName: 'Three Inside Down',
    formationDescription: "The bearish mirror of Three Inside Up: a Bearish Harami (a large bullish candle followed by a smaller bearish candle contained within its body) confirmed by a third bearish candle that closes below the first candle's open.",
    relevantHorizons: ['mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Three Inside Down pattern?',
        answerText: "A Three Inside Down pattern is the bearish mirror of Three Inside Up: a Bearish Harami (a large bullish candle followed by a smaller bearish candle whose body sits entirely within the first candle's body) confirmed by a third bearish candle that closes below the first candle's open. That third candle turns the Harami's narrowing-into-indecision into a confirmed reversal.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does the third candle in a Three Inside Down add that a bare Harami doesn\'t show?',
        answerText: "A bare Bearish Harami only shows buying momentum narrowing into indecision - it doesn't show sellers actually taking control. The third candle in a Three Inside Down does exactly that: by closing back below the first candle's own open, it erases the entire up-move that started the pattern, not just the smaller second candle's range. It's the difference between a pause and a genuine takeover.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'Is a Three Inside Down more reliable than a bare Bearish Harami?',
        answerText: "Yes - a Three Inside Down is considered meaningfully more reliable than a bare Bearish Harami for the same reason its bullish counterpart is: the confirming candle a standalone Harami is missing is already part of the pattern. That removes a large share of the false-positive risk that comes with trading a bare Harami before it's actually confirmed.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Three Inside Down pattern?',
        answerText: "Because the confirming candle is already part of the pattern, a Three Inside Down is often used as a direct trigger to exit longs or initiate shorts on the third candle's close, rather than a wait-and-see signal the way a bare Harami is. A stop is commonly placed above the pattern's high - either the middle candle's high or the first candle's high, depending on how much room a trader wants to give the position.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Three Inside Down pattern?",
        answerText: "A common mistake is labeling a pattern \"Three Inside Down\" as soon as the Harami forms, before the third confirming candle has actually closed below the first candle's open. Without that third candle, it's still just an unconfirmed Bearish Harami - a materially weaker signal - and treating the two as interchangeable overstates how far along the reversal actually is.",
      },
    ],
  },
  {
    patternName: 'Three Outside Up',
    formationDescription: "A three-candle bullish continuation: a Bullish Engulfing pattern (a smaller bearish candle followed by a larger bullish candle covering its entire body) followed by a third bullish candle that closes even higher than the engulfing candle - a second consecutive session of confirmed buying.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Three Outside Up pattern?',
        answerText: "A Three Outside Up pattern is a Bullish Engulfing pattern (a smaller bearish candle followed by a larger bullish candle whose body completely covers the prior candle's body) followed by a third bullish candle that closes even higher than the engulfing candle's own close. It adds a second consecutive session of confirmed buying on top of the Engulfing pattern's already-decisive reversal.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does the third candle in a Three Outside Up add to a Bullish Engulfing pattern?',
        answerText: "A Bullish Engulfing pattern already shows buyers decisively overpowering sellers within a single session. The third candle in a Three Outside Up adds a second straight session where price closed even higher, showing that the reversal wasn't a one-session event - buying pressure carried through into the next session as well.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'Is a Three Outside Up more reliable than a bare Bullish Engulfing pattern?',
        answerText: "A Three Outside Up is generally read as more reliable than a bare Bullish Engulfing pattern, since it shows the reversal actually continuing into a second session rather than just occurring once. That said, the reliability gain here is smaller than the jump from a bare Harami to a Three Inside pattern, since a Bullish Engulfing pattern was already a fairly decisive signal on its own.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Three Outside Up pattern?',
        answerText: "A Three Outside Up is often used the same way a Bullish Engulfing pattern is - as an entry trigger for long positions - but with added confidence from the third candle's continued strength, since some traders use it to add to an existing position first taken on the Engulfing candle itself. A stop is commonly placed below the pattern's low, typically the first (engulfed) candle's low.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Three Outside Up pattern?",
        answerText: "A common mistake is assuming the third candle must engulf anything itself - it doesn't need to engulf the second candle's body, it only needs to close higher than the second candle's close. Requiring a second engulf is a misreading of the pattern and will cause genuine Three Outside Up formations to be missed.",
      },
    ],
  },
  {
    patternName: 'Three Outside Down',
    formationDescription: "The bearish mirror of Three Outside Up: a Bearish Engulfing pattern (a smaller bullish candle followed by a larger bearish candle covering its entire body) followed by a third bearish candle that closes even lower than the engulfing candle.",
    relevantHorizons: ['dayTrading', 'mediumTerm', 'longTerm'],
    complexityTier: 'Advanced',
    entries: [
      {
        category: 'Definition', tier: 101,
        questionText: 'What is a Three Outside Down pattern?',
        answerText: "A Three Outside Down pattern is the bearish mirror of Three Outside Up: a Bearish Engulfing pattern (a smaller bullish candle followed by a larger bearish candle whose body completely covers the prior candle's body) followed by a third bearish candle that closes even lower than the engulfing candle's own close. It adds a second consecutive session of confirmed selling on top of the Engulfing pattern's already-decisive reversal.",
      },
      {
        category: 'Interpretation', tier: 101,
        questionText: 'What does the third candle in a Three Outside Down add to a Bearish Engulfing pattern?',
        answerText: "A Bearish Engulfing pattern already shows sellers decisively overpowering buyers within a single session. The third candle in a Three Outside Down adds a second straight session where price closed even lower, showing that the reversal wasn't a one-session event - selling pressure carried through into the next session as well.",
      },
      {
        category: 'Reliability', tier: 201,
        questionText: 'Is a Three Outside Down more reliable than a bare Bearish Engulfing pattern?',
        answerText: "A Three Outside Down is generally read as more reliable than a bare Bearish Engulfing pattern, since it shows the reversal actually continuing into a second session rather than just occurring once. As with its bullish counterpart, the reliability gain is smaller than the jump from a bare Harami to a Three Inside pattern, since a Bearish Engulfing pattern was already a fairly decisive signal on its own.",
      },
      {
        category: 'How to Use', tier: 201,
        questionText: 'How do traders typically use a Three Outside Down pattern?',
        answerText: "A Three Outside Down is often used the same way a Bearish Engulfing pattern is - as a trigger to exit longs or initiate shorts - but with added confidence from the third candle's continued weakness, since some traders use it to add to an existing short first taken on the Engulfing candle itself. A stop is commonly placed above the pattern's high, typically the first (engulfed) candle's high.",
      },
      {
        category: 'Common Mistakes', tier: 201,
        questionText: "What's a common mistake with the Three Outside Down pattern?",
        answerText: "A common mistake is assuming the third candle must engulf anything itself - it doesn't need to engulf the second candle's body, it only needs to close lower than the second candle's close. Requiring a second engulf is a misreading of the pattern and will cause genuine Three Outside Down formations to be missed.",
      },
    ],
  },
];

// Optional CLI filter (e.g. `npm run seed:... -- "Three Inside Up" "Three Inside Down"`) - lets a
// round that only wants to go live with SOME of this file's already-drafted patterns do so without
// also pushing the rest (which may still lack chart detection, e.g. Tweezer Top/Bottom as of
// 2026-09-27) live prematurely. No args still seeds everything, unchanged from before.
const patternNameFilter = process.argv.slice(2);
const patternsToSeed = patternNameFilter.length > 0
  ? SEED_PATTERNS.filter((p) => patternNameFilter.includes(p.patternName))
  : SEED_PATTERNS;

async function seed(): Promise<void> {
  if (patternNameFilter.length > 0) {
    const unmatched = patternNameFilter.filter((n) => !SEED_PATTERNS.some((p) => p.patternName === n));
    if (unmatched.length > 0) {
      console.warn(`No SEED_PATTERNS entry found for: ${unmatched.join(', ')}`);
    }
  }

  let patternCount = 0;
  let entryCount = 0;

  for (const seedPattern of patternsToSeed) {
    // Upsert-by-name: safe to re-run after this file's content changes without duplicating
    // patterns, same idempotency contract as seedTickerData.ts's own ON CONFLICT upserts.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO m_candlestick_pattern (pattern_name, formation_description, is_day_trading, is_medium_term, is_long_term, complexity_tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pattern_name) DO UPDATE SET
         formation_description = excluded.formation_description,
         is_day_trading = excluded.is_day_trading,
         is_medium_term = excluded.is_medium_term,
         is_long_term = excluded.is_long_term,
         complexity_tier = excluded.complexity_tier,
         updated_at = now()
       RETURNING id`,
      [
        seedPattern.patternName, seedPattern.formationDescription,
        seedPattern.relevantHorizons.includes('dayTrading'),
        seedPattern.relevantHorizons.includes('mediumTerm'),
        seedPattern.relevantHorizons.includes('longTerm'),
        seedPattern.complexityTier,
      ],
    );
    const patternId = rows[0].id;
    patternCount += 1;

    for (const entry of seedPattern.entries) {
      // No natural unique key on (pattern, category, tier, question) exists yet - guard against
      // duplicate inserts on re-run by checking for an existing identical question first.
      const { rows: existing } = await pool.query(
        `SELECT id FROM m_candlestick_question_answer_entry WHERE pattern_id = $1 AND question_text = $2`,
        [patternId, entry.questionText],
      );
      if (existing.length > 0) {
        await pool.query(
          `UPDATE m_candlestick_question_answer_entry SET answer_text = $1, category = $2, tier = $3, updated_at = now() WHERE id = $4`,
          [entry.answerText, entry.category, entry.tier, existing[0].id],
        );
      } else {
        await pool.query(
          `INSERT INTO m_candlestick_question_answer_entry (pattern_id, category, tier, question_text, answer_text, status)
           VALUES ($1, $2, $3, $4, $5, 'Approved')`,
          [patternId, entry.category, entry.tier, entry.questionText, entry.answerText],
        );
      }
      entryCount += 1;
    }
  }

  console.log(`Seeded ${patternCount} patterns and ${entryCount} Q&A entries.`);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
