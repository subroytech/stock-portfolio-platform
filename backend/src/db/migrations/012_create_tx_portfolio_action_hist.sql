-- Buy/sell history, populated by diffing a portfolio's holdings against the
-- previous snapshot on every POST /portfolios/:id/import. One row per symbol
-- whose quantity changed (delta > 0 -> BUY, delta < 0 -> SELL); unchanged
-- symbols produce no row.
CREATE TABLE tx_portfolio_action_hist (
  id               SERIAL PRIMARY KEY,
  portfolio_id     INTEGER NOT NULL REFERENCES tx_portfolios(id) ON DELETE CASCADE,
  symbol           VARCHAR(15) NOT NULL,
  action_type      VARCHAR(4) NOT NULL,
  quantity_delta   NUMERIC(18,6) NOT NULL,
  price            NUMERIC(18,4) NOT NULL,
  action_date_time TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_action_hist_portfolio_id ON tx_portfolio_action_hist(portfolio_id);
