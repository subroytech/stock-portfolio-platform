// Ported from CreateStockPortfolioViewWOSkill/js/live-prices.js
// (computeGroupGain, applyLivePrices) — pure recalculation logic. The only
// change from the original is the signature: these took the global S.raw/
// S.query implicitly, here they take an explicit holdings array + query
// string argument. fetchQuotesFMP() itself is superseded by
// marketData.service.js's getQuotes() + the GET /quotes endpoint.

// Mutates each holding's currentPrice/currentValue/gainLoss/returnPct/allocation
// in place from a { SYMBOL: { price, changeDollar, changePercent, name } } map,
// then returns a query-filtered view alongside the count of holdings updated.
function applyLivePrices(holdings, priceMap, query = '') {
  let updated = 0;
  holdings.forEach((stock) => {
    const q = priceMap[stock.symbol];
    if (!q) return;
    stock.currentPrice = q.price;
    stock.currentValue = stock.quantity * q.price;
    stock.gainLoss = stock.currentValue - stock.costBasis;
    stock.returnPct = stock.purchasePrice > 0
      ? ((q.price - stock.purchasePrice) / stock.purchasePrice) * 100 : 0;
    updated++;
  });
  const totalVal = holdings.reduce((s, d) => s + d.currentValue, 0);
  holdings.forEach((d) => { d.allocation = totalVal > 0 ? (d.currentValue / totalVal) * 100 : 0; });

  const q = query.toLowerCase();
  const filtered = holdings.filter((d) => d.symbol.toLowerCase().includes(q)
    || d.name.toLowerCase().includes(q)
    || d.sector.toLowerCase().includes(q));

  return { updated, filtered };
}

// Today's $ gain for a single price-map group (e.g. Top-15 or All-Others).
function computeGroupGain(holdings, priceMap) {
  const covered = holdings.filter((d) => priceMap[d.symbol] && priceMap[d.symbol].price > 0);
  const gainDollars = covered.reduce((sum, d) => {
    const q = priceMap[d.symbol];
    const shares = d.currentValue / q.price;
    return sum + shares * (q.changeDollar || 0);
  }, 0);
  return { gainDollars, covered };
}

module.exports = { applyLivePrices, computeGroupGain };
