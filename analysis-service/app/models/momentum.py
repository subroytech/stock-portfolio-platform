from typing import Literal

from pydantic import BaseModel

# Mirrors backend/src/services/momentum.service.ts's types field-for-field
# (same hand-maintained-duplicate caveat as Long-Term Analysis/Contrarian
# Comeback). calcKellySizing has no Python/request-model equivalent here —
# it stays client-side (frontend/src/lib/kelly.ts), never round-trips.


class MomentumAnalysisRequest(BaseModel):
    closes: list[float]
    lows: list[float]
    volumes: list[float]
    price: float


class MacdResult(BaseModel):
    macd: float
    signal: float
    hist: float
    prevMacd: float
    prevSig: float


class BollingerBands(BaseModel):
    upper: float
    mid: float
    lower: float
    bw: float


class MomentumScoreBreakdown(BaseModel):
    rsi: int
    macd: int
    volume: int
    trend: int
    riskReward: int
    total: int


class MomentumAnalysisResponse(BaseModel):
    price: float
    sma20: float
    sma50: float
    rsi: float
    macd: MacdResult
    bb: BollingerBands
    volRatio: float
    dayChg: float
    score: MomentumScoreBreakdown
    signal: Literal['STRONG BUY', 'BUY', 'WATCH', 'AVOID']
    entryLow: float
    entryHigh: float
    entryMid: float
    stopLoss: float
    target: float
    rr: float
    flags: list[str]
    extras: list[str]
