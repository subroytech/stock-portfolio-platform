// Ported from CreateStockPortfolioViewWOSkill/js/config.js — unchanged.

const HEADER_ALIASES = {
  symbol: ['symbol', 'ticker', 'stock', 'sym', 'security id'],
  name: ['company name', 'company', 'name', 'description', 'stock name'],
  quantity: ['quantity', 'shares', 'qty', 'units'],
  purchasePrice: ['purchase price', 'buy price', 'cost', 'cost price', 'avg cost', 'avg price', 'average cost', 'purchase', 'average cost basis', 'avg cost basis'],
  currentPrice: ['current price', 'price', 'market price', 'last price', 'close', 'current'],
  marketValue: ['market value', 'current value', 'total value', 'value'],
  gainLossDollar: ['gain/loss $', 'gain loss $', 'total gain/loss dollar', 'total gain loss dollar', 'gain/loss dollar'],
  sector: ['sector', 'industry', 'category', 'sub-asset classification', 'sub asset classification'],
  purchaseDate: ['purchase date', 'date', 'buy date', 'date purchased'],
};

module.exports = { HEADER_ALIASES };
