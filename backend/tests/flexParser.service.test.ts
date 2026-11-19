import {
  parseFlexCsv, resolveMapping, FlexMappingMismatchError, assertWithinTemplateSampleLimit,
  TemplateSampleTooLargeError, MAX_TEMPLATE_SAMPLE_LINES,
} from '../src/services/flexParser.service';
import { buildHoldingsFromMappedRows } from '../src/services/parser.service';

describe('resolveMapping', () => {
  test('resolves a column mapping against a file\'s real headers, matched by normalized text not position', () => {
    const headers = ['Ticker', 'Shares', 'Price'];
    const mapping = { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' };
    expect(resolveMapping(headers, mapping)).toEqual({ symbol: 0, quantity: 1, currentPrice: 2 });
  });

  test('is resilient to a later upload with the same headers in a different order', () => {
    const headers = ['Price', 'Ticker', 'Shares']; // reordered vs. the template's original file
    const mapping = { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' };
    expect(resolveMapping(headers, mapping)).toEqual({ symbol: 1, quantity: 2, currentPrice: 0 });
  });

  test('matches headers case/whitespace/underscore-insensitively, same normalization as mapHeaders()', () => {
    const headers = ['  TICKER_symbol  ', 'shares', 'PRICE'];
    const mapping = { symbol: 'ticker symbol', quantity: 'Shares', currentPrice: 'price' };
    expect(resolveMapping(headers, mapping)).toEqual({ symbol: 0, quantity: 1, currentPrice: 2 });
  });

  test('throws FlexMappingMismatchError naming any mapped header no longer present in the file', () => {
    const headers = ['Ticker', 'Shares'];
    const mapping = { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' }; // "Price" renamed/missing
    expect(() => resolveMapping(headers, mapping)).toThrow(FlexMappingMismatchError);
    expect(() => resolveMapping(headers, mapping)).toThrow(/currentPrice.*"Price"/);
  });

  test('throws when a mandatory field is absent from the mapping entirely', () => {
    const headers = ['Ticker', 'Shares'];
    const mapping = { symbol: 'Ticker', quantity: 'Shares' }; // currentPrice never mapped at all
    expect(() => resolveMapping(headers, mapping)).toThrow(/missing mandatory fields: currentPrice/);
  });
});

describe('parseFlexCsv', () => {
  test('produces the same HoldingEntry output as buildHoldingsFromMappedRows given an equivalent map - proves Flex and Legacy share real logic', () => {
    const csv = 'Ticker,Shares,Price,Cost\nAAPL,10,180,150';
    const mapping = { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price', purchasePrice: 'Cost' };

    const viaFlex = parseFlexCsv(csv, mapping);

    const equivalentMap = { symbol: 0, quantity: 1, currentPrice: 2, purchasePrice: 3 };
    const rows = [{ Ticker: 'AAPL', Shares: '10', Price: '180', Cost: '150' }];
    const viaShared = buildHoldingsFromMappedRows(rows, equivalentMap);

    expect(viaFlex).toEqual(viaShared);
    expect(viaFlex.data[0]).toMatchObject({ symbol: 'AAPL', quantity: 10, currentPrice: 180, purchasePrice: 150 });
  });

  test('defaults to the file\'s first row/column (1-based) - no title-row detection, unlike Legacy', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping);
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('MSFT');
  });

  test('skips preamble rows above the real header row when headerRowIndex is given (e.g. a Schwab-style export)', () => {
    const csv = 'Positions for account XXXX\nAs of 08/14/2026\nSymbol,Quantity,Current Price\nMSFT,5,300';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping, { headerRowIndex: 3 });
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('MSFT');
  });

  test('skips a leading label column when dataStartColumnIndex is given', () => {
    const csv = 'Row,Symbol,Quantity,Current Price\n1,MSFT,5,300';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping, { dataStartColumnIndex: 2 });
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('MSFT');
  });

  test('combines a non-default header row and data start column', () => {
    const csv = 'Account Summary\nRow,Symbol,Quantity,Current Price\nfoo,MSFT,5,300';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping, { headerRowIndex: 2, dataStartColumnIndex: 2 });
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('MSFT');
  });

  test('throws when headerRowIndex is out of range (0, or beyond the file\'s row count)', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    expect(() => parseFlexCsv(csv, mapping, { headerRowIndex: 0 })).toThrow(/Header row 0 is out of range/);
    expect(() => parseFlexCsv(csv, mapping, { headerRowIndex: 5 })).toThrow(/Header row 5 is out of range/);
  });

  test('throws when dataStartColumnIndex is out of range', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    expect(() => parseFlexCsv(csv, mapping, { dataStartColumnIndex: 0 })).toThrow(/Data start column 0 is out of range/);
    expect(() => parseFlexCsv(csv, mapping, { dataStartColumnIndex: 10 })).toThrow(/Data start column 10 is out of range/);
  });

  test('a full parse always runs - an error in a later row surfaces even though "Inspect Data" only displays a top-5 slice', () => {
    const rows = ['AAPL,10,180'];
    for (let i = 0; i < 6; i++) rows.push(`BAD${i},0,180`); // invalid quantity, past row 5
    const csv = `Symbol,Quantity,Current Price\n${rows.join('\n')}`;
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data, errors } = parseFlexCsv(csv, mapping);
    expect(data).toHaveLength(1); // only AAPL is valid
    expect(errors).toHaveLength(6); // every BAD row's error is present, not just ones within a 5-row preview
  });

  test('throws FlexMappingMismatchError when the file no longer matches the saved mapping', () => {
    const csv = 'Symbol,Quantity\nAAPL,10'; // Current Price column missing entirely
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    expect(() => parseFlexCsv(csv, mapping)).toThrow(FlexMappingMismatchError);
  });

  // Real bug, reported live: a blank line before the header row (common in broker exports -
  // a blank separator between the account-info preamble and the real header) used to make
  // Papa.parse's skipEmptyLines drop it before headerRowIndex was applied, so array position
  // "row 3" landed on a real data row instead of the header. Fixed by not skipping empty lines
  // at all, keeping this function's row-indexing 1:1 with the wizard's own raw line-based grid.
  test('a blank line before the header row no longer shifts headerRowIndex onto a data row', () => {
    const csv = [
      'Positions for account ...1234 as of 08/26/2026',
      '',
      'Symbol,Description,Qty (Quantity),Price',
      'GD,GENERAL DYNAMICS CORP,7.4374,395.50',
      'AAPL,APPLE INC,10,220.00',
    ].join('\n');
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Qty (Quantity)', currentPrice: 'Price' };
    const { data } = parseFlexCsv(csv, mapping, { headerRowIndex: 3 });
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.symbol)).toEqual(['GD', 'AAPL']);
  });

  test('a blank row within the data area is silently skipped, not an error', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300\n\nAAPL,10,180';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data, errors } = parseFlexCsv(csv, mapping);
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.symbol)).toEqual(['MSFT', 'AAPL']);
    expect(errors).toHaveLength(0);
  });

  test('a footer marker found mid-file excludes it and everything after', () => {
    const csv = [
      'Symbol,Quantity,Current Price',
      'MSFT,5,300',
      'AAPL,10,180',
      'Total,,',
      'Data provided by Example Broker',
    ].join('\n');
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping, { footerMarkerColumnIndex: 1, footerMarkerText: 'Total' });
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.symbol)).toEqual(['MSFT', 'AAPL']);
  });

  test('footer marker matching is a case-insensitive substring, not an exact match', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300\nPosition Total,,';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping, { footerMarkerColumnIndex: 1, footerMarkerText: 'total' });
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('MSFT');
  });

  test('a footer marker that never matches parses to the real end of file, not an error', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300\nAAPL,10,180';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data } = parseFlexCsv(csv, mapping, { footerMarkerColumnIndex: 1, footerMarkerText: 'Total' });
    expect(data).toHaveLength(2);
  });

  test('footer options are ignored unless both column index and text are given', () => {
    const csv = 'Symbol,Quantity,Current Price\nMSFT,5,300\nTotal,,';
    const mapping = { symbol: 'Symbol', quantity: 'Quantity', currentPrice: 'Current Price' };
    const withOnlyColumn = parseFlexCsv(csv, mapping, { footerMarkerColumnIndex: 1 });
    expect(withOnlyColumn.data).toHaveLength(1); // "Total" row fails quantity/price validation, not excluded by footer logic
    const withOnlyText = parseFlexCsv(csv, mapping, { footerMarkerText: 'Total' });
    expect(withOnlyText.data).toHaveLength(1);
  });
});

