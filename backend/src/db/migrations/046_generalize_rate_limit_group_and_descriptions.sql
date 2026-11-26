-- Closes the loop on migration 045's display-name rename: that migration renamed the two
-- Config Property *names* to "User's Max New Requests"/"User's API Rate Limit Window (Minutes)"
-- in anticipation of the all-encompassing combined rate limit (deep-percolating-pike.md plan),
-- which is now built - the shared budget (fmpRateLimit.service.ts) covers Candlestick, Stock
-- Preview, Momentum, Long-Term Analysis, and Contrarian Comeback together, with admin/
-- admin-master fully exempt. The Config Property *group* and both properties' *descriptions*
-- still said "candlestick" only, which is now misleading - updated to describe the real,
-- current scope. property_key stays unchanged (immutable, still read by string in
-- fmpRateLimit.service.ts).
UPDATE m_config_group
SET name = 'Combined API Rate Limits',
    description = 'Per-user limit on real (non-cached) FMP/Finnhub calls, shared across the Candlestick, Stock Preview, Momentum, Long-Term Analysis, and Contrarian Comeback features. admin and admin-master are fully exempt.'
WHERE name = 'Stock Analysis Rate Limits';

UPDATE m_config_property
SET description = 'Maximum number of real (non-cached) FMP/Finnhub calls a single user may make within the configured window, combined across Candlestick, Stock Preview, Momentum, Long-Term Analysis, and Contrarian Comeback - one shared budget, not scoped per feature. admin and admin-master are exempt from this limit entirely.'
WHERE property_key = 'stock_analysis_candlestick_max_new_requests';

UPDATE m_config_property
SET description = 'The rolling window, in minutes, over which stock_analysis_candlestick_max_new_requests is enforced - shared across Candlestick, Stock Preview, Momentum, Long-Term Analysis, and Contrarian Comeback.'
WHERE property_key = 'stock_analysis_candlestick_window_minutes';
