-- Rename the candlestick pattern complexity tier value 'Complex' -> 'Composite' (2026-09-28,
-- explicit user direction, confirmed via AskUserQuestion to apply everywhere the tier concept
-- appears, not just the chart page's own labels). Data only, no DDL - complexity_tier stays
-- VARCHAR(10) (migration 050), which already fits "Composite" (9 chars). "Composite" better
-- describes what these 2-candle patterns actually are - a smaller candle's geometry composed
-- against a larger one - than "Complex" did.
UPDATE m_candlestick_pattern SET complexity_tier = 'Composite', updated_at = now()
WHERE complexity_tier = 'Complex';
