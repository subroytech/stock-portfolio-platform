CREATE TABLE tickers (
  symbol      VARCHAR(15) PRIMARY KEY,
  name        VARCHAR(200),
  sector      VARCHAR(50),
  is_etf      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
