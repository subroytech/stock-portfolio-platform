// One-time (re-runnable) sync: m_tickers is the single source of truth for
// ticker name/sector/market_cap (confirmed 2026-08-02 - not duplicated onto
// m_index_constituent). This script is the "at seed/backfill time" side of
// keeping m_tickers current with the scan universe - the other paths are
// portfolio.service.ts's importHoldings() (inserts a bare row for any symbol
// a real CSV import introduces that m_tickers doesn't know yet) and
// contrarianFinder.service.ts's refreshTickerDataBatch() ("Run Scan (+ Mkt
// Cap)" and the Admin Console's Master Data Delta Update).
//
// Confirmed live 2026-08-02: m_tickers.name was 0/218 populated, and 208 of
// the universe's 348 symbols had no m_tickers row at all (m_tickers and
// m_index_constituent are two independently hand-typed datasets ported from
// different source-app files, never in sync). Idempotent upsert, same
// pattern as seedTickerData.ts - safe to re-run.
//
// Needs a real FMP API key as a command-line arg (this is a one-off
// maintenance script, not a live request path, so there's no user session to
// resolve a stored key from): `npm run backfill:ticker-data -- <fmp-key>`.

import { pool } from './pool';
import { getProfiles } from '../services/marketData.service';

async function getUniverseSymbols(): Promise<string[]> {
  const { rows } = await pool.query<{ symbol: string }>('SELECT DISTINCT symbol FROM m_index_constituent ORDER BY symbol');
  return rows.map((r) => r.symbol);
}

async function upsertTickerData(profiles: Record<string, { name: string; sector: string; marketCap: number | null }>): Promise<number> {
  const entries = Object.entries(profiles).filter(([, p]) => p.name || p.sector || p.marketCap != null);
  if (entries.length === 0) return 0;
  const values = entries.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');
  const params = entries.flatMap(([symbol, p]) => [symbol, p.name || null, p.sector || null, p.marketCap]);
  await pool.query(
    `INSERT INTO m_tickers (symbol, name, sector, market_cap) VALUES ${values}
     ON CONFLICT (symbol) DO UPDATE SET
       name = COALESCE(excluded.name, m_tickers.name),
       sector = COALESCE(excluded.sector, m_tickers.sector),
       market_cap = COALESCE(excluded.market_cap, m_tickers.market_cap),
       updated_at = now()`,
    params,
  );
  return entries.length;
}

export async function backfillTickerData(apiKey: string): Promise<void> {
  const symbols = await getUniverseSymbols();
  console.log(`Fetching name/sector/market cap for ${symbols.length} symbols from FMP...`);

  const profiles = await getProfiles(symbols, apiKey);
  const updated = await upsertTickerData(profiles);
  console.log(`m_tickers: synced ${updated} symbols (${symbols.length - updated} had no profile data returned by FMP)`);
}

if (require.main === module) {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Usage: npm run backfill:ticker-data -- <fmp-api-key>');
    process.exit(1);
  }
  backfillTickerData(apiKey)
    .then(() => {
      console.log('Backfill complete.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Backfill failed:', err.message);
      return pool.end().finally(() => process.exit(1));
    });
}
