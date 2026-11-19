-- Shared, symbol-level daily FMP cache, 2026-09-07. Most of Long-Term Analysis's 17 FMP calls
-- return data that's effectively static for a full US trading day (financials, peer lists,
-- analyst ratings/targets/estimates, company identity fields) - only live quote genuinely needs
-- to be fresh, and only while the market is open. One row per (symbol, api_name) at all times -
-- a new day's fetch UPSERTs over the prior day's row rather than keeping history.
--
-- Symbol-keyed, not per-user - this is pure market data, identical no matter who fetched it, so
-- the first person to look up a symbol on a given day pays the real FMP cost for its cacheable
-- calls; everyone else looking up that same symbol that same day pays nothing for them.
--
-- Deliberately generic (not "long_term_analysis_cache") - Contrarian Comeback shares 4 of the
-- same endpoints (profile/quote/price-target-consensus/grades) and is the explicitly-planned
-- next phase to route through this same table, though its own code isn't touched yet.
CREATE TABLE m_fmp_daily_cache (
  symbol                VARCHAR(20) NOT NULL,
  api_name              VARCHAR(50) NOT NULL,
  api_call_description  VARCHAR(255),
  cache_date            DATE NOT NULL,
  api_result            JSONB NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, api_name)
);
