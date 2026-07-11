-- Rename reference/master-data tables with an m_ prefix to distinguish them
-- from transactional tables (users, portfolios, holdings, ...).
ALTER TABLE tickers RENAME TO m_tickers;
ALTER TABLE index_master RENAME TO m_index_master;
ALTER TABLE index_constituent RENAME TO m_index_constituent;
