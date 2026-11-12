-- Backfill for migration 050's complexity_tier column (2026-09-27). Data only, no DDL - see
-- migration 050's own header (and 048's) for why the schema change and its backfill are split
-- across two files rather than batched into one.
--
-- Every row already defaults to 'Simple' from 050's own column default, so only the 2-candle and
-- 3-candle patterns need correcting here. Listed by name rather than id because pattern_name is
-- the table's own unique key and is what every other part of this system (the seed file, the
-- frontend's PATTERN_LABELS) already keys on by hand-maintained convention.
--
-- Complex = 2 candles. These are all pairs where the second candle is read against the first:
-- Engulfing (curr's body covers prev's), Piercing Line/Dark Cloud Cover (curr recovers past prev's
-- midpoint without fully engulfing), Harami (curr's body sits inside prev's).
UPDATE m_candlestick_pattern SET complexity_tier = 'Complex', updated_at = now()
WHERE pattern_name IN (
  'Bullish Engulfing',
  'Bearish Engulfing',
  'Piercing Line',
  'Dark Cloud Cover',
  'Bullish Harami',
  'Bearish Harami'
);

-- Advanced = 3 candles. Morning/Evening Star (long candle, small gapped candle, long reversal
-- candle) and Three White Soldiers/Three Black Crows (three consecutive same-direction candles).
-- These 4 were previously grouped with the 2-candle patterns above in the chart's own
-- COMPLEX_PATTERN_KEYS - this migration is what splits them out into their own tier.
UPDATE m_candlestick_pattern SET complexity_tier = 'Advanced', updated_at = now()
WHERE pattern_name IN (
  'Morning Star',
  'Evening Star',
  'Three White Soldiers',
  'Three Black Crows'
);

-- Everything else (Doji + its 3 sub-types, Hammer, Shooting Star, Marubozu, Spinning Top, Belt
-- Hold, Hanging Man) is a genuine single-candle pattern and correctly keeps 'Simple'.
--
-- Tweezer Bottom/Top (Complex) and Three Inside/Outside Up/Down (Advanced) are deliberately absent
-- here - their curated content is drafted in seedCandlestickQuestionAnswer.ts but has not been
-- seeded into this database yet, so there are no rows to update. The seed file carries their
-- complexityTier values for whenever that seeding actually happens.
