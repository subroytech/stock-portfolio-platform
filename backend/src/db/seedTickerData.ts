// One-time port of the hardcoded reference data in db/seed/*.ts into their
// DB-table equivalents (m_index_master, m_index_constituent, m_tickers).
// Idempotent via ON CONFLICT upserts - safe to re-run after the source files change.

import { pool } from './pool';
import { CF_ETF_LIST, CF_STATIC } from './seed/cf_static_universe';
import { TICKER_SECTORS } from './seed/ticker_sectors';

const INDEX_DESCRIPTIONS: Record<string, string> = {
  DJ30: 'Dow Jones Industrial Average',
  NDX100: 'Nasdaq-100 Index',
  SP500: 'S&P 500 Index',
  XLK: 'Technology Select Sector SPDR Fund',
  XLV: 'Health Care Select Sector SPDR Fund',
  XLF: 'Financial Select Sector SPDR Fund',
  XLY: 'Consumer Discretionary Select Sector SPDR Fund',
  XLI: 'Industrial Select Sector SPDR Fund',
  XLC: 'Communication Services Select Sector SPDR Fund',
  XLP: 'Consumer Staples Select Sector SPDR Fund',
  XLE: 'Energy Select Sector SPDR Fund',
  XLB: 'Materials Select Sector SPDR Fund',
  XLU: 'Utilities Select Sector SPDR Fund',
  XLRE: 'Real Estate Select Sector SPDR Fund',
};

export async function seedIndexMaster(): Promise<void> {
  const entries = Object.entries(INDEX_DESCRIPTIONS);
  const values = entries.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = entries.flat();
  await pool.query(
    `INSERT INTO m_index_master (index_id, index_description) VALUES ${values}
     ON CONFLICT (index_id) DO UPDATE SET index_description = excluded.index_description`,
    params,
  );
  console.log(`m_index_master: seeded ${entries.length} rows`);
}

async function upsertConstituents(indexId: string, symbols: string[]): Promise<number> {
  const unique = [...new Set(symbols.map((s) => s.toString().toUpperCase().trim()))];
  if (unique.length === 0) return 0;
  const values = unique.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = unique.flatMap((symbol) => [indexId, symbol]);
  await pool.query(
    `INSERT INTO m_index_constituent (index_id, symbol) VALUES ${values}
     ON CONFLICT (index_id, symbol) DO NOTHING`,
    params,
  );
  return unique.length;
}

export async function seedIndexConstituents(): Promise<void> {
  const groups: Record<string, string[]> = {
    DJ30: CF_STATIC.dj30,
    NDX100: CF_STATIC.ndx100,
    SP500: CF_STATIC.sp500,
    ...Object.fromEntries(CF_ETF_LIST.map((etf) => [etf, CF_STATIC.etf[etf] || []])),
  };
  let total = 0;
  for (const [indexId, symbols] of Object.entries(groups)) {
    total += await upsertConstituents(indexId, symbols);
  }
  console.log(`m_index_constituent: seeded ${total} unique (index, symbol) rows`);
}

export async function seedTickers(): Promise<void> {
  const entries = Object.entries(TICKER_SECTORS);
  const values = entries.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = entries.flat();
  await pool.query(
    `INSERT INTO m_tickers (symbol, sector) VALUES ${values}
     ON CONFLICT (symbol) DO UPDATE SET sector = excluded.sector, updated_at = now()`,
    params,
  );
  console.log(`m_tickers: seeded ${entries.length} rows`);
}

export async function seedAll(): Promise<void> {
  await seedIndexMaster();
  await seedIndexConstituents();
  await seedTickers();
}

if (require.main === module) {
  seedAll()
    .then(() => {
      console.log('Seed complete.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Seed failed:', err.message);
      return pool.end().finally(() => process.exit(1));
    });
}
