from typing import Literal, Optional

from pydantic import BaseModel, Field


class DailyBar(BaseModel):
    date: str
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = None


class PriceTargetInfo(BaseModel):
    targetConsensus: Optional[float] = None
    targetHigh: Optional[float] = None
    targetLow: Optional[float] = None


class GradeRecord(BaseModel):
    gradingCompany: Optional[str] = None
    newGrade: Optional[str] = None
    action: Optional[str] = None  # 'upgrade' | 'downgrade' | other, as reported by FMP
    date: Optional[str] = None


class InsiderTrade(BaseModel):
    transactionDate: Optional[str] = None
    transactionType: Optional[str] = None
    acquisitionOrDisposition: Optional[str] = None
    securitiesTransacted: Optional[float] = None
    price: Optional[float] = None
    reportingName: Optional[str] = None


class NewsItem(BaseModel):
    date: Optional[str] = None
    title: str
    source: Optional[str] = None
    url: Optional[str] = None


class IncomeStatementPeriod(BaseModel):
    revenue: Optional[float] = None
    grossProfit: Optional[float] = None


class ContrarianComebackData(BaseModel):
    """Everything Node fetches/normalizes from FMP (+ optional Finnhub news)
    for one symbol. Shared by both the gate-preview and submit requests —
    both endpoints re-derive the same auto-checks from this, independently
    and statelessly, matching Contrarian Finder's per-batch
    assembleUniverse() philosophy (safe/cheap to recompute)."""

    symbol: str
    companyName: Optional[str] = None
    sector: Optional[str] = None
    exchange: Optional[str] = None
    price: float
    marketCap: Optional[float] = None
    yearHigh: Optional[float] = None
    peRatio: Optional[float] = None  # profile.pe ?? quote.pe, Node-normalized
    incomeStatements: list[IncomeStatementPeriod] = []  # 2 most recent annual periods, newest first
    dailyBars: list[DailyBar] = []  # stock, newest-first, up to 1000 bars
    etfSymbol: Optional[str] = None  # SECTOR_ETF[sector], resolved by Node
    etfDailyBars: list[DailyBar] = []  # newest-first, up to 260 bars; empty if no ETF mapped
    priceTarget: Optional[PriceTargetInfo] = None
    grades: list[GradeRecord] = []
    insiderTrades: list[InsiderTrade] = []
    news: list[NewsItem] = []
    # Phase 2 - most recent annual balance-sheet / cash-flow figures only (no
    # prior-year comparison needed for DE/currentR/FCF/cashRun, unlike revenue growth).
    totalDebt: Optional[float] = None
    totalStockholdersEquity: Optional[float] = None
    totalCurrentAssets: Optional[float] = None
    totalCurrentLiabilities: Optional[float] = None
    cashAndCashEquivalents: Optional[float] = None
    operatingCashFlow: Optional[float] = None
    capitalExpenditure: Optional[float] = None


class ContrarianComebackGateResponse(BaseModel):
    symbol: str
    check1Pass: bool
    drawdownPct: float
    dd52w: float
    dd4y: float
    check3Status: Literal['pass', 'override_available', 'hard_block']
    etfSymbol: Optional[str] = None
    etfReturn6M: Optional[float] = None
    check4Pass: bool
    recentNews: list[NewsItem] = []
    insiderSignal: str
    insiderBuys: int
    insiderSells: int
    analystUpgrades90d: int
    analystDowngrades90d: int
    priceTargetAvg: Optional[float] = None
    analystUpsidePct: Optional[float] = None
    # Non-null only when an auto-check (1, 3-hard-block, or 4) already fails -
    # the frontend can skip rendering the checkbox form entirely and show the
    # rejection immediately, matching the source app's init() short-circuit.
    failedCheck: Optional[str] = None
    reason: Optional[str] = None
    route: Optional[str] = None


