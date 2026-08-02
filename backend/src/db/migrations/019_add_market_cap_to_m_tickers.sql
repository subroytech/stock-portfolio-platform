-- market_cap joins name/sector as a field m_tickers tracks per symbol,
-- populated the same two ways: portfolio.service.ts's importHoldings() and
-- backfillTickerData.ts / the new refreshTickerDataBatch() ("Run Scan (+ Mkt
-- Cap)" and the Admin Console's Master Data Delta Update). Bare NUMERIC (no
-- precision spec) - market cap needs no sub-unit precision, unlike the
-- original table's cent-precision currency columns.
ALTER TABLE m_tickers ADD COLUMN market_cap NUMERIC;
