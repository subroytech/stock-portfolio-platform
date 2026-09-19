-- Persists the day's dollar/percent change per holding (previously computed
-- transiently from FMP's quote during refreshPrices() and only ever held in
-- the refresh-prices mutation response, never written to a column) - so
-- GET /portfolios/:id can return it too, letting the Dashboard's Today's-$
-- views work off DB-persisted, portfolio-scoped data instead of in-memory
-- state that doesn't survive switching portfolios or reloading the page.
ALTER TABLE tx_holdings ADD COLUMN today_change_dollar NUMERIC;
ALTER TABLE tx_holdings ADD COLUMN today_change_percent NUMERIC;
