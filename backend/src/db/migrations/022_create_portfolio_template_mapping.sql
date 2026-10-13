-- Portfolio Upload - Flex, Phase 1 (CLAUDE.md's "Portfolio Upload - Flex" section has the
-- full narrative behind every decision below).
--
-- m_ prefix: these are master-data-shaped (a fixed catalog every user picks from), but also
-- grown by live user activity rather than a one-time seed - the same characteristic that
-- already justifies m_tickers' m_ prefix, so no new bucket/exception needed here.
CREATE TABLE m_portfolio_template_mapping_master (
  id              INT8 PRIMARY KEY DEFAULT unique_rowid(),
  template_name   VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'Pending Approval', -- 'Pending Approval'|'Approved'|'Rejected'
  created_by      INT8 REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by     INT8 REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  -- Top-5-mapped-records snapshot captured at "Inspect Data" time - lets an admin judge a
  -- Pending template later without needing the original file re-uploaded.
  sample_preview  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX m_portfolio_template_mapping_master_name_key ON m_portfolio_template_mapping_master (template_name);

-- One row per mapped field within a template. target_field is the app's fixed portfolio
-- field name (symbol/quantity/currentPrice/purchasePrice/name/sector/purchaseDate) -
-- app-enforced vocabulary, not a DB enum, same convention as other free-text fields in this
-- schema. source_header is the uploaded file's actual header text, normalized the same way
-- parser.service.ts's mapHeaders() already normalizes - resilient to column reordering on a
-- later upload against the same template.
CREATE TABLE m_portfolio_template_mapping_dtls (
  id            INT8 PRIMARY KEY DEFAULT unique_rowid(),
  template_id   INT8 NOT NULL REFERENCES m_portfolio_template_mapping_master(id) ON DELETE CASCADE,
  target_field  VARCHAR(50) NOT NULL,
  source_header VARCHAR(200) NOT NULL,
  UNIQUE (template_id, target_field)
);
