CREATE TABLE holdings (
  id             SERIAL PRIMARY KEY,
  portfolio_id   INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol         VARCHAR(15)  NOT NULL,
  name           VARCHAR(200),
  quantity       NUMERIC(18,6) NOT NULL,
  purchase_price NUMERIC(18,4) NOT NULL,
  current_price  NUMERIC(18,4) NOT NULL,
  sector         VARCHAR(50),
  purchase_date  DATE,
  cost_basis     NUMERIC(18,4) NOT NULL,
  current_value  NUMERIC(18,4) NOT NULL,
  gain_loss      NUMERIC(18,4) NOT NULL,
  return_pct     NUMERIC(10,4) NOT NULL,
  allocation_pct NUMERIC(7,4),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_holdings_portfolio_id ON holdings(portfolio_id);
CREATE INDEX idx_holdings_symbol ON holdings(symbol);
