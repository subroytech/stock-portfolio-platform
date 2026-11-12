import { useMemo, useState } from 'react';
import { usePortfolioTransactions } from '../api/portfolios';
import type { TransactionHistoryEntry } from '../api/portfolios';
import { formatCurrency, formatNumber, formatDateOnly } from '../lib/format';

interface TransactionHistoryTableProps {
  portfolioId: string;
}

type SortField = 'symbol' | 'actionType' | 'quantityDelta' | 'price' | 'value' | 'actionDateTime';
type SortDirection = 'asc' | 'desc';

const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: 'symbol', label: 'Ticker' },
  { key: 'actionType', label: 'Action' },
  { key: 'quantityDelta', label: 'Quantity' },
  { key: 'price', label: 'Price' },
  { key: 'value', label: 'Value' },
  { key: 'actionDateTime', label: 'Date' },
];

// Negative for SELL, positive for BUY - quantityDelta itself is always stored positive in
// tx_portfolio_action_hist (direction comes from actionType), but a sale reads more naturally
// as money leaving the position, matching the sign convention gain/loss figures already use
// elsewhere in this app.
function signedValue(t: TransactionHistoryEntry): number {
  return t.quantityDelta * t.price * (t.actionType === 'SELL' ? -1 : 1);
}

function getSortValue(t: TransactionHistoryEntry, field: SortField): string | number {
  switch (field) {
    case 'value': return signedValue(t);
    case 'actionDateTime': return new Date(t.actionDateTime).getTime();
    case 'symbol': return t.symbol;
    case 'actionType': return t.actionType;
    case 'quantityDelta': return t.quantityDelta;
    case 'price': return t.price;
  }
}

function compareValues(a: string | number, b: string | number, direction: SortDirection): number {
  const cmp = typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : (a as number) - (b as number);
  return direction === 'asc' ? cmp : -cmp;
}

// 2-level sort, user-controlled (not tied to column-header clicks, unlike the Holdings table's
// own single-level sort) - defaults to Ticker asc, then Date desc within each ticker, per
// explicit direction. Row counts here are small (low hundreds at most, one row per buy/sell
// diffed on import), so re-sorting the full list on every control change is cheap.
function sortTransactions(
  transactions: TransactionHistoryEntry[],
  primaryField: SortField, primaryDirection: SortDirection,
  secondaryField: SortField, secondaryDirection: SortDirection,
): TransactionHistoryEntry[] {
  const withIndex = transactions.map((t, index) => ({ t, index }));
  withIndex.sort((a, b) => {
    const primaryCmp = compareValues(getSortValue(a.t, primaryField), getSortValue(b.t, primaryField), primaryDirection);
    if (primaryCmp !== 0) return primaryCmp;
    const secondaryCmp = compareValues(getSortValue(a.t, secondaryField), getSortValue(b.t, secondaryField), secondaryDirection);
    if (secondaryCmp !== 0) return secondaryCmp;
    return a.index - b.index; // stable tiebreak
  });
  return withIndex.map((e) => e.t);
}

function FieldSelect({ value, onChange, testId }: { value: SortField; onChange: (field: SortField) => void; testId: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortField)}
      data-testid={testId}
      className="rounded-btn border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary"
    >
      {SORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
    </select>
  );
}

function DirectionToggle({ direction, onToggle, testId }: { direction: SortDirection; onToggle: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testId}
      aria-label={direction === 'asc' ? 'Ascending' : 'Descending'}
      className="rounded-btn border border-border px-2 py-1 text-xs text-text-secondary hover:bg-border"
    >
      {direction === 'asc' ? '↑' : '↓'}
    </button>
  );
}

