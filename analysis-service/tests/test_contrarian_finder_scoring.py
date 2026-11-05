from datetime import datetime, timezone

import pytest

from app.models.contrarian_finder import RawHistoricalBar, RawQuoteData, RawStockData, ScanQuality
from app.scoring.contrarian_finder import compute_scan_result

# Ports the 7 scanStock cases from backend/tests/contrarianFinder.service.test.ts
# 1:1 - same input fixtures, same already-trusted expected outputs - this IS
# the shadow-test parity proof (see the Contrarian Finder extraction /plan).
# The 2 "scanBatch - sector backfill" tests are NOT ported: they test Node's
# sector-overlay behavior, which is unaffected by this extraction.

STANDARD_QUALITY = ScanQuality(minPrice=10, minMarketCap=5e9)


def _bar(date: str, close: float, low: float | None = None) -> RawHistoricalBar:
    return RawHistoricalBar(date=date, close=close, low=low if low is not None else close)


def test_flags_filter_fail_when_quote_is_none():
    # A stock whose FMP quote call failed entirely (Node's fetchStockData
    # never rejects - a failed fetch just becomes quote=None) - this is the
    # real path a fetch failure takes, not a Node-side error branch.
    data = RawStockData(symbol="NOQUOTE", quote=None, historicalBars=[])
    r = compute_scan_result(data, STANDARD_QUALITY)
    assert r.filterFail is True


def test_flags_filter_fail_when_price_or_market_cap_below_quality_thresholds():
    data = RawStockData(symbol="PENNY", quote=RawQuoteData(price=5, marketCap=1e9), historicalBars=[])
    r = compute_scan_result(data, STANDARD_QUALITY)
    assert r.symbol == "PENNY"
    assert r.filterFail is True
    assert r.noData is None


def test_flags_no_data_when_fewer_than_scan_days_plus_1_days_available():
    data = RawStockData(
        symbol="THIN", quote=RawQuoteData(price=100, marketCap=1e10),
        historicalBars=[_bar("2026-06-20", 100)],
    )
    r = compute_scan_result(data, STANDARD_QUALITY, scan_days=7)
    assert r.symbol == "THIN"
    assert r.filterFail is False
    assert r.noData is True


def test_computes_change_pct_from_scan_days_trading_days_ago_to_latest_close():
    hist = [
        _bar("2026-06-22", 80), _bar("2026-06-19", 85), _bar("2026-06-18", 90),
        _bar("2026-06-17", 95), _bar("2026-06-16", 98), _bar("2026-06-15", 100),
    ]
    data = RawStockData(
        symbol="DROP",
        quote=RawQuoteData(price=80, marketCap=1e10, name="Test Co", sector="Technology", volume=1000, avgVolume=800),
        historicalBars=hist,
    )
    r = compute_scan_result(data, STANDARD_QUALITY, scan_days=5)
    assert r.filterFail is False
    assert r.noData is False
    # mktClosed false (hist[0].date != today) -> endPrice=price(80), startClose=hist[4].close(98)
    assert r.changePct == pytest.approx((80 - 98) / 98 * 100, abs=1e-6)
    assert r.changeSinceDate == "2026-06-16"  # hist[4]'s date
    assert r.strength is None  # only 6 closes available, well under the 50-close strength-screen minimum


def test_change_since_date_reflects_mkt_closed_branch_too():
    today = datetime.now(timezone.utc).date().isoformat()
    hist = [
        _bar(today, 80), _bar("2026-06-19", 85), _bar("2026-06-18", 90),
        _bar("2026-06-17", 95), _bar("2026-06-16", 98), _bar("2026-06-15", 100),
    ]
    data = RawStockData(symbol="CLOSED", quote=RawQuoteData(price=81, marketCap=1e10, name="Test Co"), historicalBars=hist)
    r = compute_scan_result(data, STANDARD_QUALITY, scan_days=5)
    assert r.mktClosed is True
    assert r.changeSinceDate == "2026-06-15"  # hist[5], since hist[0] is already today's close


def test_strength_is_null_when_fewer_than_50_closes_even_with_plenty_of_scan_days():
    hist = [_bar(f"2026-06-{10 + i}", 100 + i, 99 + i) for i in range(15)]
    hist.reverse()
    data = RawStockData(
        symbol="SHORTHIST",
        quote=RawQuoteData(price=114, marketCap=1e10, name="Short Co", sector="Technology"),
        historicalBars=hist,
    )
    r = compute_scan_result(data, STANDARD_QUALITY, scan_days=7)
    assert r.noData is False
    assert r.strength is None


def test_strength_screen_qualifies_rsi_ideal_zone_above_both_smas_no_recent_spike():
    # Same fixture as the TS test - verified empirically against the real
    # mw_sma/mw_rsi: an oldest->newest series stepping +2/-1 alternately from
    # 100 over 55 bars yields RSI ~65.09, price(127) > sma20(123) > sma50(115.5).
    oldest_first = [100.0]
    for i in range(1, 55):
        oldest_first.append(oldest_first[i - 1] + (2 if i % 2 == 1 else -1))
    newest_first_closes = list(reversed(oldest_first))
    hist = [
        _bar(f"2026-0{1 + i // 28}-{str(1 + (i % 28)).zfill(2)}", close, close - 1)
        for i, close in enumerate(newest_first_closes)
    ]
    price = newest_first_closes[0]  # 127

    data = RawStockData(
        symbol="STRONG",
        quote=RawQuoteData(price=price, marketCap=1e10, name="Strength Co", sector="Technology", volume=1000, avgVolume=800),
        historicalBars=hist,
    )
    r = compute_scan_result(data, STANDARD_QUALITY, scan_days=7)

    assert r.filterFail is False
    assert r.noData is False
    assert r.changePct < 10  # hasn't already spiked
    assert r.strength is not None
    assert 55 <= r.strength.rsi <= 68
    assert r.strength.sma20 < price
    assert r.strength.sma50 < price
    assert r.strength.rr >= 0
    assert r.strength.kF >= 0
    assert 0 <= r.strength.halfKelly <= 0.20
