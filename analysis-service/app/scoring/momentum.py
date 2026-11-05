import math

from app.models.momentum import BollingerBands, MacdResult, MomentumAnalysisResponse, MomentumScoreBreakdown

# Faithful line-for-line port of backend/src/services/momentum.service.ts -
# deliberately NOT reformulated, since matching operation order exactly is
# what makes value-for-value parity against the existing Jest fixtures
# possible (both TS numbers and Python floats are IEEE 754 doubles).
# calcKellySizing() is NOT ported - it stays client-side
# (frontend/src/lib/kelly.ts), never round-trips.
#
# All arrays are newest-first unless noted, same convention as the TS source.


def mw_sma(a: list[float], n: int) -> float:
    return sum(a[:n]) / n


def mw_ema(a: list[float], n: int) -> list[float]:
    p = list(reversed(a))  # oldest -> newest for calculation
    k = 2 / (n + 1)
    e = sum(p[:n]) / n  # SMA seed
    o = [e]
    for i in range(n, len(p)):
        e = p[i] * k + e * (1 - k)
        o.append(e)
    return list(reversed(o))  # back to newest-first


def mw_rsi(a: list[float], n: int = 14) -> float:
    p = list(reversed(a))  # oldest -> newest
    ch = [p[i] - p[i - 1] for i in range(1, len(p))]
    ag = 0.0
    al = 0.0
    for i in range(n):
        ag += max(ch[i], 0)
        al += max(-ch[i], 0)
    ag /= n
    al /= n
    for i in range(n, len(ch)):
        ag = (ag * (n - 1) + max(ch[i], 0)) / n
        al = (al * (n - 1) + max(-ch[i], 0)) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def mw_macd(a: list[float]) -> MacdResult:
    e12 = mw_ema(a, 12)
    e26 = mw_ema(a, 26)
    length = min(len(e12), len(e26))
    ml = [e12[i] - e26[i] for i in range(length)]
    sig = mw_ema(ml, 9)
    prev_macd = ml[1] if len(ml) > 1 else ml[0]
    prev_sig = sig[1] if len(sig) > 1 else sig[0]
    return MacdResult(macd=ml[0], signal=sig[0], hist=ml[0] - sig[0], prevMacd=prev_macd, prevSig=prev_sig)


def mw_bb(a: list[float], n: int = 20) -> BollingerBands:
    sl = a[:n]
    mid = sum(sl) / n
    sd = math.sqrt(sum((v - mid) ** 2 for v in sl) / n)
    bw = 4 * sd / mid if mid > 0 else 0
    return BollingerBands(upper=mid + 2 * sd, mid=mid, lower=mid - 2 * sd, bw=bw)


def assemble_momentum_analysis(
    closes: list[float], lows: list[float], volumes: list[float], price: float,
) -> MomentumAnalysisResponse:
    sma20 = mw_sma(closes, 20)
    sma50 = mw_sma(closes, min(50, len(closes)))
    rsi = mw_rsi(closes, 14)
    macd = mw_macd(closes)
    bb = mw_bb(closes, 20)
    vol_n = min(20, len(volumes))
    vol_avg = sum(volumes[:vol_n]) / vol_n if vol_n > 0 else 0
    vol_ratio = volumes[0] / vol_avg if vol_avg > 0 else 1
    day_chg = closes[0] - closes[1] if len(closes) > 1 else 0
    swing_low = min(lows[:5]) if len(lows) >= 5 else price * 0.97

    entry_low = sma20 if price > sma20 else price * 0.99
    entry_high = price
    entry_mid = (entry_low + entry_high) / 2
    stop_loss = min(bb.lower * 0.99, swing_low * 0.99, price * 0.97)
    target = bb.upper
    rr = (target - entry_mid) / (entry_mid - stop_loss) if (entry_mid - stop_loss) > 0.01 else 0

    s_rsi = 2 if 55 <= rsi <= 68 else 1 if 45 <= rsi <= 70 else 0
    cross = macd.macd > macd.signal and macd.prevMacd <= macd.prevSig
    s_macd = 2 if (macd.macd > macd.signal and macd.macd > 0) else 1 if (macd.macd > macd.signal or cross) else 0
    s_vol = 2 if (vol_ratio > 1.5 and day_chg > 0) else 1 if vol_ratio > 1 else 0
    s_trend = 2 if (price > sma20 and price > sma50) else 1 if price > sma20 else 0
    s_rr = 2 if rr >= 3 else 1 if rr >= 2 else 0
    total = s_rsi + s_macd + s_vol + s_trend + s_rr

    signal = 'STRONG BUY' if total >= 8 else 'BUY' if total >= 6 else 'WATCH' if total >= 4 else 'AVOID'

    flags: list[str] = []
    if price > bb.upper:
        flags.append('Overbought — price extended above upper Bollinger Band')
    elif price < bb.lower:
        flags.append('Oversold — price below lower BB, potential bounce')
    elif price > bb.mid:
        flags.append('Above mid-band — room to upper band target')
    else:
        flags.append('Below mid-band — wait for price to reclaim mid-band')
    if bb.bw < 0.05:
        flags.append('BB squeeze — bands contracting, breakout may be imminent')
    elif bb.bw > 0.15:
        flags.append('Bands expanding — elevated volatility, wider swings likely')

    extras: list[str] = []
    if rsi > 70:
        extras.append('RSI overbought — consider waiting for a pullback before entry')
    if rsi < 30:
        extras.append('RSI oversold — mean-reversion bounce opportunity')
    if macd.macd <= macd.signal:
        extras.append('MACD bearish — no bullish momentum crossover yet')
    if vol_ratio < 0.8:
        extras.append('Below-average volume — low-conviction signal')
    if 0 < rr < 1.5:
        extras.append('Low R:R ratio — risk/reward setup is unfavorable')

    return MomentumAnalysisResponse(
        price=price, sma20=sma20, sma50=sma50, rsi=rsi, macd=macd, bb=bb, volRatio=vol_ratio, dayChg=day_chg,
        score=MomentumScoreBreakdown(rsi=s_rsi, macd=s_macd, volume=s_vol, trend=s_trend, riskReward=s_rr, total=total),
        signal=signal, entryLow=entry_low, entryHigh=entry_high, entryMid=entry_mid,
        stopLoss=stop_loss, target=target, rr=rr, flags=flags, extras=extras,
    )
