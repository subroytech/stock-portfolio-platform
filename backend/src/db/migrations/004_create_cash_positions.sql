CREATE TABLE cash_positions (
  id           SERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL UNIQUE REFERENCES portfolios(id) ON DELETE CASCADE,
  amount       NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
