-- Renames the two "Stock Analysis Rate Limits" Config Property display names ahead of the
-- planned all-encompassing rate limit (Backlog item, deep-percolating-pike.md plan) - that work
-- will widen this same per-user budget to cover stock_preview/momentum/long_term_analysis/
-- contrarian_comeback too, not just candlestick, so the label is being generalized now rather
-- than left saying "Candlestick" and needing a second rename later. property_key stays
-- unchanged (immutable per the Config Properties framework's own design - candlestick.service.ts
-- still reads `stock_analysis_candlestick_max_new_requests`/`_window_minutes` by key); only the
-- admin-facing display `name` changes. description text is untouched for now - it still
-- accurately describes today's candlestick-only enforcement, and will be revisited when the
-- actual all-encompassing enforcement logic is built.
UPDATE m_config_property SET name = 'User''s Max New Requests', updated_at = now()
WHERE property_key = 'stock_analysis_candlestick_max_new_requests';

UPDATE m_config_property SET name = 'User''s API Rate Limit Window (Minutes)', updated_at = now()
WHERE property_key = 'stock_analysis_candlestick_window_minutes';
