// Portfolio CRUD + CSV/TXT import (reusing parser.service.ts as-is) + live-price
// refresh (reusing marketData.service.ts/livePrices.service.ts as-is). Decided
// 2026-07-12 (see Architecture.md Section 2 / the portfolio-CRUD plan).

import { pool } from '../db/pool';
import * as marketData from './marketData.service';
import * as userSubscription from './userSubscription.service';
import { applyLivePrices, HoldingLike } from './livePrices.service';
import { ParseResult } from './parser.service';

export class PortfolioNotFoundError extends Error {}
export class PortfolioNameConflictError extends Error {}

const UNIQUE_VIOLATION = '23505';

export interface PortfolioSummary {
  id: string;
  name: string;
  broker: string | null;
  createdAt: string;
  updatedAt: string;
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
}

export interface PortfolioDetail extends PortfolioSummary {
  cashAmount: number;
  holdings: PortfolioDetailHolding[];
  totalHoldingsValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  totalPortfolioValue: number;
}

interface PortfolioRow {
  id: string;
  name: string;
  broker: string | null;
  created_at: string;
  updated_at: string;
}

function mapPortfolioRow(r: PortfolioRow): PortfolioSummary {
  return { id: r.id, name: r.name, broker: r.broker, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listPortfolios(userId: string): Promise<PortfolioSummary[]> {
  const { rows } = await pool.query<PortfolioRow>(
    'SELECT id, name, broker, created_at, updated_at FROM tx_portfolios WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows.map(mapPortfolioRow);
}

export async function createPortfolio(userId: string, name: string, broker: string | null): Promise<PortfolioSummary> {
  try {
    const { rows } = await pool.query<PortfolioRow>(
      'INSERT INTO tx_portfolios (user_id, name, broker) VALUES ($1, $2, $3) RETURNING id, name, broker, created_at, updated_at',
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
  };
}

export async function getPortfolio(userId: string, portfolioId: string): Promise<PortfolioDetail | null> {
  const { rows: portfolioRows } = await pool.query<PortfolioRow>(
    'SELECT id, name, broker, created_at, updated_at FROM tx_portfolios WHERE id = $1 AND user_id = $2',
    [portfolioId, userId],
  );
  if (!portfolioRows[0]) return null;

  const { rows: holdingRows } = await pool.query<HoldingRow>(
    `SELECT id, symbol, name, quantity, purchase_price, current_price, sector, purchase_date,
            cost_basis, current_value, gain_loss, return_pct, allocation_pct, price_updated_at
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
       RETURNING id, name, broker, created_at, updated_at`,
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

export interface RefreshedHolding {
  id: string;
  symbol: string;
  currentPrice: number;
  currentValue: number;
  gainLoss: number;
  returnPct: number;
  allocationPct: number | null;
  priceUpdatedAt: string | null;
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
export async function refreshPrices(userId: string, portfolioId: string): Promise<RefreshedHolding[]> {
  const { rows: ownerRows } = await pool.query('SELECT id FROM tx_portfolios WHERE id = $1 AND user_id = $2', [portfolioId, userId]);
  if (!ownerRows[0]) throw new PortfolioNotFoundError('Portfolio not found.');

  const { rows: holdingRows } = await pool.query<HoldingRow>(
    `SELECT id, symbol, name, quantity, purchase_price, current_price, sector, purchase_date,
            cost_basis, current_value, gain_loss, return_pct, allocation_pct, price_updated_at
     FROM tx_holdings WHERE portfolio_id = $1`,
    [portfolioId],
  );
  if (holdingRows.length === 0) return [];

  const apiKey = await userSubscription.getDecryptedKey(userId, 'fmp');
  const holdings = holdingRows.map(toHoldingLike);
  const priceMap = await marketData.getQuotes(holdings.map((h) => h.symbol), apiKey);
  applyLivePrices(holdings, priceMap);

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
      });
      continue;
    }

    const { rows: updatedRows } = await pool.query<{ price_updated_at: string }>(
      `UPDATE tx_holdings
       SET current_price = $1, current_value = $2, gain_loss = $3, return_pct = $4, allocation_pct = $5, price_updated_at = now()
       WHERE id = $6
       RETURNING price_updated_at`,
      [
        updatedHolding.currentPrice, updatedHolding.currentValue, updatedHolding.gainLoss,
        updatedHolding.returnPct, updatedHolding.allocation ?? null, row.id,
      ],
    );

    results.push({
      id: row.id, symbol: row.symbol, currentPrice: updatedHolding.currentPrice,
      currentValue: updatedHolding.currentValue, gainLoss: updatedHolding.gainLoss,
      returnPct: updatedHolding.returnPct, allocationPct: updatedHolding.allocation ?? null,
      priceUpdatedAt: updatedRows[0].price_updated_at,
    });
  }
  return results;
}