describe('cash/cash-equivalent row detection', () => {
  test('a single matching row is excluded from holdings and its value redirected into cashAmount via a separate value column', () => {
    const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH,CASH & CASH INVESTMENTS,,$500.00';
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const cashConfig = { markerColumnIndex: 2, markerText: 'CASH & CASH INVESTMENTS', valueSource: { type: 'column' as const, columnIndex: 4 } };
    const { data, cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('AAPL');
    expect(cashAmount).toBe(500);
  });

  test('multiple matching rows are all excluded and their values summed', () => {
    const csv = [
      'Symbol,Description,Quantity,Current Price',
      'AAPL,APPLE INC,10,180',
      'CASH,CASH & CASH INVESTMENTS,,$300.00',
      'MSFT,MICROSOFT CORP,5,300',
      'CASH,CASH & CASH INVESTMENTS,,$200.00',
    ].join('\n');
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const cashConfig = { markerColumnIndex: 2, markerText: 'CASH & CASH INVESTMENTS', valueSource: { type: 'column' as const, columnIndex: 4 } };
    const { data, cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(cashAmount).toBe(500);
  });

  test('falls back to quantity x currentPrice when valueSource is omitted (auto mode)', () => {
    const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH,MONEY MARKET,50,1';
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data, cashAmount } = parseFlexCsv(csv, mapping, { cashConfig: { markerColumnIndex: 2, markerText: 'MONEY MARKET' } });
    expect(data).toHaveLength(1);
    expect(cashAmount).toBe(50); // 50 * 1
  });

  test('falls back to quantity x currentPrice when the configured value column does not parse', () => {
    const csv = 'Symbol,Description,Quantity,Current Price,Value\nAAPL,APPLE INC,10,180,$1800.00\nCASH,MONEY MARKET,50,1,N/A';
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const cashConfig = { markerColumnIndex: 2, markerText: 'MONEY MARKET', valueSource: { type: 'column' as const, columnIndex: 5 } };
    const { cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
    expect(cashAmount).toBe(50); // Value column ("N/A") unparseable - falls back to 50 * 1
  });

  test('handles a parenthetical-negative cash value via the shared parseCashAmt (separate column)', () => {
    const csv = 'Symbol,Description,Quantity,Current Price,Value\nAAPL,APPLE INC,10,180,$1800.00\nCASH,PENDING ACTIVITY,,,(125.50)';
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const cashConfig = { markerColumnIndex: 2, markerText: 'PENDING ACTIVITY', valueSource: { type: 'column' as const, columnIndex: 5 } };
    const { cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
    expect(cashAmount).toBe(-125.5);
  });

  test('no cash marker configured - behavior is completely unchanged', () => {
    const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH & CASH INVESTMENTS,,,';
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const { data, cashAmount } = parseFlexCsv(csv, mapping);
    expect(data).toHaveLength(1); // the cash row fails normal quantity validation and is dropped, uncounted
    expect(cashAmount).toBe(0);
  });

  test('a marker that matches nothing has no effect, regardless of valueSource', () => {
    const csv = 'Symbol,Description,Quantity,Current Price,Value\nAAPL,APPLE INC,10,180,$1800.00\nCASH,CASH & CASH INVESTMENTS,,,$500.00';
    const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
    const cashConfig = { markerColumnIndex: 2, markerText: 'Nonexistent Label', valueSource: { type: 'column' as const, columnIndex: 5 } };
    const { data, cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
    expect(data).toHaveLength(1); // the real cash row still fails normal validation, not redirected
    expect(cashAmount).toBe(0);
  });

  describe('embedded value source (Pattern #2 - identifier and value fused into one cell)', () => {
    test('extracts the value fused into the marker cell itself', () => {
      const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH,"Cash, Money Funds and Bank Deposits: $2,143.67",,';
      const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
      const cashConfig = { markerColumnIndex: 2, markerText: 'Cash, Money Funds and Bank Deposits', valueSource: { type: 'embedded' as const } };
      const { data, cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
      expect(data).toHaveLength(1);
      expect(data[0].symbol).toBe('AAPL');
      expect(cashAmount).toBe(2143.67);
    });

    test('handles a parenthetical-negative embedded value', () => {
      const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH,Pending Activity (125.50),,';
      const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
      const cashConfig = { markerColumnIndex: 2, markerText: 'Pending Activity', valueSource: { type: 'embedded' as const } };
      const { cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
      expect(cashAmount).toBe(-125.5);
    });

    test('falls back to quantity x currentPrice when the marker cell has no parseable number', () => {
      const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH,Cash & Cash Investments,50,1';
      const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
      const cashConfig = { markerColumnIndex: 2, markerText: 'Cash & Cash Investments', valueSource: { type: 'embedded' as const } };
      const { cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
      expect(cashAmount).toBe(50); // no number in the marker cell - falls back to 50 * 1
    });

    test('picks the LAST currency-looking token when the marker text itself contains a digit', () => {
      const csv = 'Symbol,Description,Quantity,Current Price\nAAPL,APPLE INC,10,180\nCASH,Q4 Cash Reserve 1234.56,,';
      const mapping = { symbol: 'Symbol', name: 'Description', quantity: 'Quantity', currentPrice: 'Current Price' };
      const cashConfig = { markerColumnIndex: 2, markerText: 'Q4 Cash Reserve', valueSource: { type: 'embedded' as const } };
      const { cashAmount } = parseFlexCsv(csv, mapping, { cashConfig });
      expect(cashAmount).toBe(1234.56);
    });
  });
});

describe('assertWithinTemplateSampleLimit', () => {
  test(`accepts a file with exactly ${MAX_TEMPLATE_SAMPLE_LINES} lines`, () => {
    const text = new Array(MAX_TEMPLATE_SAMPLE_LINES).fill('a,b,c').join('\n');
    expect(() => assertWithinTemplateSampleLimit(text)).not.toThrow();
  });

  test(`rejects a file with ${MAX_TEMPLATE_SAMPLE_LINES + 1} lines`, () => {
    const text = new Array(MAX_TEMPLATE_SAMPLE_LINES + 1).fill('a,b,c').join('\n');
    expect(() => assertWithinTemplateSampleLimit(text)).toThrow(TemplateSampleTooLargeError);
    expect(() => assertWithinTemplateSampleLimit(text)).toThrow(new RegExp(`at most ${MAX_TEMPLATE_SAMPLE_LINES} rows`));
  });
});
