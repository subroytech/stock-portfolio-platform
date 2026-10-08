from typing import Optional

from pydantic import BaseModel

# Mirrors backend/src/services/contrarianFinder.service.ts's types
# field-for-field (same hand-maintained-duplicate caveat as every other
# proxied feature). `source` is deliberately absent here - Node attaches it
# to each ScanResult after this call returns, since it comes from the
# UniverseEntry the batch was built from, not from anything Python computes.


class ScanQuality(BaseModel):
    minPrice: float
    minMarketCap: float


class RawQuoteData(BaseModel):
    price: Optional[float] = None
    marketCap: Optional[float] = None
    name: Optional[str] = None
    sector: Optional[str] = None
    volume: Optional[float] = None
    avgVolume: Optional[float] = None


class RawHistoricalBar(BaseModel):
    date: Optional[str] = None
    close: Optional[float] = None
    low: Optional[float] = None


class RawStockData(BaseModel):
    symbol: str
    quote: Optional[RawQuoteData] = None
    historicalBars: list[RawHistoricalBar] = []


class ContrarianFinderScanBatchRequest(BaseModel):
    stocks: list[RawStockData]
    quality: ScanQuality
    scanDays: int = 7


class StrengthSignal(BaseModel):
    rsi: float
    sma20: float
    sma50: float
    rr: float
    kF: float
    halfKelly: float


class ScanResult(BaseModel):
    symbol: str
    filterFail: bool
    noData: Optional[bool] = None
    error: Optional[bool] = None
    name: Optional[str] = None
    sector: Optional[str] = None
    price: Optional[float] = None
    mktCap: Optional[float] = None
    volume: Optional[float] = None
    avgVol: Optional[float] = None
    changePct: Optional[float] = None
    changeSinceDate: Optional[str] = None
    mktClosed: Optional[bool] = None
    strength: Optional[StrengthSignal] = None
