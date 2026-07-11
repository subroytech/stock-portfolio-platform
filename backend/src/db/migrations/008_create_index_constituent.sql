CREATE TABLE index_constituent (
  id       SERIAL PRIMARY KEY,
  index_id VARCHAR(10) NOT NULL REFERENCES index_master(index_id) ON DELETE CASCADE,
  symbol   VARCHAR(15) NOT NULL,
  UNIQUE (index_id, symbol)
);

CREATE INDEX idx_index_constituent_symbol ON index_constituent(symbol);
