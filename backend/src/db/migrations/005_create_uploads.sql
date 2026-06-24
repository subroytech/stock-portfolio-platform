CREATE TABLE uploads (
  id              SERIAL PRIMARY KEY,
  portfolio_id    INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  filename        VARCHAR(255),
  source_format   VARCHAR(30),
  rows_parsed     INTEGER NOT NULL DEFAULT 0,
  rows_skipped    INTEGER NOT NULL DEFAULT 0,
  errors          JSONB,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_uploads_portfolio_id ON uploads(portfolio_id);
