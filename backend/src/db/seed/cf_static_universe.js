// Ported from CreateStockPortfolioViewWOSkill/js/contrarian-finder.js (CF_STATIC) —
// fallback constituent lists used when the FMP plan doesn't cover the
// index-constituent endpoints. Stays a hardcoded JS module for Phase 1 by
// design — moving this into a DB table (index_constituents) is deferred to
// Phase 4 per Architecture.md step 16.

const CF_ETF_LIST = ['XLK', 'XLV', 'XLF', 'XLY', 'XLI', 'XLC', 'XLP', 'XLE', 'XLB', 'XLU', 'XLRE'];

const CF_STATIC = {
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
  sp500: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'BRK-B', 'JPM', 'V',
    'UNH', 'XOM', 'LLY', 'JNJ', 'MA', 'AVGO', 'PG', 'HD', 'MRK', 'COST',
    'CVX', 'ABBV', 'WMT', 'BAC', 'KO', 'PEP', 'CRM', 'ACN', 'MCD', 'TMO',
    'CSCO', 'ABT', 'NFLX', 'LIN', 'WFC', 'AMD', 'DHR', 'ADBE', 'TXN', 'NEE',
    'PM', 'UNP', 'RTX', 'AMGN', 'INTU', 'ISRG', 'CAT', 'GS', 'HON', 'SPGI',
    'LOW', 'BLK', 'ELV', 'SYK', 'BKNG', 'VRTX', 'AXP', 'MDLZ', 'GILD', 'CB',
    'REGN', 'CI', 'MDT', 'C', 'ADI', 'PLD', 'SO', 'MO', 'SCHW', 'MMC',
    'TJX', 'DUK', 'ZTS', 'ETN', 'KLAC', 'CME', 'SHW', 'AON', 'ICE', 'BMY',
    'LRCX', 'NOC', 'HCA', 'FI', 'ITW', 'MCO', 'EQIX', 'ECL', 'GD', 'USB',
    'PSA', 'APH', 'PGR', 'AIG', 'MCHP', 'SNPS', 'CDNS', 'EMR', 'NSC', 'WM',
    'GE', 'MS', 'TGT', 'COF', 'PNC', 'TFC', 'MET', 'PRU', 'AFL', 'ALL',
    'HUM', 'CVS', 'MOH', 'CNC', 'BDX', 'IQV', 'A', 'EW', 'ZBH', 'LH',
    'DGX', 'ROP', 'AME', 'IR', 'ROK', 'FTV', 'TT', 'PH', 'CBRE', 'GWW',
    'KEYS', 'WAT', 'GPN', 'FICO', 'DHI', 'LEN', 'PHM', 'WELL', 'DLR', 'EQR',
    'AVB', 'SPG', 'DG', 'DLTR', 'YUM', 'F', 'GM', 'DAL', 'UAL', 'CCL',
    'RCL', 'HLT', 'HIG', 'MTB', 'HBAN', 'CFG', 'RF', 'TROW', 'BK', 'STT',
    'NTRS', 'AMP', 'IVZ', 'NDAQ', 'CBOE', 'DFS', 'SYF', 'ALLY', 'FSLR', 'ENPH',
    'D', 'PCG', 'ED', 'EIX', 'AEE', 'CNP', 'AWK', 'ARE', 'MAA', 'CPT',
    'HST', 'REG', 'KIM', 'WY', 'CEG', 'NRG', 'EXR', 'CMS', 'FE', 'PPL',
    'RMD', 'STE', 'HOLX', 'MTD', 'WST', 'BAX', 'TDY', 'ZBRA', 'VICI', 'PODD'],
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

module.exports = { CF_ETF_LIST, CF_STATIC };
