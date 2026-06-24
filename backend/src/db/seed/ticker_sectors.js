// Ported from CreateStockPortfolioViewWOSkill/js/config.js — unchanged.
// Applied when a CSV has no sector column (e.g. Fidelity exports).
// NOTE: stays a hardcoded JS module for Phase 1 by design — moving this into a
// DB table (index_constituents) is deferred to Phase 4 per Architecture.md step 16.

const TICKER_SECTORS = {
  // Technology
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AMD: 'Technology', INTC: 'Technology',
  QCOM: 'Technology', TXN: 'Technology', AVGO: 'Technology', CRM: 'Technology', ORCL: 'Technology',
  ADBE: 'Technology', NOW: 'Technology', SNOW: 'Technology', PLTR: 'Technology', UBER: 'Consumer Discretionary',
  LYFT: 'Consumer Discretionary', ABNB: 'Consumer Discretionary', APLD: 'Technology', QBTS: 'Technology',
  RGTI: 'Technology', IONQ: 'Technology', IBM: 'Technology', HPQ: 'Technology', DELL: 'Technology',
  CSCO: 'Technology', AMAT: 'Technology', KLAC: 'Technology', LRCX: 'Technology', MU: 'Technology',
  ANET: 'Technology', PANW: 'Technology', FTNT: 'Technology', CRWD: 'Technology', ZS: 'Technology',
  OKTA: 'Technology', DDOG: 'Technology', NET: 'Technology', TEAM: 'Technology', SHOP: 'Technology',
  SQ: 'Technology', PYPL: 'Technology', COIN: 'Technology',
  // Communication Services
  GOOGL: 'Communication Services', GOOG: 'Communication Services', META: 'Communication Services',
  NFLX: 'Communication Services', DIS: 'Communication Services', CMCSA: 'Communication Services',
  T: 'Communication Services', VZ: 'Communication Services', TMUS: 'Communication Services',
  SPOT: 'Communication Services', SNAP: 'Communication Services', PINS: 'Communication Services',
  RBLX: 'Communication Services', EA: 'Communication Services', TTWO: 'Communication Services',
  // Consumer Discretionary
  AMZN: 'Consumer Discretionary', TSLA: 'Consumer Discretionary', HD: 'Consumer Discretionary',
  LOW: 'Consumer Discretionary', MCD: 'Consumer Discretionary', SBUX: 'Consumer Discretionary',
  NKE: 'Consumer Discretionary', TGT: 'Consumer Discretionary', BKNG: 'Consumer Discretionary',
  MAR: 'Consumer Discretionary', HLT: 'Consumer Discretionary', SN: 'Consumer Discretionary',
  ETSY: 'Consumer Discretionary', eBay: 'Consumer Discretionary', EBAY: 'Consumer Discretionary',
  // Consumer Staples
  PG: 'Consumer Staples', KO: 'Consumer Staples', PEP: 'Consumer Staples', COST: 'Consumer Staples',
  WMT: 'Consumer Staples', PM: 'Consumer Staples', MO: 'Consumer Staples', CL: 'Consumer Staples',
  MDLZ: 'Consumer Staples', GIS: 'Consumer Staples', K: 'Consumer Staples',
  // Healthcare
  JNJ: 'Healthcare', LLY: 'Healthcare', PFE: 'Healthcare', MRK: 'Healthcare', ABBV: 'Healthcare',
  UNH: 'Healthcare', CVS: 'Healthcare', BMY: 'Healthcare', AMGN: 'Healthcare', GILD: 'Healthcare',
  BIIB: 'Healthcare', VRTX: 'Healthcare', REGN: 'Healthcare', MRNA: 'Healthcare', CRL: 'Healthcare',
  MDT: 'Healthcare', ABT: 'Healthcare', SYK: 'Healthcare', BSX: 'Healthcare', ZBH: 'Healthcare',
  // Financials
  JPM: 'Financials', BAC: 'Financials', WFC: 'Financials', GS: 'Financials', MS: 'Financials',
  C: 'Financials', USB: 'Financials', PNC: 'Financials', TFC: 'Financials', AXP: 'Financials',
  V: 'Financials', MA: 'Financials', BLK: 'Financials', SCHW: 'Financials', COF: 'Financials',
  NU: 'Financials', HOOD: 'Financials', ICE: 'Financials', CME: 'Financials',
  // Industrials
  GE: 'Industrials', GEV: 'Industrials', BA: 'Industrials', RTX: 'Industrials', LMT: 'Industrials',
  NOC: 'Industrials', GD: 'Industrials', HON: 'Industrials', CAT: 'Industrials', DE: 'Industrials',
  UPS: 'Industrials', FDX: 'Industrials', DAL: 'Industrials', UAL: 'Industrials', AAL: 'Industrials',
  LUV: 'Industrials', DOV: 'Industrials', EMR: 'Industrials', ETN: 'Industrials', PH: 'Industrials',
  JOBY: 'Industrials', ACHR: 'Industrials',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy', OXY: 'Energy',
  PSX: 'Energy', VLO: 'Energy', MPC: 'Energy', EOG: 'Energy', PXD: 'Energy',
  // Real Estate
  AMT: 'Real Estate', PLD: 'Real Estate', EQIX: 'Real Estate', SPG: 'Real Estate',
  O: 'Real Estate', WELL: 'Real Estate', PSA: 'Real Estate',
  // Materials
  LIN: 'Materials', APD: 'Materials', ECL: 'Materials', DD: 'Materials', NEM: 'Materials', FCX: 'Materials',
  // Utilities
  NEE: 'Utilities', DUK: 'Utilities', SO: 'Utilities', AEP: 'Utilities', EXC: 'Utilities',
  // ETFs
  ITA: 'ETFs', BUG: 'ETFs', ITB: 'ETFs', GGLL: 'ETFs', QQQI: 'ETFs', MSTY: 'ETFs',
  SPY: 'ETFs', QQQ: 'ETFs', IWM: 'ETFs', VTI: 'ETFs', VGT: 'ETFs', XLK: 'ETFs',
  XLF: 'ETFs', XLV: 'ETFs', XLE: 'ETFs', XLI: 'ETFs', XLY: 'ETFs', XLP: 'ETFs',
  AVUV: 'ETFs', FFLC: 'ETFs', NUKZ: 'ETFs', REMX: 'ETFs', SPMO: 'ETFs', FBTC: 'ETFs',
  // Additional Equities (Empower)
  CEG: 'Utilities', PCG: 'Utilities',
  SMR: 'Energy',
  WM: 'Industrials',
  SRAD: 'Communication Services',
  // Additional Equities (Robinhood)
  CMI: 'Industrials', HII: 'Industrials', AVAV: 'Industrials', AIR: 'Industrials',
  MPLX: 'Energy',
  MP: 'Materials',
  CAVA: 'Consumer Discretionary', BYDDY: 'Consumer Discretionary',
  ARKQ: 'ETFs', ARKK: 'ETFs', MAGY: 'ETFs', GPIX: 'ETFs', IVES: 'ETFs',
  NAIL: 'ETFs', NVDX: 'ETFs', PLTZ: 'ETFs', SSPC: 'ETFs',
};

module.exports = { TICKER_SECTORS };
