import { parseGenericCsv, isRobinhoodTxt, parseRobinhoodTxt, parseFile } from '../src/services/parser.service';

describe('parseGenericCsv', () => {
  test('parses a standard CSV with purchase price + sector columns', () => {
    const csv = 'Symbol,Company Name,Quantity,Purchase Price,Current Price,Sector\nAAPL,Apple Inc.,10,150,180,Technology';
    const { data, errors, cashAmount } = parseGenericCsv(csv);
    expect(errors).toHaveLength(0);
    expect(cashAmount).toBe(0);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ symbol: 'AAPL', quantity: 10, purchasePrice: 150, currentPrice: 180, sector: 'Technology' });
    expect(data[0].costBasis).toBe(1500);
    expect(data[0].currentValue).toBe(1800);
    expect(data[0].gainLoss).toBe(300);
  });

  test('throws on missing required columns', () => {
    const csv = 'Foo,Bar\n1,2';
    expect(() => parseGenericCsv(csv)).toThrow(/Missing required columns/);
  });

  test('falls back to TICKER_SECTORS when no sector column present (Fidelity-style)', () => {
    const csv = 'Symbol,Quantity,Current Price\nAAPL,5,180';
    const { data } = parseGenericCsv(csv);
    expect(data[0].sector).toBe('Technology');
  });

  test('derives purchase price from market value + gain/loss when purchase price column is absent', () => {
    const csv = 'Symbol,Quantity,Current Price,Market Value,Gain/Loss $\nMSFT,10,300,3000,500';
    const { data } = parseGenericCsv(csv);
    // marketValue(3000) - gainLoss(500) = costBasis(2500) / qty(10) = pp 250
    expect(data[0].purchasePrice).toBe(250);
  });

  test('redirects Empower USD999997/DIDA cash placeholder rows into cashAmount, not holdings', () => {
    const csv = 'Symbol,Quantity,Current Price,Market Value\nUSD999997,1,1,500\nAAPL,5,180,900';
    const { data, cashAmount } = parseGenericCsv(csv);
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('AAPL');
    expect(cashAmount).toBe(500);
  });

  test('redirects Fidelity **-suffixed sweep fund rows into cashAmount', () => {
    const csv = 'Symbol,Quantity,Current Price,Market Value\nFDRXX**,1,1,1200.50\nAAPL,5,180,900';
    const { cashAmount, data } = parseGenericCsv(csv);
    expect(cashAmount).toBe(1200.5);
    expect(data).toHaveLength(1);
  });

  test('redirects Pending Activity rows, handling parenthesized negatives as negative cash', () => {
    const csv = 'Symbol,Company Name,Quantity,Current Price,Market Value\nXYZ,Pending Activity,1,1,(45.67)\nAAPL,Apple,5,180,900';
    const { cashAmount, data } = parseGenericCsv(csv);
    expect(cashAmount).toBe(-45.67);
    expect(data).toHaveLength(1);
  });

  test('sums multiple cash-like rows together', () => {
    const csv = 'Symbol,Quantity,Current Price,Market Value\nDIDA,1,1,100\nFDRXX**,1,1,50\nAAPL,5,180,900';
    const { cashAmount } = parseGenericCsv(csv);
    expect(cashAmount).toBe(150);
  });

  test('skips rows with invalid quantity or price and records an error', () => {
    const csv = 'Symbol,Quantity,Current Price\nAAPL,0,180\nMSFT,5,300';
    const { data, errors } = parseGenericCsv(csv);
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('MSFT');
    expect(errors[0]).toMatch(/Invalid quantity/);
  });

  test('resolves header aliases case-insensitively (e.g. "Ticker" / "Shares")', () => {
    const csv = 'Ticker,Shares,Last Price\nAAPL,5,180';
    const { data } = parseGenericCsv(csv);
    expect(data[0]).toMatchObject({ symbol: 'AAPL', quantity: 5, currentPrice: 180 });
  });

  // Excel exports converted to CSV client-side (xlsxToCsv.ts, "Empower format")
  // sometimes have a title/logo row above the real header — this is the
  // server-side detection that skips it, ported from the source app's
  // xlsxSheetToCsv() and relocated here since HEADER_ALIASES lives here.
  test('skips a leading title/banner row and finds the real header row beneath it', () => {
    const csv = 'My Empower Retirement Account\n\nSymbol,Quantity,Current Price\nAAPL,5,180';
    const { data, errors } = parseGenericCsv(csv);
    expect(errors).toHaveLength(0);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ symbol: 'AAPL', quantity: 5, currentPrice: 180 });
  });

  test('falls back to row 0 as the header when no row matches a known alias', () => {
    // No row anywhere contains a recognizable header — parseGenericCsv should
    // still treat row 0 as the header (matching xlsxSheetToCsv's fallback)
    // and fail with "Missing required columns", not crash.
    const csv = 'Foo,Bar,Baz\n1,2,3\n4,5,6';
    expect(() => parseGenericCsv(csv)).toThrow(/Missing required columns/);
  });
});

describe('Robinhood TXT parser', () => {
  const robinhoodTxt = [
    'Name', 'Symbol', 'Shares', 'Price', 'Average cost', 'Total return', 'Equity',
    'Apple Inc.', 'AAPL', '10', '180.00', '150.00', '300.00', '1800.00',
    'Stocks & options',
  ].join('\n');

  test('isRobinhoodTxt detects the 7-line Robinhood header block', () => {
    expect(isRobinhoodTxt(robinhoodTxt)).toBe(true);
    expect(isRobinhoodTxt('Symbol,Quantity\nAAPL,5')).toBe(false);
  });

  test('parseRobinhoodTxt parses a stock holding with cashAmount always 0', () => {
    const { data, cashAmount } = parseRobinhoodTxt(robinhoodTxt);
    expect(cashAmount).toBe(0);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ symbol: 'AAPL', quantity: 10, currentPrice: 180, purchasePrice: 150, currentValue: 1800 });
  });

  test('parseRobinhoodTxt tags crypto section holdings with sector "Crypto"', () => {
    const withCrypto = [
      'Name', 'Symbol', 'Shares', 'Price', 'Average cost', 'Total return', 'Equity',
      'Apple Inc.', 'AAPL', '10', '180.00', '150.00', '300.00', '1800.00',
      'Crypto',
      'Name', 'Symbol', 'Quantity', 'Price', 'Average cost', 'Total return', 'Equity',
      'Bitcoin', 'BTC', '0.5', '60000', '50000', '5000', '30000',
    ].join('\n');
    const { data } = parseRobinhoodTxt(withCrypto);
    expect(data).toHaveLength(2);
    expect(data[1]).toMatchObject({ symbol: 'BTC', sector: 'Crypto' });
  });

  test('parseFile dispatches to the Robinhood parser when the signature matches, generic CSV otherwise', () => {
    expect(parseFile(robinhoodTxt).cashAmount).toBe(0);
    const csv = 'Symbol,Quantity,Current Price\nAAPL,5,180';
    expect(parseFile(csv).data[0].symbol).toBe('AAPL');
  });
});
