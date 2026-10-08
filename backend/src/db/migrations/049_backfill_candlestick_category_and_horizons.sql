-- Backfills the columns migration 048 added, kept as its own file/query (see 048's own comment)
-- so this DML never shares a batch with the DDL that creates the columns it reads/writes.

-- Backfilled from each pattern's current entries + domain judgment (single-bar signals read as
-- weaker standalone long-term-investing evidence; multi-day formations read as awkward framed
-- purely intraday) - reviewed and confirmed with the user before writing this migration.
UPDATE m_candlestick_pattern SET is_day_trading = true, is_medium_term = true
  WHERE pattern_name IN ('Doji', 'Hammer', 'Shooting Star');
UPDATE m_candlestick_pattern SET is_day_trading = true, is_medium_term = true, is_long_term = true
  WHERE pattern_name IN ('Bullish Engulfing', 'Bearish Engulfing');
UPDATE m_candlestick_pattern SET is_medium_term = true, is_long_term = true
  WHERE pattern_name IN ('Morning Star', 'Three White Soldiers');

-- Backfilled by re-reading each of the 11 existing entries' actual question text. Every other
-- existing entry ("What is X", "What does X indicate/suggest") is a Definition - already the
-- column's DEFAULT (migration 048), so no UPDATE needed for them.
UPDATE m_candlestick_question_answer_entry e SET category = 'Reliability'
  FROM m_candlestick_pattern p
  WHERE e.pattern_id = p.id AND p.pattern_name = 'Doji' AND e.tier = 201;
UPDATE m_candlestick_question_answer_entry e SET category = 'Interpretation'
  FROM m_candlestick_pattern p
  WHERE e.pattern_id = p.id AND p.pattern_name = 'Hammer' AND e.tier = 201;
UPDATE m_candlestick_question_answer_entry e SET category = 'How to Use'
  FROM m_candlestick_pattern p
  WHERE e.pattern_id = p.id AND p.pattern_name = 'Bullish Engulfing' AND e.tier = 301;
UPDATE m_candlestick_question_answer_entry e SET category = 'Interpretation'
  FROM m_candlestick_pattern p
  WHERE e.pattern_id = p.id AND p.pattern_name = 'Morning Star' AND e.tier = 301;