class ContrarianComebackSubmitRequest(ContrarianComebackData):
    # min_length=1 rejects an empty selection with a 422 here too, in
    # addition to the Node controller's own 400 check on the same field -
    # defense in depth, not the primary validation layer (that's Node's job).
    breakdownTypes: list[str] = Field(min_length=1)
    catalystAnswer: Literal['yes', 'no']
    check3Override: bool = False
    check3OverrideReason: Optional[str] = None


class ScoreBreakdown(BaseModel):
    breakdown: int
    sector: int
    technical: int
    value: int
    catalyst: int
    total: int
    verdict: Literal['HIGH', 'MODERATE', 'SPECULATIVE', 'AVOID']
    hybridCapActive: bool
    sectorOverrideCapActive: bool


class WeeklyTechnicals(BaseModel):
    weeklyRsi: Optional[float] = None
    obvTrend: Literal['up', 'down', 'flat', 'insufficient_data']
    volumeDrying: bool
    sma200w: Optional[float] = None


class FibonacciLevels(BaseModel):
    swingLow: float
    athPrice: float
    fib382: float
    fib618: float
    fib100: float


class FundamentalMetric(BaseModel):
    value: Optional[float] = None
    tier: Optional[Literal['green', 'yellow', 'red']] = None


class FundamentalHealth(BaseModel):
    debtToEquity: FundamentalMetric
    currentRatio: FundamentalMetric
    freeCashFlow: FundamentalMetric
    revenueGrowthPct: FundamentalMetric
    grossMarginPct: FundamentalMetric
    cashRunwayMonths: FundamentalMetric
    positiveFcf: bool  # true -> frontend shows "Positive FCF" instead of a runway number


class CatalystPipeline(BaseModel):
    recentInsiderTrades: list[InsiderTrade] = []
    recentGrades: list[GradeRecord] = []
    news: list[NewsItem] = []


class TrancheEntry(BaseModel):
    label: str
    sizePct: int
    priceLow: float
    priceHigh: float
    trigger: str


class StagedEntry(BaseModel):
    tranches: list[TrancheEntry]
    hardStop: float
    capLabel: Literal['Large-Cap', 'Mid-Cap', 'Small-Cap']
    # Mirrors the source app's isMidCap flag verbatim - true for anything
    # under $10B (small-caps included), not exclusively "true mid-cap". The
    # liquidity note it gates applies equally to small-caps, so this isn't a
    # naming bug to "fix".
    isMidCap: bool


class RecoveryTarget(BaseModel):
    label: str
    horizon: str
    price: float
    returnPct: float


class AnalystConsensusTarget(BaseModel):
    low: float
    high: float
    average: float
    returnPct: float


class RecoveryTargets(BaseModel):
    conservative: RecoveryTarget
    baseCase: RecoveryTarget
    bullCase: RecoveryTarget
    analystConsensus: Optional[AnalystConsensusTarget] = None
    riskRewardRatio: Optional[float] = None


class ContrarianComebackSubmitResponse(BaseModel):
    symbol: str
    format: Literal['A', 'B']
    # Format B
    failedCheck: Optional[str] = None
    reason: Optional[str] = None
    route: Optional[str] = None
    # Format A
    companyName: Optional[str] = None
    sector: Optional[str] = None
    exchange: Optional[str] = None
    price: Optional[float] = None
    drawdownPct: Optional[float] = None
    breakdownTypes: list[str] = []
    hybridCap: bool = False
    check3Override: bool = False
    check3OverrideReason: Optional[str] = None
    etfSymbol: Optional[str] = None
    etfReturn6M: Optional[float] = None
    score: Optional[ScoreBreakdown] = None
    technicals: Optional[WeeklyTechnicals] = None
    fibonacci: Optional[FibonacciLevels] = None
    fundamentalHealth: Optional[FundamentalHealth] = None
    catalystPipeline: Optional[CatalystPipeline] = None
    stagedEntry: Optional[StagedEntry] = None
    recoveryTargets: Optional[RecoveryTargets] = None
