import { parseFlexCsv, resolveMapping, FlexMappingMismatchError } from '../src/services/flexParser.service';
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
});
