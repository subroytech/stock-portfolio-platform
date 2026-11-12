-- Stock Analysis - Candlestick Charts (Phase 1). Shared, symbol+interval-keyed cache for
-- intraday OHLCV bars (5min/15min/30min/1hour/4hour) plus their precomputed technical
-- indicators, so every viewer of the same (symbol, time_interval) benefits from one real FMP
-- call instead of paying for their own - same shared-cache precedent as m_fmp_daily_cache
-- (migration 042), just with a time-based (10-minute) freshness rule instead of a calendar-day
-- one, since intraday bars turn over far faster than daily data. 1day candlesticks deliberately
-- reuse the EXISTING m_fmp_daily_cache/marketData.service.ts path - this table only covers the
-- new sub-daily intervals.
--
-- 1min was considered and dropped: live-verified against a real FMP account's stored key
-- (subrataroygcp@gmail.com) - GET /historical-chart/1min returns a genuine HTTP 402
-- ("Restricted Endpoint... not available under your current subscription"), confirmed via raw
-- fetch (not just this app's 402-collapses-to-null wrapper) and confirmed not a market-hours
-- artifact (an explicit past-date range got the identical 402). 5min/15min/30min/1hour/4hour all
-- confirmed live with real OHLCV data.
--
-- `interval` avoided as a column name since it collides with CockroachDB's own INTERVAL type -
-- `time_interval` instead. `bars`/`indicators` are both JSONB rather than normalized rows, same
-- precedent as m_fmp_daily_cache's own api_result column - a whole bar series (or indicator
-- series) is always read/written as one unit, never queried bar-by-bar.
--
-- Priority backlog item (not built this phase): row deletion/retention here needs a nuanced,
-- interval-aware policy to manage DB size - e.g. 5min/15min rows likely need pruning far sooner
-- than 1hour/4hour rows, since a stale 5-minute bar from weeks ago has little ongoing use. No TTL
-- or sweep job exists yet; this table grows unbounded (one row per (symbol, time_interval) ever
-- looked up, upserted in place) until that's designed.
CREATE TABLE m_stock_ticker_candlestick_cache (
  symbol VARCHAR(20) NOT NULL,
  time_interval VARCHAR(10) NOT NULL,
  bars JSONB NOT NULL,
  indicators JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, time_interval)
);

-- Backs listCachedSymbols() - newest-activity-first across every cached symbol.
CREATE INDEX idx_stock_ticker_candlestick_cache_updated_at ON m_stock_ticker_candlestick_cache(updated_at DESC);

-- Config Properties: per-user rate limit defaults on real (cache-miss) candlestick fetches - one
-- total budget across every symbol/interval combined (see candlestick.service.ts), admin-tunable
-- with zero code change via the already-generic ConfigPropertiesPage.tsx. Same 3-block seed
-- pattern as migration 027/029 (insert group -> insert property -> insert its initial value).
INSERT INTO m_config_group (name, description)
VALUES ('Stock Analysis Rate Limits', 'Per-user limits on real (non-cached) candlestick data fetches in the Stock Analysis tab.');

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'stock_analysis_candlestick_max_new_requests', 'Candlestick Max New Requests',
       'Maximum number of real (cache-miss) candlestick fetches a single user may make within the configured window - one shared budget across every symbol and timeframe combined, not scoped per symbol/interval.',
       'integer', '1', NULL, 'active'
FROM m_config_group WHERE name = 'Stock Analysis Rate Limits';

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'stock_analysis_candlestick_window_minutes', 'Candlestick Rate Limit Window (Minutes)',
       'The rolling window, in minutes, over which stock_analysis_candlestick_max_new_requests is enforced.',
       'integer', '1', NULL, 'active'
FROM m_config_group WHERE name = 'Stock Analysis Rate Limits';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, '10', 1, true, NULL
FROM m_config_property WHERE property_key = 'stock_analysis_candlestick_max_new_requests';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, '10', 1, true, NULL
FROM m_config_property WHERE property_key = 'stock_analysis_candlestick_window_minutes';
