from typing import Literal, Optional

from pydantic import BaseModel


class IncomeStatementPeriod(BaseModel):
    fiscalYear: Optional[str] = None
    revenue: Optional[float] = None
    grossProfit: Optional[float] = None
    operatingIncome: Optional[float] = None
    netIncome: Optional[float] = None
    eps: Optional[float] = None  # diluted EPS — Node normalizes eps ?? epsDiluted before sending


class EarningsSurprise(BaseModel):
    date: Optional[str] = None
    epsActual: Optional[float] = None
    epsEstimated: Optional[float] = None


class PriceTarget(BaseModel):
    targetConsensus: Optional[float] = None
    targetHigh: Optional[float] = None
    targetLow: Optional[float] = None


class AnalystGrade(BaseModel):
    gradingCompany: str
    newGrade: str
    date: str


class PeerQuote(BaseModel):
    symbol: str
    price: Optional[float] = None
    trailingPe: Optional[float] = None
    evToEbitda: Optional[float] = None
    marketCap: Optional[float] = None


class NewsItem(BaseModel):
    date: Optional[str] = None
    title: str
    source: Optional[str] = None
    url: Optional[str] = None


class LongTermAnalysisRequest(BaseModel):
    symbol: str
    companyName: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    exchange: Optional[str] = None
    price: float
    marketCap: Optional[float] = None
    beta: Optional[float] = None
    range52w: Optional[str] = None
    lastDividend: Optional[float] = None
    incomeStatements: list[IncomeStatementPeriod] = []
    earningsSurprises: list[EarningsSurprise] = []
    priceTarget: Optional[PriceTarget] = None
    grades: list[AnalystGrade] = []
    peers: list[PeerQuote] = []
    forwardEpsEstimate: Optional[float] = None
    evToEbitda: Optional[float] = None
    news: list[NewsItem] = []


class ConvictionResult(BaseModel):
    rating: Literal['bullish', 'neutral', 'bearish']
    score: int
    rationale: str


class AnalystConsensus(BaseModel):
    strongBuy: int = 0
    buy: int = 0
    hold: int = 0
    sell: int = 0
    strongSell: int = 0
    totalAnalysts: int = 0
    buyPct: int = 0
    holdPct: int = 0
    sellPct: int = 0


class ValuationMetrics(BaseModel):
    trailingPe: Optional[float] = None
    forwardPe: Optional[float] = None
    evToEbitda: Optional[float] = None
    peerAvgTrailingPe: Optional[float] = None
    peerAvgEvToEbitda: Optional[float] = None
    peerCount: int = 0


class GrowthMetric(BaseModel):
    current: Optional[float] = None
    prior: Optional[float] = None
    yoyPct: Optional[float] = None


class MarginMetric(BaseModel):
    current: Optional[float] = None
    prior: Optional[float] = None
    deltaPp: Optional[float] = None


class FinancialGrowth(BaseModel):
    fyLabel: Optional[str] = None
    fyPrevLabel: Optional[str] = None
    revenue: GrowthMetric
    grossMargin: MarginMetric
    operatingMargin: MarginMetric
    eps: GrowthMetric
    # Net-income YoY growth — used only by the conviction score (source app's
    # deriveConviction() had a *different* local variable it called
    # "epsGrowth" that was actually netIncome-based; this field is that value,
    # kept distinct from `eps.yoyPct` above which is genuine EPS growth used
    # for display and the bull/bear signals).
    netIncomeGrowthPct: Optional[float] = None


class LongTermAnalysisResponse(BaseModel):
    symbol: str
    companyName: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    exchange: Optional[str] = None
    price: float
    marketCap: Optional[float] = None
    beta: Optional[float] = None
    range52w: Optional[str] = None
    dividend: Optional[float] = None
    valuation: ValuationMetrics
    financials: FinancialGrowth
    earningsSurprises: list[EarningsSurprise] = []
    priceTarget: Optional[PriceTarget] = None
    upsidePct: Optional[float] = None
    consensus: AnalystConsensus
    peers: list[PeerQuote] = []
    peerNote: str
    bullSignals: list[str] = []
    bearSignals: list[str] = []
    mediumTerm: ConvictionResult
    longTerm: ConvictionResult
    news: list[NewsItem] = []
