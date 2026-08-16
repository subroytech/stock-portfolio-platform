// Portfolio CRUD + CSV/TXT import (reusing parser.service.ts as-is) + live-price
// refresh (reusing marketData.service.ts/livePrices.service.ts as-is). Decided
// 2026-07-12 (see Architecture.md Section 2 / the portfolio-CRUD plan).

import { pool } from '../db/pool';
import * as marketData from './marketData.service';
import type { HistoricalBar, Quote } from './marketData.service';
import * as userSubscription from './userSubscription.service';
import { applyLivePrices, HoldingLike } from './livePrices.service';
import { ParseResult } from './parser.service';
import { parseFlexCsv, ColumnMapping } from './flexParser.service';
import * as portfolioTemplateService from './portfolioTemplate.service';

// Matches an already-pair-formatted symbol (BTCUSD, BTC-USD, a USDT pair) -
// shared by isPerfSkipped below and toFmpQuoteSymbol, so a symbol that's
// already in FMP's pair format doesn't get USD appended a second time.
const USD_PAIR_SUFFIX = /USD$|-USD$|USDT$/;

// Ported from the source app's isPerfSkipped() (portfolio-performance.js) -
// BTC/ETH-style holdings don't work with trading-day EOD history math
// (Robinhood exports bare BTC/ETH; FMP expects BTCUSD), so they're excluded
// from performanceHistory.
function isPerfSkipped(symbol: string, sector: string | null): boolean {
  if (sector === 'Crypto') return true;
  return USD_PAIR_SUFFIX.test(symbol);
}

// FMP's stock-quote endpoint (getQuotes below) doesn't resolve bare crypto
// tickers - BTC/ETH need the pair format BTCUSD/ETHUSD. Robinhood exports
// (parser.service.ts) store the bare symbol, and the DB/rest of the app keeps
// using that bare symbol throughout - this mapping only exists for the live
// FMP quote request itself, and gets reversed on the way back (see
// refreshPrices) so applyLivePrices' lookup by the holding's own symbol still
// matches. Found live: BTC/ETH holdings' prices were silently never updating
// on Refresh Prices, frozen at whatever price the original import captured,
// since FMP had no match for the bare symbol and applyLivePrices treats "no
// quote returned" as "leave this one alone."
function toFmpQuoteSymbol(symbol: string, sector: string | null): string {
  if (sector === 'Crypto' && !USD_PAIR_SUFFIX.test(symbol)) return `${symbol}USD`;
  return symbol;
}

export class PortfolioNotFoundError extends Error {}
export class PortfolioNameConflictError extends Error {}
// Portfolio Upload - Flex: saveFlexTemplate()/changeFlexTemplate() refuse to run against a
// portfolio that isn't a Flex portfolio currently in the 'Flex-Err' (needs-attention) state -
// e.g. calling Save Template twice, or on a Classic/already-resolved portfolio.
export class FlexTemplateStateError extends Error {}

const UNIQUE_VIOLATION = '23505';

export interface PortfolioSummary {
  id: string;
  name: string;
  broker: string | null;
  createdAt: string;
  updatedAt: string;
  uploadTemplateId: string | null;
  flexTemplateStatus: 'Flex' | 'Flex-Err' | null;
}

export interface PortfolioDetailHolding {
  id: string;
  symbol: string;
  name: string | null;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  sector: string | null;
  purchaseDate: string | null;
  costBasis: number;
  currentValue: number;
  gainLoss: number;
  returnPct: number;
  allocationPct: number | null;
  priceUpdatedAt: string | null;
  // Position-level (quantity * per-share) dollar/percent change for the day,
  // persisted by refreshPrices() alongside price_updated_at (migration 014) -
  // null until the holding's first refresh, same as priceUpdatedAt.
  todayChangeDollar: number | null;
  todayChangePercent: number | null;
}

export interface PortfolioDetail extends PortfolioSummary {
  cashAmount: number;
  holdings: PortfolioDetailHolding[];
  totalHoldingsValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  totalPortfolioValue: number;
}

const PORTFOLIO_COLUMNS = 'id, name, broker, created_at, updated_at, upload_template_id, flex_template_status';

interface PortfolioRow {
  id: string;
  name: string;
  broker: string | null;
  created_at: string;
  updated_at: string;
  upload_template_id: string | null;
  flex_template_status: 'Flex' | 'Flex-Err' | null;
}

