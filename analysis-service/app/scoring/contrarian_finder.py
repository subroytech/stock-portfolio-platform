from datetime import datetime, timezone

from app.models.contrarian_finder import RawStockData, ScanQuality, ScanResult, StrengthSignal
from app.scoring.momentum import mw_bb, mw_rsi, mw_sma

# Faithful port of contrarianFinder.service.ts's scanStock() *post-fetch*
# logic only (lines 138-204) - the FMP fetch itself stays in Node
# (fetchStockData()), which is why this takes already-fetched RawStockData
# instead of a symbol+key. Reuses mw_sma/mw_rsi/mw_bb from the already-ported
# app/scoring/momentum.py for the strength screen - no re-porting needed.


def compute_scan_result(data: RawStockData, quality: ScanQuality, scan_days: int = 7) -> ScanResult:
    symbol = data.symbol
    q = data.quote
    hist = data.historicalBars

    price = q.price if q else None
    mkt_cap = q.marketCap if q else None

    filter_fail = (not price or price < quality.minPrice) or (not mkt_cap or mkt_cap < quality.minMarketCap)
    if filter_fail:
        return ScanResult(symbol=symbol, filterFail=True)

    if len(hist) < scan_days + 1:
        return ScanResult(symbol=symbol, filterFail=False, noData=True)

    today = datetime.now(timezone.utc).date().isoformat()
    mkt_closed = hist[0].date == today
    end_price = hist[0].close if mkt_closed else price
    start_bar = hist[scan_days] if mkt_closed else hist[scan_days - 1]
    start_close = start_bar.close if start_bar else None

    if not end_price or not start_close or start_close == 0:
        return ScanResult(symbol=symbol, filterFail=False, noData=True)

    change_pct = (end_price - start_close) / start_close * 100
    change_since_date = start_bar.date if start_bar else None

    # Bullish "strength" screen - RSI ideal zone + above both SMAs + hasn't already spiked.
    strength: StrengthSignal | None = None
    closes = [b.close for b in hist if b.close is not None]
    lows = [b.low for b in hist if b.low is not None]
    if len(closes) >= 50:
        sma20 = mw_sma(closes, 20)
        sma50 = mw_sma(closes, 50)
        rsi = mw_rsi(closes, 14)
        if 55 <= rsi <= 68 and price > sma20 and price > sma50 and change_pct < 10:
            # Estimated R:R/Kelly% - entry/target formulas match the Momentum service.
            # Stop-loss prefers the TIGHTEST of the three candidates (max, not min
            # like the real per-ticker analysis) so R:R stays meaningful for mild
            # "hasn't spiked yet" pullbacks instead of reading 0% across the board,
            # floored relative to entryMid to avoid a near-zero-denominator blowup.
            bb = mw_bb(closes, 20)
            swing_low = min(lows[:5]) if len(lows) >= 5 else price * 0.97
            entry_low = sma20 if price > sma20 else price * 0.99
            entry_mid = (entry_low + price) / 2
            tight_stop = max(bb.lower * 0.99, swing_low * 0.99, price * 0.97)
            min_risk_floor = entry_mid * 0.98
            stop_loss = min(tight_stop, min_risk_floor)
            target = bb.upper
            rr = (target - entry_mid) / (entry_mid - stop_loss) if (entry_mid - stop_loss) > 0.01 else 0
            k_f = max((0.55 * rr - 0.45) / rr, 0) if rr > 0 else 0
            half_kelly = min(k_f / 2, 0.20) if k_f > 0 else 0
            strength = StrengthSignal(rsi=rsi, sma20=sma20, sma50=sma50, rr=rr, kF=k_f, halfKelly=half_kelly)

    return ScanResult(
        symbol=symbol,
        name=(q.name if q and q.name else ''),
        sector=(q.sector if q and q.sector else ''),
        price=price,
        mktCap=mkt_cap,
        volume=(q.volume if q else None),
        avgVol=(q.avgVolume if q else None),
        changePct=change_pct,
        changeSinceDate=change_since_date,
        mktClosed=mkt_closed,
        filterFail=False,
        noData=False,
        strength=strength,
    )


def assemble_scan_batch(stocks: list[RawStockData], quality: ScanQuality, scan_days: int = 7) -> list[ScanResult]:
    return [compute_scan_result(s, quality, scan_days) for s in stocks]
