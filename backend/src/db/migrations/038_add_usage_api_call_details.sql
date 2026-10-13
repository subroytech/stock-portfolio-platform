-- Usage Audit - API-call detail (Phase 1), 2026-09-05. user_evt_usage/user_evt_usage_summary_monthly
-- have been write-only since they were created (migration 015) - event_count only tracks how many
-- times a feature was *invoked*, which badly understates real external API volume for the heaviest
-- features (one "Refresh Prices" click is many FMP calls, logged today as portfolio_refresh: 1).
--
-- This migration is schema-only: api_call_details stays NULL on every row until a later phase wires
-- logUsage() and a daily aggregation job to populate it. event_count's existing real-time semantics
-- are untouched.

ALTER TABLE user_evt_usage ADD COLUMN api_call_details JSONB;
ALTER TABLE user_evt_usage_summary_monthly ADD COLUMN api_call_details JSONB;

-- sys_ bucket (SCHEMA.md) - internal bookkeeping, not app/business data, same category as
-- sys_schema_migrations. Single-row table tracking how far the (not-yet-built) daily aggregation
-- job has progressed, so it can be gated to run at most once every 24h regardless of login volume.
CREATE TABLE sys_usage_aggregation_watermark (
  id                  INT2 PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_aggregated_at  TIMESTAMPTZ NOT NULL DEFAULT '2000-01-01'
);
INSERT INTO sys_usage_aggregation_watermark (id) VALUES (1);