function mapPortfolioRow(r: PortfolioRow): PortfolioSummary {
  return {
    id: r.id, name: r.name, broker: r.broker, createdAt: r.created_at, updatedAt: r.updated_at,
    uploadTemplateId: r.upload_template_id, flexTemplateStatus: r.flex_template_status,
  };
}

export async function listPortfolios(userId: string): Promise<PortfolioSummary[]> {
  const { rows } = await pool.query<PortfolioRow>(
    `SELECT ${PORTFOLIO_COLUMNS} FROM tx_portfolios WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows.map(mapPortfolioRow);
}

export async function createPortfolio(userId: string, name: string, broker: string | null): Promise<PortfolioSummary> {
  try {
    const { rows } = await pool.query<PortfolioRow>(
      `INSERT INTO tx_portfolios (user_id, name, broker) VALUES ($1, $2, $3) RETURNING ${PORTFOLIO_COLUMNS}`,
      [userId, name, broker],
    );
    return mapPortfolioRow(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new PortfolioNameConflictError(`A portfolio named "${name}" already exists.`);
    }
    throw err;
  }
}

interface HoldingRow {
  id: string;
  symbol: string;
  name: string | null;
  quantity: string;
  purchase_price: string;
  current_price: string;
  sector: string | null;
  purchase_date: string | null;
  cost_basis: string;
  current_value: string;
  gain_loss: string;
  return_pct: string;
  allocation_pct: string | null;
  price_updated_at: string | null;
  today_change_dollar: string | null;
  today_change_percent: string | null;
}

function mapHoldingRow(r: HoldingRow): PortfolioDetailHolding {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    quantity: parseFloat(r.quantity),
    purchasePrice: parseFloat(r.purchase_price),
    currentPrice: parseFloat(r.current_price),
    sector: r.sector,
    purchaseDate: r.purchase_date,
    costBasis: parseFloat(r.cost_basis),
    currentValue: parseFloat(r.current_value),
    gainLoss: parseFloat(r.gain_loss),
    returnPct: parseFloat(r.return_pct),
    allocationPct: r.allocation_pct == null ? null : parseFloat(r.allocation_pct),
    priceUpdatedAt: r.price_updated_at,
    todayChangeDollar: r.today_change_dollar == null ? null : parseFloat(r.today_change_dollar),
    todayChangePercent: r.today_change_percent == null ? null : parseFloat(r.today_change_percent),
  };
}

export async function getPortfolio(userId: string, portfolioId: string): Promise<PortfolioDetail | null> {
  const { rows: portfolioRows } = await pool.query<PortfolioRow>(
    `SELECT ${PORTFOLIO_COLUMNS} FROM tx_portfolios WHERE id = $1 AND user_id = $2`,
    [portfolioId, userId],
  );
  if (!portfolioRows[0]) return null;

  const { rows: holdingRows } = await pool.query<HoldingRow>(
    `SELECT id, symbol, name, quantity, purchase_price, current_price, sector, purchase_date,
            cost_basis, current_value, gain_loss, return_pct, allocation_pct, price_updated_at,
            today_change_dollar, today_change_percent
     FROM tx_holdings WHERE portfolio_id = $1 ORDER BY symbol`,
    [portfolioId],
  );
  const holdings = holdingRows.map(mapHoldingRow);

  const { rows: cashRows } = await pool.query<{ amount: string }>(
    'SELECT amount FROM tx_cash_positions WHERE portfolio_id = $1',
    [portfolioId],
  );
  const cashAmount = cashRows[0] ? parseFloat(cashRows[0].amount) : 0;

  const totalHoldingsValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCostBasis = holdings.reduce((s, h) => s + h.costBasis, 0);

  return {
    ...mapPortfolioRow(portfolioRows[0]),
    cashAmount,
    holdings,
    totalHoldingsValue,
    totalCostBasis,
    totalGainLoss: totalHoldingsValue - totalCostBasis,
    totalPortfolioValue: totalHoldingsValue + cashAmount,
  };
}

export async function updatePortfolio(
  userId: string,
  portfolioId: string,
  updates: { name?: string; broker?: string | null },
): Promise<PortfolioSummary | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    params.push(updates.name);
    setClauses.push(`name = $${params.length}`);
  }
  if (updates.broker !== undefined) {
    params.push(updates.broker);
    setClauses.push(`broker = $${params.length}`);
  }
  setClauses.push('updated_at = now()');

  params.push(portfolioId);
  const idParam = params.length;
  params.push(userId);
  const userIdParam = params.length;

  try {
    const { rows } = await pool.query<PortfolioRow>(
      `UPDATE tx_portfolios SET ${setClauses.join(', ')} WHERE id = $${idParam} AND user_id = $${userIdParam}
       RETURNING ${PORTFOLIO_COLUMNS}`,
      params,
    );
    return rows[0] ? mapPortfolioRow(rows[0]) : null;
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new PortfolioNameConflictError(`A portfolio named "${updates.name}" already exists.`);
    }
    throw err;
  }
}

export async function deletePortfolio(userId: string, portfolioId: string): Promise<boolean> {
  const { rows } = await pool.query(
    'DELETE FROM tx_portfolios WHERE id = $1 AND user_id = $2 RETURNING id',
    [portfolioId, userId],
  );
  return rows.length > 0;
}

export interface ImportResult {
  holdingsCount: number;
  cashAmount: number;
  actionsLogged: number;
  uploadId: string;
}

type ActionType = 'BUY' | 'SELL';

// Replaces every holding for this portfolio with the freshly parsed set,
// inside a transaction, and logs a BUY/SELL row for every symbol whose
// quantity changed (delta > 0 -> BUY, delta < 0 -> SELL, delta === 0 -> no
// row) - not just brand-new or fully-closed positions. This is the backend
// endpoint's unconditional contract; a future UI is expected to confirm with
// the user before ever calling it (see the plan this was built from).
export async function importHoldings(
  userId: string,
  portfolioId: string,
  parsed: ParseResult,
  filename: string,
  sourceFormat: string,
): Promise<ImportResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ownerRows } = await client.query('SELECT id FROM tx_portfolios WHERE id = $1 AND user_id = $2', [portfolioId, userId]);
    if (!ownerRows[0]) throw new PortfolioNotFoundError('Portfolio not found.');

    const { rows: existingRows } = await client.query<{ symbol: string; quantity: string; current_price: string }>(
      'SELECT symbol, quantity, current_price FROM tx_holdings WHERE portfolio_id = $1',
      [portfolioId],
    );
    const oldHoldings = new Map<string, { quantity: number; price: number }>();
    for (const r of existingRows) oldHoldings.set(r.symbol, { quantity: parseFloat(r.quantity), price: parseFloat(r.current_price) });

    const newHoldings = new Map<string, { quantity: number; price: number }>();
    for (const h of parsed.data) newHoldings.set(h.symbol, { quantity: h.quantity, price: h.currentPrice });

    const allSymbols = new Set([...oldHoldings.keys(), ...newHoldings.keys()]);
    const actionRows: { symbol: string; actionType: ActionType; quantityDelta: number; price: number }[] = [];
    for (const symbol of allSymbols) {
      const old = oldHoldings.get(symbol);
      const fresh = newHoldings.get(symbol);
      const delta = (fresh?.quantity ?? 0) - (old?.quantity ?? 0);
      if (delta === 0) continue;
      // Prefer the freshly-imported price; fall back to the last-known price
      // for symbols that dropped out of the new import entirely (fully sold).
      const price = fresh?.price ?? old?.price ?? 0;
      actionRows.push({ symbol, actionType: delta > 0 ? 'BUY' : 'SELL', quantityDelta: Math.abs(delta), price });
    }

    await client.query('DELETE FROM tx_holdings WHERE portfolio_id = $1', [portfolioId]);

    if (parsed.data.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      parsed.data.forEach((h, idx) => {
        const b = idx * 12;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12})`);
        params.push(
          portfolioId, h.symbol, h.name, h.quantity, h.purchasePrice, h.currentPrice,
          h.sector, h.purchaseDate || null, h.costBasis, h.currentValue, h.gainLoss, h.returnPct,
        );
      });
      await client.query(
        `INSERT INTO tx_holdings
           (portfolio_id, symbol, name, quantity, purchase_price, current_price, sector, purchase_date, cost_basis, current_value, gain_loss, return_pct)
         VALUES ${values.join(', ')}`,
        params,
      );

      // m_tickers is the single source of truth for ticker name/sector
      // (2026-08-02) - fed from both this import path and the Contrarian
      // Finder universe's own seed/backfill script. A real import is real
      // evidence a symbol exists; insert a bare row (sector from whatever
      // parser.service.ts already resolved) for anything m_tickers doesn't
      // know yet. ON CONFLICT DO NOTHING - never overwrites a symbol already
      // enriched (e.g. by backfillTickerData.ts's FMP-sourced name/sector).
      const uniqueSymbols = [...new Map(parsed.data.map((h) => [h.symbol, h.sector])).entries()];
      const tickerValues = uniqueSymbols.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
      const tickerParams = uniqueSymbols.flatMap(([symbol, sector]) => [symbol, sector || null]);
      await client.query(
        `INSERT INTO m_tickers (symbol, sector) VALUES ${tickerValues} ON CONFLICT (symbol) DO NOTHING`,
        tickerParams,
      );
    }

    await client.query(
      `INSERT INTO tx_cash_positions (portfolio_id, amount) VALUES ($1, $2)
       ON CONFLICT (portfolio_id) DO UPDATE SET amount = excluded.amount, updated_at = now()`,
      [portfolioId, parsed.cashAmount],
    );

    const { rows: uploadRows } = await client.query<{ id: string }>(
      `INSERT INTO tx_uploads (portfolio_id, filename, source_format, rows_parsed, rows_skipped, errors)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [portfolioId, filename, sourceFormat, parsed.data.length, parsed.errors.length, JSON.stringify(parsed.errors)],
    );

    if (actionRows.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      actionRows.forEach((a, idx) => {
        const b = idx * 5;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
        params.push(portfolioId, a.symbol, a.actionType, a.quantityDelta, a.price);
      });
      await client.query(
        `INSERT INTO tx_portfolio_action_hist (portfolio_id, symbol, action_type, quantity_delta, price) VALUES ${values.join(', ')}`,
        params,
      );
    }

    await client.query('COMMIT');
    return {
      holdingsCount: parsed.data.length,
      cashAmount: parsed.cashAmount,
      actionsLogged: actionRows.length,
      uploadId: uploadRows[0].id,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section has the full
// narrative). Either `uploadTemplateId` (an existing Approved/own-Pending template - already
// proven correct at approval time, so this resolves immediately) or `columnMapping` (a brand
// new, unproven mapping - leaves the portfolio in 'Flex-Err' pending the forced Save Template
// or Delete Portfolio resolution) must be given, never both/neither.
export interface CreatePortfolioFlexInput {
  name: string;
  broker: string | null;
  uploadTemplateId?: string;
  columnMapping?: ColumnMapping;
  headerRowIndex?: number;
  dataStartColumnIndex?: number;
  filename: string;
  content: string;
}

export async function createPortfolioFlex(
  userId: string,
  input: CreatePortfolioFlexInput,
): Promise<{ portfolio: PortfolioSummary; importResult: ImportResult }> {
  let mapping: ColumnMapping;
  let headerRowIndex = 1;
  let dataStartColumnIndex = 1;
  let uploadTemplateId: string | null = null;
  let flexTemplateStatus: 'Flex' | 'Flex-Err';

  if (input.uploadTemplateId) {
    const config = await portfolioTemplateService.getTemplateParseConfig(input.uploadTemplateId);
    mapping = config.columnMapping;
    headerRowIndex = config.headerRowIndex;
    dataStartColumnIndex = config.dataStartColumnIndex;
    uploadTemplateId = input.uploadTemplateId;
    flexTemplateStatus = 'Flex';
  } else if (input.columnMapping) {
    mapping = input.columnMapping;
    headerRowIndex = input.headerRowIndex ?? 1;
    dataStartColumnIndex = input.dataStartColumnIndex ?? 1;
    flexTemplateStatus = 'Flex-Err';
  } else {
    throw new Error('Either uploadTemplateId or columnMapping is required.');
  }

  // Parse (and therefore validate the mapping against real data) BEFORE ever creating a
  // portfolio row - a bad mapping or empty/malformed file must never leave a ghost portfolio
  // behind.
  const parsed = parseFlexCsv(input.content, mapping, { headerRowIndex, dataStartColumnIndex });

  let portfolio: PortfolioSummary;
  try {
    const { rows } = await pool.query<PortfolioRow>(
      `INSERT INTO tx_portfolios (user_id, name, broker, upload_template_id, flex_template_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${PORTFOLIO_COLUMNS}`,
      [userId, input.name, input.broker, uploadTemplateId, flexTemplateStatus],
    );
    portfolio = mapPortfolioRow(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new PortfolioNameConflictError(`A portfolio named "${input.name}" already exists.`);
    }
    throw err;
  }

  // Reuses the existing, already-tested importHoldings() write path unchanged - same
  // transaction/diffing/tx_uploads audit row as Legacy, just fed Flex-parsed data.
  const importResult = await importHoldings(userId, portfolio.id, parsed, input.filename, 'flex');

  return { portfolio, importResult };
}

export interface SaveFlexTemplateInput {
  templateName: string;
  columnMapping: ColumnMapping;
  samplePreview: unknown;
  headerRowIndex: number;
  dataStartColumnIndex: number;
  howToUseDescription?: string;
}

// The forced-resolution action - only callable while the portfolio is genuinely in the
// 'Flex-Err' (unresolved) state, i.e. only once, right after a brand-new mapping's Dashboard
// has actually rendered. One transaction: create the template (via portfolioTemplate
// .service.ts's createTemplate(), passed this same client so it doesn't open its own),
// then bind it - so a template is never created without also being bound, or vice versa.
export async function saveFlexTemplate(
  userId: string,
  portfolioId: string,
  input: SaveFlexTemplateInput,
): Promise<{ portfolio: PortfolioSummary; template: portfolioTemplateService.TemplateSummary }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: string; flex_template_status: string | null }>(
      'SELECT id, flex_template_status FROM tx_portfolios WHERE id = $1 AND user_id = $2',
      [portfolioId, userId],
    );
    if (!rows[0]) throw new PortfolioNotFoundError('Portfolio not found.');
    if (rows[0].flex_template_status !== 'Flex-Err') {
      throw new FlexTemplateStateError('This portfolio has no unresolved Flex mapping to save as a template.');
    }

    const template = await portfolioTemplateService.createTemplate(
      {
        templateName: input.templateName, columnMapping: input.columnMapping, samplePreview: input.samplePreview,
        headerRowIndex: input.headerRowIndex, dataStartColumnIndex: input.dataStartColumnIndex,
        howToUseDescription: input.howToUseDescription, createdBy: userId,
      },
      client,
    );

    const { rows: updatedRows } = await client.query<PortfolioRow>(
      `UPDATE tx_portfolios SET upload_template_id = $1, flex_template_status = 'Flex', updated_at = now()
       WHERE id = $2 RETURNING ${PORTFOLIO_COLUMNS}`,
      [template.id, portfolioId],
    );

    await client.query('COMMIT');
    return { portfolio: mapPortfolioRow(updatedRows[0]), template };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

export interface ChangeFlexTemplateInput {
  uploadTemplateId?: string;
  columnMapping?: ColumnMapping;
  headerRowIndex?: number;
  dataStartColumnIndex?: number;
  filename: string;
  content: string;
}

// Changing an already-resolved portfolio's bound template - only callable while
// flex_template_status is already 'Flex' (a portfolio still in 'Flex-Err' uses
// saveFlexTemplate for its first resolution instead; a Classic/Legacy portfolio was never
// Flex to begin with). Always re-runs the real import against the new mapping first ("Inspect
// Data before swap" - never a silent template change), reusing importHoldings() exactly like
// createPortfolioFlex does.
export async function changeFlexTemplate(
  userId: string,
  portfolioId: string,
  input: ChangeFlexTemplateInput,
): Promise<{ portfolio: PortfolioSummary; importResult: ImportResult }> {
  const { rows } = await pool.query<{ id: string; flex_template_status: string | null }>(
    'SELECT id, flex_template_status FROM tx_portfolios WHERE id = $1 AND user_id = $2',
    [portfolioId, userId],
  );
  if (!rows[0]) throw new PortfolioNotFoundError('Portfolio not found.');
  if (rows[0].flex_template_status !== 'Flex') {
    throw new FlexTemplateStateError('Only a portfolio with an already-resolved Flex template can have it changed.');
  }

  let mapping: ColumnMapping;
  let headerRowIndex = 1;
  let dataStartColumnIndex = 1;
  let uploadTemplateId: string | null;
  let flexTemplateStatus: 'Flex' | 'Flex-Err';

  if (input.uploadTemplateId) {
    const config = await portfolioTemplateService.getTemplateParseConfig(input.uploadTemplateId);
    mapping = config.columnMapping;
    headerRowIndex = config.headerRowIndex;
    dataStartColumnIndex = config.dataStartColumnIndex;
    uploadTemplateId = input.uploadTemplateId;
    flexTemplateStatus = 'Flex';
  } else if (input.columnMapping) {
    mapping = input.columnMapping;
    headerRowIndex = input.headerRowIndex ?? 1;
    dataStartColumnIndex = input.dataStartColumnIndex ?? 1;
    uploadTemplateId = null;
    flexTemplateStatus = 'Flex-Err'; // same forced-resolution rule applies to a brand-new replacement mapping
  } else {
    throw new Error('Either uploadTemplateId or columnMapping is required.');
  }

  const parsed = parseFlexCsv(input.content, mapping, { headerRowIndex, dataStartColumnIndex });
  const importResult = await importHoldings(userId, portfolioId, parsed, input.filename, 'flex');

  const { rows: updatedRows } = await pool.query<PortfolioRow>(
    `UPDATE tx_portfolios SET upload_template_id = $1, flex_template_status = $2, updated_at = now()
     WHERE id = $3 RETURNING ${PORTFOLIO_COLUMNS}`,
    [uploadTemplateId, flexTemplateStatus, portfolioId],
  );

  return { portfolio: mapPortfolioRow(updatedRows[0]), importResult };
}

export interface RefreshedHolding {
  id: string;
  symbol: string;
  currentPrice: number;
  currentValue: number;
  gainLoss: number;
  returnPct: number;
  allocationPct: number | null;
  priceUpdatedAt: string | null;
  // Both null when this holding had no fresh quote this refresh (same
  // partial-failure tolerance as every other field above) - driven by the
  // Dashboard's Performance/Allocation "Today ($)" modes, which only ever
  // read the most recent refresh's values, never re-fetch on their own.
  // todayChangeDollar is the POSITION's dollar change (quantity * FMP's
  // per-share change), matching the source app's getTodayDollarChanges() -
  // NOT the raw per-share change FMP's quote endpoint returns.
  todayChangeDollar: number | null;
  todayChangePercent: number | null;
}

export interface RefreshPricesResult {
  holdings: RefreshedHolding[];
  // keyed by symbol, ~130-day EOD bars, crypto-excluded, only successfully-
  // fetched symbols included - the Performance widget's period-return math.
  performanceHistory: Record<string, HistoricalBar[]>;
}

function toHoldingLike(r: HoldingRow): HoldingLike {
  return {
    symbol: r.symbol,
    name: r.name ?? '',
    sector: r.sector ?? '',
    quantity: parseFloat(r.quantity),
    purchasePrice: parseFloat(r.purchase_price),
    costBasis: parseFloat(r.cost_basis),
    currentPrice: parseFloat(r.current_price),
    currentValue: parseFloat(r.current_value),
    gainLoss: parseFloat(r.gain_loss),
    returnPct: parseFloat(r.return_pct),
  };
}

// Refreshes current_price/current_value/gain_loss/return_pct/allocation_pct
// from live FMP quotes and persists them - but ONLY for holdings that
// actually got a match in marketData.getQuotes()'s result (that call
// tolerates partial per-symbol failures). Holdings FMP didn't return data for
// keep their old price_updated_at untouched, honestly reflecting that
// they're still stale, rather than a portfolio-wide timestamp falsely
// claiming everything was refreshed.
//
// Also fetches each held (non-crypto) symbol's ~130-day EOD history in
// parallel with the quote refresh - one unified "Refresh Prices" drives both
// the current-price numbers above AND the Dashboard's Performance/Allocation
// widgets' period-return/Today's-$ modes, rather than a second independent
// refresh action like the source app has.
export async function refreshPrices(userId: string, portfolioId: string): Promise<RefreshPricesResult> {
  const { rows: ownerRows } = await pool.query('SELECT id FROM tx_portfolios WHERE id = $1 AND user_id = $2', [portfolioId, userId]);
  if (!ownerRows[0]) throw new PortfolioNotFoundError('Portfolio not found.');

  const { rows: holdingRows } = await pool.query<HoldingRow>(
    `SELECT id, symbol, name, quantity, purchase_price, current_price, sector, purchase_date,
            cost_basis, current_value, gain_loss, return_pct, allocation_pct, price_updated_at,
            today_change_dollar, today_change_percent
     FROM tx_holdings WHERE portfolio_id = $1`,
    [portfolioId],
  );
  if (holdingRows.length === 0) return { holdings: [], performanceHistory: {} };

  const apiKey = await userSubscription.getDecryptedKey(userId, 'fmp');
  const holdings = holdingRows.map(toHoldingLike);
  const historySymbols = [...new Set(holdingRows.filter((r) => !isPerfSkipped(r.symbol, r.sector)).map((r) => r.symbol))];

  const fmpQuoteSymbols = holdingRows.map((r) => toFmpQuoteSymbol(r.symbol, r.sector));
  const [rawPriceMap, historyResults] = await Promise.all([
    marketData.getQuotes(fmpQuoteSymbols, apiKey),
    Promise.allSettled(historySymbols.map((symbol) => marketData.getHistorical(symbol, apiKey, 130))),
  ]);
  // Map the FMP pair-format keys (e.g. BTCUSD) back to each holding's own bare
  // symbol (e.g. BTC) - applyLivePrices looks quotes up by stock.symbol.
  const priceMap: Record<string, Quote> = {};
  holdingRows.forEach((r, i) => {
    const quote = rawPriceMap[fmpQuoteSymbols[i]];
    if (quote) priceMap[r.symbol] = quote;
  });
  applyLivePrices(holdings, priceMap);

  const performanceHistory: Record<string, HistoricalBar[]> = {};
  historyResults.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length > 0) performanceHistory[historySymbols[i]] = r.value;
  });

  const results: RefreshedHolding[] = [];
  for (let i = 0; i < holdingRows.length; i++) {
    const row = holdingRows[i];
    const updatedHolding = holdings[i];

    if (!priceMap[row.symbol]) {
      results.push({
        id: row.id, symbol: row.symbol, currentPrice: parseFloat(row.current_price),
        currentValue: parseFloat(row.current_value), gainLoss: parseFloat(row.gain_loss),
        returnPct: parseFloat(row.return_pct),
        allocationPct: row.allocation_pct == null ? null : parseFloat(row.allocation_pct),
        priceUpdatedAt: row.price_updated_at,
        // Same honesty principle as priceUpdatedAt above: no fresh quote this
        // refresh keeps whatever was last persisted, rather than blanking a
        // holding that DID have a real today's-$ value from an earlier refresh.
        todayChangeDollar: row.today_change_dollar == null ? null : parseFloat(row.today_change_dollar),
        todayChangePercent: row.today_change_percent == null ? null : parseFloat(row.today_change_percent),
      });
      continue;
    }

    const todayChangeDollar = priceMap[row.symbol].changeDollar * updatedHolding.quantity;
    const todayChangePercent = priceMap[row.symbol].changePercent ?? null;

    const { rows: updatedRows } = await pool.query<{ price_updated_at: string }>(
      `UPDATE tx_holdings
       SET current_price = $1, current_value = $2, gain_loss = $3, return_pct = $4, allocation_pct = $5,
           price_updated_at = now(), today_change_dollar = $6, today_change_percent = $7
       WHERE id = $8
       RETURNING price_updated_at`,
      [
        updatedHolding.currentPrice, updatedHolding.currentValue, updatedHolding.gainLoss,
        updatedHolding.returnPct, updatedHolding.allocation ?? null,
        todayChangeDollar, todayChangePercent, row.id,
      ],
    );

    results.push({
      id: row.id, symbol: row.symbol, currentPrice: updatedHolding.currentPrice,
      currentValue: updatedHolding.currentValue, gainLoss: updatedHolding.gainLoss,
      returnPct: updatedHolding.returnPct, allocationPct: updatedHolding.allocation ?? null,
      priceUpdatedAt: updatedRows[0].price_updated_at,
      todayChangeDollar, todayChangePercent,
    });
  }
  return { holdings: results, performanceHistory };
}
