-- Backfill for migration 054's six new columns (2026-10-04). Data only, no DDL - see migration
-- 054's own header (and 048's/050's) for why the schema change and its backfill are split
-- across two files rather than batched into one.
--
-- Every value below was derived from this codebase's OWN detection code
-- (candlestickComplexPatternDetection.ts) wherever the question is a factual one - requires_gap
-- in particular is not a judgment call: Piercing Line/Dark Cloud Cover check
-- `curr.open < prev.low` / `curr.open > prev.high` (a genuine wick-to-wick gap), Kicking checks
-- `curr.low > prev.high` / `curr.high < prev.low` (zero range overlap), and Abandoned Baby
-- checks `b.high < a.low` / `b.low > a.high` (gaps on both sides of the middle candle) - all
-- real gaps. Morning/Evening Star's own gap check (`max(b.open,b.close) < a.close`) is
-- deliberately weaker (body-level, not wick-to-wick), which is exactly what distinguishes it
-- from Abandoned Baby - so Morning/Evening Star is requires_gap = false here, on purpose.
--
-- signal_type/directional_bias/trend_context are genuine domain judgment calls, not derivable
-- from code - standard candlestick-charting teaching was used, grouped by identical values to
-- keep this file auditable rather than repeating near-identical rows 34 times. Two calls are
-- flagged as the least certain and worth a second look:
--   - Marubozu and Belt Hold are given signal_type = 'continuation' (the dominant textbook
--     framing: a long, convicted candle confirming/continuing the existing move) even though
--     both can also mark a trend-exhaustion reversal depending on where they appear - genuinely
--     more context-flexible than any other pattern here. Revisit if this doesn't feel right.
--   - synonyms deliberately EXCLUDES "Pin Bar" (ambiguous in modern price-action trading between
--     Hammer/Shooting Star/Hanging Man without trend context - including it on just one would
--     have been misleading) and "Inverted Hammer"/"Mat Hold" (these name genuinely distinct,
--     unimplemented patterns in standard teaching, not true synonyms of anything built here).

-- ---- Group A: pure indecision, no directional lean, no trend requirement ----
UPDATE m_candlestick_pattern SET signal_type = 'indecision', directional_bias = 'neutral', requires_gap = false, trend_context = 'either', updated_at = now()
WHERE pattern_name IN ('Doji', 'Spinning Top', 'Doji-LongLegged');

-- ---- Group B: conviction/momentum candles whose direction depends entirely on which candle
-- they're attached to (see the flagged signal_type note above) ----
UPDATE m_candlestick_pattern SET signal_type = 'continuation', directional_bias = 'context-dependent', requires_gap = false, trend_context = 'either', updated_at = now()
WHERE pattern_name IN ('Marubozu', 'Belt Hold');

-- ---- Group C: bullish reversal signals, no gap required, meaningful after a prior downtrend ----
UPDATE m_candlestick_pattern SET signal_type = 'reversal', directional_bias = 'bullish', requires_gap = false, trend_context = 'prior-downtrend', updated_at = now()
WHERE pattern_name IN (
  'Hammer', 'Bullish Engulfing', 'Morning Star', 'Three White Soldiers', 'Bullish Harami',
  'Doji-Dragonfly', 'Tweezer Bottom', 'Three Inside Up', 'Three Outside Up'
);

-- ---- Group D: bearish reversal signals, no gap required, meaningful after a prior uptrend.
-- Hanging Man is deliberately included here (same metadata as its geometric twin Hammer's
-- mirror group) even though it shares Hammer's own exact shape - the trend context is what
-- makes it Hanging Man rather than Hammer, which is precisely this field's point. ----
UPDATE m_candlestick_pattern SET signal_type = 'reversal', directional_bias = 'bearish', requires_gap = false, trend_context = 'prior-uptrend', updated_at = now()
WHERE pattern_name IN (
  'Bearish Engulfing', 'Shooting Star', 'Hanging Man', 'Evening Star', 'Bearish Harami',
  'Three Black Crows', 'Doji-Gravestone', 'Tweezer Top', 'Three Inside Down', 'Three Outside Down'
);

-- ---- Group F: bullish reversal signals that DO require a genuine gap (confirmed in detection
-- code - see header) ----
UPDATE m_candlestick_pattern SET signal_type = 'reversal', directional_bias = 'bullish', requires_gap = true, trend_context = 'prior-downtrend', updated_at = now()
WHERE pattern_name IN ('Piercing Line', 'Bullish Kicking', 'Bullish Abandoned Baby');

-- ---- Group G: bearish reversal signals that DO require a genuine gap ----
UPDATE m_candlestick_pattern SET signal_type = 'reversal', directional_bias = 'bearish', requires_gap = true, trend_context = 'prior-uptrend', updated_at = now()
WHERE pattern_name IN ('Dark Cloud Cover', 'Bearish Kicking', 'Bearish Abandoned Baby');

