-- Rename the core operational (user/portfolio-scoped) tables with a tx_
-- prefix, to pair with the m_ (master/reference) and sys_ (internal
-- bookkeeping) conventions. users is intentionally left unprefixed.
ALTER TABLE portfolios RENAME TO tx_portfolios;
ALTER TABLE holdings RENAME TO tx_holdings;
ALTER TABLE cash_positions RENAME TO tx_cash_positions;
ALTER TABLE uploads RENAME TO tx_uploads;