// Buy/sell history (tx_portfolio_action_hist) - one row per symbol whose quantity changed on a
// given import, for either Legacy or Flex (both funnel through the same importHoldings() write
// path). Reuses PortfolioHolding's own responsive card/table split precedent from
// HoldingsTable.tsx, but has nothing else in common with that component's allocation-based
// Major/Minor split - this is a wholly different dataset (one fetch per portfolio, lazy, only
// while this tab is actually mounted).
export default function TransactionHistoryTable({ portfolioId }: TransactionHistoryTableProps) {
  const { data: transactions, isLoading, isError } = usePortfolioTransactions(portfolioId, true);
  const [primaryField, setPrimaryField] = useState<SortField>('symbol');
  const [primaryDirection, setPrimaryDirection] = useState<SortDirection>('asc');
  const [secondaryField, setSecondaryField] = useState<SortField>('actionDateTime');
  const [secondaryDirection, setSecondaryDirection] = useState<SortDirection>('desc');

  const sorted = useMemo(
    () => (transactions ? sortTransactions(transactions, primaryField, primaryDirection, secondaryField, secondaryDirection) : []),
    [transactions, primaryField, primaryDirection, secondaryField, secondaryDirection],
  );

  if (isLoading) return <p className="text-sm text-text-secondary">Loading transaction history…</p>;
  if (isError) return <p className="text-sm text-danger">Couldn&rsquo;t load transaction history.</p>;
  if (!transactions || transactions.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No buy/sell activity recorded yet — this builds up as you re-import updated holdings.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary" data-testid="transaction-history-sort-controls">
        <span>Sort by</span>
        <FieldSelect value={primaryField} onChange={setPrimaryField} testId="transaction-sort-primary-field" />
        <DirectionToggle
          direction={primaryDirection}
          onToggle={() => setPrimaryDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          testId="transaction-sort-primary-direction"
        />
        <span>then</span>
        <FieldSelect value={secondaryField} onChange={setSecondaryField} testId="transaction-sort-secondary-field" />
        <DirectionToggle
          direction={secondaryDirection}
          onToggle={() => setSecondaryDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          testId="transaction-sort-secondary-direction"
        />
      </div>

      {/* Mobile: card list */}
      <div className="flex flex-col gap-3 md:hidden">
        {sorted.map((t) => (
          <div key={t.id} className="rounded-card border border-border bg-bg-card p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-text-primary">{t.symbol}</span>
              <span className={`text-sm font-medium ${t.actionType === 'BUY' ? 'text-success' : 'text-danger'}`}>{t.actionType}</span>
            </div>
            {t.name && <p className="text-xs text-text-muted">{t.name}</p>}
            <div className="mt-2 flex items-baseline justify-between text-sm text-text-secondary">
              <span>{formatNumber(t.quantityDelta)} sh @ {formatCurrency(t.price)}</span>
              <span className="font-medium text-text-primary">{formatCurrency(signedValue(t))}</span>
            </div>
            <p className="mt-1 text-xs text-text-muted">{formatDateOnly(t.actionDateTime)}</p>
          </div>
        ))}
      </div>

      {/* Desktop: table - deliberately narrower than the full card width (max-w-3xl), per
          explicit direction, rather than stretching edge-to-edge like the Holdings table. */}
      <div className="hidden overflow-x-auto rounded-card border border-border bg-bg-card shadow-card md:block md:max-w-3xl">
        <table className="w-full text-sm" data-testid="transaction-history-table">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="whitespace-nowrap px-3 py-2">Ticker</th>
              <th className="max-w-[180px] px-3 py-2">Name</th>
              <th className="whitespace-nowrap px-3 py-2">Action</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Quantity</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Price</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Value</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Date</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} data-testid={`transaction-row-${t.id}`} className="border-b border-border last:border-0 text-text-primary">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{t.symbol}</td>
                <td className="max-w-[180px] truncate px-3 py-2 text-text-secondary" title={t.name ?? undefined}>{t.name ?? '—'}</td>
                <td className={`whitespace-nowrap px-3 py-2 font-medium ${t.actionType === 'BUY' ? 'text-success' : 'text-danger'}`}>{t.actionType}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatNumber(t.quantityDelta)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatCurrency(t.price)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatCurrency(signedValue(t))}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-text-secondary">{formatDateOnly(t.actionDateTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
