-- Contrarian Finder / Portfolio sector sync (2026-11-06).
--
-- A new m_index_master row to hold tx_holdings symbols that are genuinely held in a user
-- portfolio but aren't part of any of the 4 curated sources (DJ30/NDX100/SP500-top-400/11 SPDR
-- ETFs). Grown over time by syncHeldSymbolsToUniverse() (contrarianFinder.service.ts), not by
-- seedTickerData.ts - the only index_master row the running app itself ever writes into
-- m_index_constituent, as opposed to the one-time seed script.
--
-- index_id keeps the existing "short code" shape (DJ30, NDX100, SP500, XLK...) even though it
-- isn't a real market index/ETF ticker - a deliberate, flagged exception, the only synthetic
-- bucket allowed in this table.
INSERT INTO m_index_master (index_id, index_description) VALUES
  ('USER_HELD', 'Symbols held in a user portfolio, not in any curated index/ETF source');
