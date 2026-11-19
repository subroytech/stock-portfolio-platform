// Ported from CreateStockPortfolioViewWOSkill/js/contrarian-finder.js (CF_STATIC) —
// fallback constituent lists used when the FMP plan doesn't cover the
// index-constituent endpoints. Stays a hardcoded module for Phase 1 by
// design — moving this into a DB table (index_constituents) is deferred to
// Phase 4 per Architecture.md step 16.
//
// As of 2026-07-10 this is only read by seedTickerData.ts (the one-time seed
// script for m_index_master/m_index_constituent) — contrarianFinder.service.ts
// queries the DB directly instead of importing this module for live scans.

export const CF_ETF_LIST: string[] = ['XLK', 'XLV', 'XLF', 'XLY', 'XLI', 'XLC', 'XLP', 'XLE', 'XLB', 'XLU', 'XLRE'];

interface CfStatic {
  dj30: string[];
  ndx100: string[];
  sp500: string[];
  etf: Record<string, string[]>;
}

export const CF_STATIC: CfStatic = {
  dj30: ['AAPL', 'AMGN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'DOW',
    'GS', 'HD', 'HON', 'IBM', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK',
    'MSFT', 'NKE', 'NVDA', 'PG', 'SHW', 'TRV', 'UNH', 'V', 'VZ', 'WMT'],
  ndx100: ['ADBE', 'ADI', 'ADP', 'ADSK', 'AEP', 'AMAT', 'AMD', 'AMGN', 'AMZN', 'ANSS',
    'APP', 'ASML', 'AVGO', 'BKNG', 'BKR', 'CDNS', 'CDW', 'CEG', 'CHTR', 'CMCSA',
    'COST', 'CPRT', 'CRWD', 'CSCO', 'CSGP', 'CSX', 'CTAS', 'CTSH', 'DDOG', 'DLTR',
    'DXCM', 'EA', 'EXC', 'FANG', 'FAST', 'FTNT', 'GEHC', 'GILD', 'GOOG', 'GOOGL',
    'HON', 'IDXX', 'ILMN', 'INTC', 'INTU', 'ISRG', 'KDP', 'KHC', 'KLAC', 'LRCX',
    'LULU', 'MAR', 'MDLZ', 'META', 'MELI', 'MNST', 'MRNA', 'MRVL', 'MSFT', 'MU',
    'NFLX', 'NVDA', 'NXPI', 'ODFL', 'ON', 'ORLY', 'PCAR', 'PAYX', 'PANW', 'PDD',
    'PYPL', 'QCOM', 'REGN', 'ROST', 'SBUX', 'SNPS', 'TEAM', 'TMUS', 'TSLA', 'TTD',
    'TXN', 'VRSK', 'WDAY', 'XEL', 'ZS', 'ABNB', 'BIIB', 'DLTR', 'FAST', 'WBD'],
  // Regenerated 2026-08-05 from a live FMP /stable/company-screener pull, sorted by real
  // market cap, top 400 - not an official S&P 500 membership feed (that endpoint 402'd on
  // the current plan tier; legacy /v3/sp500_constituent is fully retired), so this is a
  // market-cap-ranked proxy, hand-reviewed for data-quality issues (preferred stock/notes/
  // trusts/OTC subsidiary instruments and a private company all appeared in the raw screener
  // results and were filtered out; true dual-class companies like GOOG/GOOGL and FOX/FOXA
  // keep both classes, matching this file's own etf.XLC precedent; genuine duplicate-feed
  // artifacts like APO/APOS and MMC/MRSH were resolved to the real primary ticker). Known,
  // accepted residual risk: a handful of very recently IPO'd/spun-off large-cap companies
  // (e.g. HONA, CBRS, Q, P, VG, MDLN) may not yet be official S&P 500 members despite
  // clearing the market-cap bar - same tradeoff already true of the original 200-symbol list.
  sp500: ['A', 'AAPL', 'ABBV', 'ABNB', 'ABT', 'ADBE', 'ADI', 'ADM', 'ADP', 'ADSK',
    'AEE', 'AEP', 'AFL', 'AFRM', 'AIG', 'AJG', 'ALAB', 'ALL', 'ALNY', 'AMAT',
    'AMD', 'AME', 'AMGN', 'AMP', 'AMT', 'AMZN', 'ANET', 'APD', 'APH', 'APO',
    'APP', 'ARES', 'ASTS', 'ATI', 'ATO', 'AU', 'AVB', 'AVGO', 'AWK', 'AXON',
    'AXP', 'AZO', 'BA', 'BAC', 'BAM', 'BDX', 'BE', 'BIIB', 'BKNG', 'BKR',
    'BLK', 'BMY', 'BNY', 'BRK-B', 'BSX', 'BX', 'C', 'CAH', 'CARR', 'CASY',
    'CAT', 'CBRE', 'CBRS', 'CCI', 'CCL', 'CDNS', 'CEG', 'CFG', 'CHD', 'CI',
    'CIEN', 'CINF', 'CL', 'CMCSA', 'CME', 'CMG', 'CMI', 'CNC', 'CNP', 'COF',
    'COHR', 'COIN', 'COP', 'COR', 'COST', 'CPAY', 'CPNG', 'CPRT', 'CQP', 'CRM',
    'CRS', 'CRWD', 'CRWV', 'CSCO', 'CSX', 'CTAS', 'CTSH', 'CTVA', 'CVNA', 'CVS',
    'CVX', 'CW', 'D', 'DAL', 'DASH', 'DDOG', 'DE', 'DELL', 'DG', 'DGX',
    'DHI', 'DHR', 'DIS', 'DLTR', 'DOV', 'DTE', 'DUK', 'DVN', 'DXCM', 'EA',
    'EBAY', 'ECL', 'ED', 'EIX', 'EL', 'ELV', 'EME', 'EMR', 'EOG', 'EPD',
    'EQIX', 'EQR', 'EQT', 'ES', 'ET', 'ETR', 'EW', 'EXC', 'EXPE', 'EXR',
    'F', 'FANG', 'FAST', 'FCNCA', 'FCX', 'FDX', 'FE', 'FERG', 'FISV', 'FITB',
    'FIX', 'FLEX', 'FOXA', 'FSLR', 'FTNT', 'FWONK', 'GD', 'GE', 'GEHC', 'GEV',
    'GFS', 'GILD', 'GLW', 'GM', 'GOOG', 'GOOGL', 'GS', 'GWW', 'HAL', 'HBAN',
    'HCA', 'HD', 'HEI', 'HIG', 'HLT', 'HON', 'HONA', 'HOOD', 'HPE', 'HPQ',
    'HSY', 'HUBB', 'HUM', 'HWM', 'IBKR', 'IBM', 'ICE', 'IDXX', 'ILMN', 'INCY',
    'INTC', 'INTU', 'IQV', 'IR', 'IRM', 'ISRG', 'ITW', 'JBHT', 'JBL', 'JNJ',
    'JPM', 'KDP', 'KEY', 'KEYS', 'KHC', 'KKR', 'KLAC', 'KMB', 'KMI', 'KO',
    'KR', 'KVUE', 'LH', 'LHX', 'LITE', 'LLY', 'LMT', 'LNG', 'LOW', 'LPLA',
    'LRCX', 'LVS', 'LYV', 'MA', 'MAR', 'MCD', 'MCHP', 'MCK', 'MCO', 'MDB',
    'MDLN', 'MDLZ', 'MET', 'META', 'MLM', 'MMC', 'MMM', 'MNST', 'MO', 'MPC',
    'MPLX', 'MPWR', 'MRK', 'MRVL', 'MS', 'MSCI', 'MSFT', 'MSI', 'MSTR', 'MTB',
    'MTD', 'MU', 'NDAQ', 'NEE', 'NEM', 'NET', 'NFLX', 'NKE', 'NOC', 'NOW',
    'NRG', 'NSC', 'NTAP', 'NTRA', 'NUE', 'NVDA', 'O', 'ODFL', 'OKE', 'OKTA',
    'ON', 'ORCL', 'ORLY', 'OTIS', 'OXY', 'P', 'PANW', 'PAYX', 'PCAR', 'PCG',
    'PEG', 'PEP', 'PFE', 'PFG', 'PG', 'PGR', 'PH', 'PHM', 'PLD', 'PLTR',
    'PM', 'PNC', 'PPG', 'PPL', 'PRU', 'PSA', 'PSX', 'PWR', 'PYPL', 'Q',
    'QCOM', 'QSR', 'RBLX', 'RCL', 'RDDT', 'REGN', 'RF', 'RJF', 'RKLB', 'RKT',
    'RMD', 'ROK', 'ROP', 'ROST', 'RPRX', 'RSG', 'RTX', 'RVMD', 'SATS', 'SBUX',
    'SCCO', 'SCHW', 'SHW', 'SLB', 'SNDK', 'SNOW', 'SNPS', 'SO', 'SPG', 'SPGI',
    'SRE', 'STLD', 'STT', 'SUNB', 'SYF', 'SYK', 'SYM', 'SYY', 'T', 'TDG',
    'TDY', 'TEAM', 'TER', 'TFC', 'TGT', 'TJX', 'TMO', 'TMUS', 'TPL', 'TPR',
    'TRGP', 'TROW', 'TRV', 'TSLA', 'TTWO', 'TWLO', 'TXN', 'UAL', 'UBER', 'UI',
    'UNH', 'UNP', 'UPS', 'URI', 'USB', 'V', 'VEEV', 'VG', 'VICI', 'VLO',
    'VMC', 'VRSK', 'VRSN', 'VRT', 'VRTX', 'VST', 'VTR', 'VZ', 'WAB', 'WAT',
    'WBD', 'WDAY', 'WDC', 'WEC', 'WELL', 'WFC', 'WM', 'WMB', 'WMT', 'WRB',
    'WSM', 'WST', 'XEL', 'XOM', 'XYL', 'XYZ', 'YUM', 'ZM', 'ZS', 'ZTS'],
  etf: {
    XLK: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'ADBE', 'CRM', 'AMD', 'ACN', 'TXN', 'QCOM', 'INTU', 'IBM', 'AMAT', 'CSCO', 'NOW', 'PANW', 'PLTR', 'MU', 'ADI'],
    XLV: ['UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'ABT', 'TMO', 'AMGN', 'DHR', 'ISRG', 'GILD', 'BSX', 'MDT', 'REGN', 'VRTX', 'SYK', 'ELV', 'CI', 'CVS', 'BMY'],
    XLF: ['BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'SPGI', 'BLK', 'C', 'CB', 'PGR', 'MMC', 'CME', 'ICE', 'AON', 'TRV', 'USB'],
    XLY: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG', 'CMG', 'ORLY', 'ROST', 'YUM', 'DHI', 'F', 'GM', 'HLT', 'MGM', 'EXPE', 'EBAY'],
    XLI: ['GE', 'RTX', 'HON', 'CAT', 'UNP', 'ETN', 'LMT', 'DE', 'ITW', 'EMR', 'NSC', 'WM', 'PH', 'FDX', 'GD', 'NOC', 'CSX', 'URI', 'PCAR', 'AME'],
    XLC: ['META', 'GOOGL', 'GOOG', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'EA', 'TTWO', 'WBD', 'OMC', 'IPG', 'LYV', 'FOXA', 'FOX', 'MTCH', 'PARA', 'NWSA'],
    XLP: ['WMT', 'PG', 'COST', 'KO', 'PEP', 'PM', 'MDLZ', 'CL', 'GIS', 'STZ', 'KMB', 'SYY', 'MO', 'HRL', 'TSN', 'KR', 'EL', 'CHD', 'CAG', 'CPB'],
    XLE: ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'OXY', 'HAL', 'DVN', 'HES', 'BKR', 'MRO', 'FANG', 'APA', 'EQT', 'CTRA', 'OKE', 'KMI'],
    XLB: ['LIN', 'SHW', 'APD', 'ECL', 'NEM', 'FCX', 'NUE', 'CTVA', 'DD', 'MLM', 'VMC', 'PPG', 'ALB', 'CF', 'MOS', 'IP', 'PKG', 'FMC', 'CE', 'IFF'],
    XLU: ['NEE', 'DUK', 'SO', 'AEP', 'PCG', 'SRE', 'D', 'EXC', 'XEL', 'WEC', 'ES', 'ETR', 'PPL', 'FE', 'CMS', 'ATO', 'NI', 'OGE', 'LNT', 'EVRG'],
    XLRE: ['AMT', 'PLD', 'EQIX', 'CCI', 'PSA', 'O', 'WELL', 'DLR', 'SPG', 'AVB', 'EQR', 'VICI', 'WY', 'ARE', 'MAA', 'CPT', 'UDR', 'HST', 'REG', 'KIM'],
  },
};
