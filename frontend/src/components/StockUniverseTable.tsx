import { useMemo, useState } from 'react';
import type { UniverseTable } from '../api/contrarianFinder';
import { formatCompactCurrency } from '../lib/format';

interface StockUniverseTableProps {
  data: UniverseTable;
}

type SortKey = 'symbol' | 'name' | 'sector' | 'marketCap' | 'indexCount';
type SortDirection = 'asc' | 'desc';

interface Row {
  symbol: string;
  name: string | null;
  sector: string | null;
  marketCap: number | null;
  indices: string[];
  indexCount: number;
}

// Reference table for the Contrarian Finder page's "Stock Universe" section -
// every stock the scan's universe covers, one row per stock (not one row per
// index membership), with a tick column per index since a stock is often in
// more than one (e.g. AAPL: DJ30, S&P 500, and XLK). Same responsive split
// (mobile card list / desktop table) and sortable-column pattern as
// HoldingsTable.tsx, so both stay familiar side by side on this page.
export default function StockUniverseTable({ data }: StockUniverseTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('indexCount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const rows: Row[] = useMemo(
    () => data.stocks.map((s) => ({ ...s, indexCount: s.indices.length })),
    [data.stocks],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.symbol.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const withOriginalIndex = filtered.map((r, index) => ({ r, index }));
    withOriginalIndex.sort((a, b) => {
      const av = a.r[sortKey];
      const bv = b.r[sortKey];
      if (av == null && bv == null) return a.index - b.index;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number);
      if (cmp !== 0) return sortDirection === 'asc' ? cmp : -cmp;
      return a.index - b.index; // stable tiebreak
    });
    return withOriginalIndex.map((e) => e.r);
  }, [filtered, sortKey, sortDirection]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'indexCount' ? 'desc' : 'asc');
    }
  }

  function sortButton(key: SortKey, label: string) {
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className={`inline-flex items-center gap-1 font-medium hover:text-text-primary ${sortKey === key ? 'text-text-primary' : ''}`}
      >
        {label}
        {sortKey === key && <span aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
      </button>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search symbol or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search stock universe"
          className="w-full max-w-xs rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary sm:w-auto"
        />
        <span className="text-xs text-text-secondary">{sorted.length} of {rows.length} stocks</span>
      </div>

      {sorted.length === 0 && (
        <p className="text-sm text-text-secondary">No stocks match your search.</p>
      )}

      {sorted.length > 0 && (
        <>
          {/* Mobile: card list - only ticked indices shown (a compact "DJ30 ·
              SP500 · XLK" line), not a 14-column boolean grid. */}
          <div className="flex flex-col gap-3 md:hidden">
            {sorted.map((r) => (
              <div key={r.symbol} data-testid={`universe-card-${r.symbol}`} className="rounded-card border border-border bg-bg-card p-4 shadow-card">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-text-primary">{r.symbol}</span>
                  <span className="text-xs text-text-secondary">{r.indexCount} {r.indexCount === 1 ? 'index' : 'indices'}</span>
                </div>
                {r.name && <p className="text-xs text-text-muted">{r.name}</p>}
                <p className="mt-1 text-xs text-text-secondary">
                  {r.sector ?? '—'}{r.marketCap != null && <> · {formatCompactCurrency(r.marketCap)}</>}
                </p>
                {r.indices.length > 0 && (
                  <p className="mt-2 text-xs text-text-secondary">{r.indices.join(' · ')}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: full tick-grid table - one column per index. */}
          <div className="hidden overflow-x-auto rounded-card border border-border bg-bg-card shadow-card md:block">
            <table className="w-full text-sm" data-testid="universe-table">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="whitespace-nowrap px-3 py-2">Srl#</th>
                  <th className="whitespace-nowrap px-3 py-2">{sortButton('symbol', 'Symbol')}</th>
                  <th className="whitespace-nowrap px-3 py-2">{sortButton('name', 'Name')}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">{sortButton('marketCap', 'Market Cap')}</th>
                  <th className="whitespace-nowrap px-3 py-2">{sortButton('sector', 'Sector')}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">{sortButton('indexCount', '# Indices')}</th>
                  {data.indices.map((idx) => (
                    <th key={idx.id} className="whitespace-nowrap px-2 py-2 text-center" title={idx.description}>
                      {idx.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.symbol} data-testid={`universe-row-${r.symbol}`} className="border-b border-border last:border-0 text-text-primary">
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{r.symbol}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.name ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-text-secondary">{r.marketCap != null ? formatCompactCurrency(r.marketCap) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.sector ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{r.indexCount}</td>
                    {data.indices.map((idx) => (
                      <td key={idx.id} className="px-2 py-2 text-center" title={idx.description}>
                        {r.indices.includes(idx.id) ? '✓' : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
