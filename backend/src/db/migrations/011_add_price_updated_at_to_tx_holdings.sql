-- Tracks when each holding's current_price was last refreshed via
-- POST /portfolios/:id/refresh-prices. Per-holding (not per-portfolio) since
-- a refresh can partially fail - marketData.getQuotes() tolerates individual
-- symbol failures, and only holdings that got a real quote should claim to
-- be fresh.
ALTER TABLE tx_holdings ADD COLUMN price_updated_at TIMESTAMPTZ;