-- ---- Groups H-K: the four continuation patterns, each singular in its exact combination ----
UPDATE m_candlestick_pattern SET signal_type = 'continuation', directional_bias = 'bullish', requires_gap = true, trend_context = 'prior-uptrend', updated_at = now()
WHERE pattern_name = 'Upside Tasuki Gap';

UPDATE m_candlestick_pattern SET signal_type = 'continuation', directional_bias = 'bearish', requires_gap = true, trend_context = 'prior-downtrend', updated_at = now()
WHERE pattern_name = 'Downside Tasuki Gap';

UPDATE m_candlestick_pattern SET signal_type = 'continuation', directional_bias = 'bullish', requires_gap = false, trend_context = 'prior-uptrend', updated_at = now()
WHERE pattern_name = 'Rising Three Methods';

UPDATE m_candlestick_pattern SET signal_type = 'continuation', directional_bias = 'bearish', requires_gap = false, trend_context = 'prior-downtrend', updated_at = now()
WHERE pattern_name = 'Falling Three Methods';

-- ---- Synonyms - deliberately sparse, only genuinely-unambiguous alternate names (see header
-- for what was considered and excluded) ----
UPDATE m_candlestick_pattern SET synonyms = '["Inside Bar"]'::JSONB, updated_at = now()
WHERE pattern_name IN ('Bullish Harami', 'Bearish Harami');

UPDATE m_candlestick_pattern SET synonyms = '["Island Reversal"]'::JSONB, updated_at = now()
WHERE pattern_name IN ('Bullish Abandoned Baby', 'Bearish Abandoned Baby');

UPDATE m_candlestick_pattern SET synonyms = '["Dragonfly Doji"]'::JSONB, updated_at = now()
WHERE pattern_name = 'Doji-Dragonfly';

UPDATE m_candlestick_pattern SET synonyms = '["Gravestone Doji"]'::JSONB, updated_at = now()
WHERE pattern_name = 'Doji-Gravestone';

UPDATE m_candlestick_pattern SET synonyms = '["Long-Legged Doji"]'::JSONB, updated_at = now()
WHERE pattern_name = 'Doji-LongLegged';

UPDATE m_candlestick_pattern SET synonyms = '["Opening Marubozu"]'::JSONB, updated_at = now()
WHERE pattern_name = 'Belt Hold';

-- ---- Mirror pattern pairs - one statement covering both directions of all 14 pairs, via a
-- VALUES list rather than 28 near-duplicate UPDATEs, so the pairing itself stays auditable in
-- one place. Hammer/Hanging Man and Hammer/Shooting Star are NOT the same relationship - Hammer
-- mirrors Shooting Star (opposite shape, opposite direction); Hanging Man shares Hammer's own
-- exact shape (same shape, different context) and is deliberately left unmirrored here, per
-- migration 054's own header note. Doji (plain), Doji-LongLegged, Marubozu, Spinning Top, and
-- Belt Hold have no directional counterpart and are likewise left unmirrored (mirror_pattern_id
-- stays its default NULL for all of these).
UPDATE m_candlestick_pattern t
SET mirror_pattern_id = m.id, updated_at = now()
FROM m_candlestick_pattern m,
     (VALUES
       ('Hammer', 'Shooting Star'),
       ('Shooting Star', 'Hammer'),
       ('Doji-Dragonfly', 'Doji-Gravestone'),
       ('Doji-Gravestone', 'Doji-Dragonfly'),
       ('Bullish Engulfing', 'Bearish Engulfing'),
       ('Bearish Engulfing', 'Bullish Engulfing'),
       ('Morning Star', 'Evening Star'),
       ('Evening Star', 'Morning Star'),
       ('Bullish Harami', 'Bearish Harami'),
       ('Bearish Harami', 'Bullish Harami'),
       ('Piercing Line', 'Dark Cloud Cover'),
       ('Dark Cloud Cover', 'Piercing Line'),
       ('Three White Soldiers', 'Three Black Crows'),
       ('Three Black Crows', 'Three White Soldiers'),
       ('Tweezer Bottom', 'Tweezer Top'),
       ('Tweezer Top', 'Tweezer Bottom'),
       ('Bullish Kicking', 'Bearish Kicking'),
       ('Bearish Kicking', 'Bullish Kicking'),
       ('Three Inside Up', 'Three Inside Down'),
       ('Three Inside Down', 'Three Inside Up'),
       ('Three Outside Up', 'Three Outside Down'),
       ('Three Outside Down', 'Three Outside Up'),
       ('Bullish Abandoned Baby', 'Bearish Abandoned Baby'),
       ('Bearish Abandoned Baby', 'Bullish Abandoned Baby'),
       ('Upside Tasuki Gap', 'Downside Tasuki Gap'),
       ('Downside Tasuki Gap', 'Upside Tasuki Gap'),
       ('Rising Three Methods', 'Falling Three Methods'),
       ('Falling Three Methods', 'Rising Three Methods')
     ) AS pairs(name, mirror_name)
WHERE t.pattern_name = pairs.name AND m.pattern_name = pairs.mirror_name;
