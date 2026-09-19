import pytest

from app.scoring.momentum import assemble_momentum_analysis, mw_bb, mw_macd, mw_rsi, mw_sma

# Ports the relevant cases from backend/tests/momentum.service.test.ts 1:1 -
# same input fixtures, same already-trusted expected outputs - this IS the
# shadow-test parity proof (see the Momentum extraction /plan), not a
# reformulated or "improved" test suite. calcKellySizing's describe block is
# not ported: that function stays client-side, never moves to Python.


# ─── mw_sma ─────────────────────────────────────────────────────────────────

def test_mw_sma_averages_first_n_elements_newest_first():
    closes = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    assert mw_sma(closes, 5) == pytest.approx(8, abs=1e-6)  # (10+9+8+7+6)/5


# ─── mw_rsi ─────────────────────────────────────────────────────────────────

def test_mw_rsi_is_100_for_strictly_increasing_series():
    increasing = [20 - i for i in range(20)]  # newest-first: 20,19,...,1 -> oldest->newest increasing
    assert mw_rsi(increasing, 14) == 100


def test_mw_rsi_is_0_for_strictly_decreasing_series():
    decreasing = [i + 1 for i in range(20)]  # newest-first: 1,2,...,20 -> oldest->newest decreasing
    assert mw_rsi(decreasing, 14) == 0


def test_mw_rsi_is_50_when_avg_gains_equal_avg_losses_over_seed_window():
    length = 15
    oldest_first = [100]
    for i in range(1, length):
        oldest_first.append(oldest_first[i - 1] + (1 if i % 2 == 0 else -1))
    newest_first = list(reversed(oldest_first))
    assert mw_rsi(newest_first, 14) == pytest.approx(50, abs=1e-5)


# ─── mw_macd ────────────────────────────────────────────────────────────────

def test_mw_macd_hist_equals_macd_minus_signal():
    closes = [100 + i for i in range(40)]  # newest-first synthetic uptrend
    r = mw_macd(closes)
    assert r.hist == pytest.approx(r.macd - r.signal, abs=1e-6)
    assert isinstance(r.prevMacd, float)
    assert isinstance(r.prevSig, float)


# ─── mw_bb ──────────────────────────────────────────────────────────────────

def test_mw_bb_collapses_to_flat_band_for_constant_prices():
    flat = [50] * 20
    bb = mw_bb(flat, 20)
    assert bb.mid == 50
    assert bb.upper == 50
    assert bb.lower == 50
    assert bb.bw == 0


def test_mw_bb_upper_greater_than_mid_greater_than_lower_for_varying_series():
    closes = [22, 21, 19, 23, 18, 25, 17, 24, 20, 26, 16, 27, 15, 28, 14, 29, 13, 30, 12, 31]
    bb = mw_bb(closes, 20)
    assert bb.upper > bb.mid
    assert bb.mid > bb.lower


# ─── assemble_momentum_analysis ─────────────────────────────────────────────

def _make_series(length: int) -> list[float]:
    return [length - i for i in range(length)]


def test_score_total_equals_sum_of_component_scores():
    closes = _make_series(60)
    lows = [c - 1 for c in closes]
    volumes = [300] + [100] * 19 + [100] * 40
    a = assemble_momentum_analysis(closes, lows, volumes, closes[0])
    assert a.score.total == a.score.rsi + a.score.macd + a.score.volume + a.score.trend + a.score.riskReward


def test_signal_derived_from_score_total_via_documented_thresholds():
    closes = _make_series(60)
    lows = [c - 1 for c in closes]
    volumes = [100] * 60
    a = assemble_momentum_analysis(closes, lows, volumes, closes[0])
    total = a.score.total
    expected = 'STRONG BUY' if total >= 8 else 'BUY' if total >= 6 else 'WATCH' if total >= 4 else 'AVOID'
    assert a.signal == expected


def test_day_chg_is_difference_between_two_most_recent_closes():
    closes = _make_series(40)
    a = assemble_momentum_analysis(closes, [c - 1 for c in closes], [100] * 40, closes[0])
    assert a.dayChg == pytest.approx(closes[0] - closes[1], abs=1e-6)


def test_high_relative_volume_with_positive_day_change_scores_volume_component_2():
    closes = _make_series(40)  # dayChg = closes[0]-closes[1] = 1 > 0
    volumes = [1000] + [100] * 19 + [100] * 20
    a = assemble_momentum_analysis(closes, [c - 1 for c in closes], volumes, closes[0])
    assert a.volRatio > 1.5
    assert a.score.volume == 2


def test_trend_scores_2_when_price_above_both_sma20_and_sma50():
    closes = _make_series(60)
    a = assemble_momentum_analysis(closes, [c - 1 for c in closes], [100] * 60, closes[0])
    assert closes[0] > a.sma20
    assert closes[0] > a.sma50
    assert a.score.trend == 2


def test_extras_flags_rsi_overbought_for_strictly_increasing_series():
    closes = _make_series(40)
    a = assemble_momentum_analysis(closes, [c - 1 for c in closes], [100] * 40, closes[0])
    assert a.rsi == 100
    assert 'RSI overbought — consider waiting for a pullback before entry' in a.extras


def test_flags_always_include_at_least_one_bollinger_position_message():
    closes = _make_series(40)
    a = assemble_momentum_analysis(closes, [c - 1 for c in closes], [100] * 40, closes[0])
    assert 1 <= len(a.flags) <= 2


def test_entry_mid_sits_between_stop_loss_and_target_for_healthy_uptrend():
    closes = _make_series(60)
    a = assemble_momentum_analysis(closes, [c - 1 for c in closes], [100] * 60, closes[0])
    assert a.stopLoss < a.entryMid
    assert a.entryMid < a.target
