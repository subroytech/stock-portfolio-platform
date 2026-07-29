import pytest

from app.models.contrarian_comeback import (
    ContrarianComebackData,
    ContrarianComebackSubmitRequest,
    DailyBar,
    GradeRecord,
    InsiderTrade,
    PriceTargetInfo,
)
from app.scoring.contrarian_comeback import (
    analyze_grades,
    analyze_insiders,
    assemble_submit_result,
    compute_fundamental_health,
    compute_recovery_targets,
    compute_score,
    compute_staged_entry,
    compute_value_dislocation,
    evaluate_auto_checks,
    obv_trend,
    sma,
    to_weekly_bars,
    vol_drying,
    vol_ratio_pct,
    volume_climax,
    weekly_rsi,
)


def _bar(date_str: str, close: float, high: float | None = None, low: float | None = None, volume: float = 1000) -> DailyBar:
    return DailyBar(date=date_str, high=high if high is not None else close, low=low if low is not None else close, close=close, volume=volume)


def _base_data(**overrides) -> dict:
    data = {
        "symbol": "AAPL",
        "companyName": "Apple Inc.",
        "sector": "Technology",
        "exchange": "NASDAQ",
        "price": 50.0,
        "marketCap": 1_000_000_000,
        "yearHigh": 100.0,  # dd52w = 50%, comfortably clears Check 1 on its own
        "peRatio": 15.0,
        "incomeStatements": [{"revenue": 1000.0, "grossProfit": 400.0}, {"revenue": 900.0, "grossProfit": 350.0}],
        "dailyBars": [_bar("2026-07-20", 50.0)],
        "etfSymbol": None,
        "etfDailyBars": [],
        "priceTarget": {"targetConsensus": 70.0, "targetHigh": 80.0, "targetLow": 60.0},
        "grades": [],
        "insiderTrades": [],
        "news": [],
    }
    data.update(overrides)
    return data


# ─── to_weekly_bars ──────────────────────────────────────────────────────────

def test_to_weekly_bars_merges_same_week_bars():
    # 2026-07-20 is a Monday; 2026-07-22 is the same week (Wednesday)
    daily = [_bar("2026-07-22", close=12, high=13, low=9, volume=500), _bar("2026-07-20", close=10, high=11, low=8, volume=300)]
    weeks = to_weekly_bars(daily)
    assert len(weeks) == 1
    w = weeks[0]
    assert w["date"] == "2026-07-20"
    assert w["high"] == 13
    assert w["low"] == 8
    assert w["close"] == 12  # last (most recent) close in the week
    assert w["volume"] == 800  # summed


def test_to_weekly_bars_empty_input():
    assert to_weekly_bars([]) == []


# ─── weekly_rsi ──────────────────────────────────────────────────────────────

def test_weekly_rsi_returns_none_below_period_plus_2_bars():
    bars = [{"close": 10.0 + i} for i in range(15)]  # period(14)+2=16 needed
    assert weekly_rsi(bars) is None


def test_weekly_rsi_all_gains_is_100():
    # newest-first, strictly increasing when reversed to oldest-first
    bars = [{"close": float(i)} for i in range(20, 0, -1)]
    assert weekly_rsi(bars) == 100.0


# ─── obv_trend ────────────────────────────────────────────────────────────────

def test_obv_trend_insufficient_data_below_12_bars():
    bars = [{"close": 10.0, "volume": 100} for _ in range(11)]
    assert obv_trend(bars) == "insufficient_data"


def test_obv_trend_up_when_recent_obv_rising():
    # oldest -> newest closes rise steadily with volume, so OBV accumulates upward
    closes = list(range(1, 14))
    bars = [{"close": float(c), "volume": 1000} for c in reversed(closes)]  # newest-first
    assert obv_trend(bars) == "up"


# ─── vol_drying ───────────────────────────────────────────────────────────────

def test_vol_drying_true_when_recent_volume_well_below_prior():
    bars = [{"volume": 10} for _ in range(4)] + [{"volume": 100} for _ in range(4)]
    assert vol_drying(bars) is True


def test_vol_drying_false_when_insufficient_bars():
    assert vol_drying([{"volume": 10}] * 7) is False


# ─── vol_ratio_pct ─────────────────────────────────────────────────────────────

def test_vol_ratio_pct_matches_vol_drying_threshold():
    bars = [{"volume": 10} for _ in range(4)] + [{"volume": 100} for _ in range(4)]
    assert vol_ratio_pct(bars) == pytest.approx(10.0)


def test_vol_ratio_pct_none_when_insufficient_bars():
    assert vol_ratio_pct([{"volume": 10}] * 7) is None


# ─── volume_climax ─────────────────────────────────────────────────────────────

def test_volume_climax_true_when_one_week_spikes_well_above_the_rest():
    bars = [{"volume": 1000}] + [{"volume": 100} for _ in range(9)]
    assert volume_climax(bars) is True


def test_volume_climax_false_when_volume_is_even():
    bars = [{"volume": 100} for _ in range(10)]
    assert volume_climax(bars) is False


def test_volume_climax_false_when_insufficient_bars():
    assert volume_climax([{"volume": 1000}] + [{"volume": 10}] * 6) is False


# ─── sma ──────────────────────────────────────────────────────────────────────

def test_sma_averages_available_bars_when_fewer_than_n():
    bars = [{"close": 10.0}, {"close": 20.0}, {"close": 30.0}]
    assert sma(bars, 200) == 20.0


# ─── evaluate_auto_checks — Check 1 boundary ──────────────────────────────────

def test_check1_passes_at_exactly_25_percent_drawdown():
    data = ContrarianComebackData(**_base_data(price=75.0, yearHigh=100.0))
    checks = evaluate_auto_checks(data)
    assert checks["drawdownPct"] == 25.0
    assert checks["check1Pass"] is True
    assert checks["failedCheck"] is None


def test_check1_fails_just_under_25_percent_drawdown():
    data = ContrarianComebackData(**_base_data(price=76.0, yearHigh=100.0, dailyBars=[_bar("2026-07-20", 76.0, high=100.0)]))
    checks = evaluate_auto_checks(data)
    assert checks["drawdownPct"] < 25.0
    assert checks["check1Pass"] is False
    assert checks["failedCheck"] == "Check 1 — Drawdown Severity"


# ─── evaluate_auto_checks — Check 3 boundary ──────────────────────────────────

def _etf_bars_for_return(pct: float) -> list[DailyBar]:
    # etf6m = (n - s6) / s6 * 100 where n=bars[0].close, s6=bars[130].close
    s6 = 100.0
    n = s6 * (1 + pct / 100)
    bars = [_bar(f"2025-01-{(i % 28) + 1:02d}", close=s6) for i in range(131)]
    bars[0] = _bar("2026-07-20", close=n)
    return bars


def test_check3_hard_block_below_minus_20():
    data = ContrarianComebackData(**_base_data(etfSymbol="XLK", etfDailyBars=_etf_bars_for_return(-20.1)))
    checks = evaluate_auto_checks(data)
    assert checks["check3Status"] == "hard_block"
    assert checks["failedCheck"] == "Check 3 — Sector Health (Hard Block — override not available)"


def test_check3_override_available_between_minus_20_and_minus_5():
    data = ContrarianComebackData(**_base_data(etfSymbol="XLK", etfDailyBars=_etf_bars_for_return(-19.9)))
    checks = evaluate_auto_checks(data)
    assert checks["check3Status"] == "override_available"
    assert checks["failedCheck"] is None  # override-eligible isn't an auto-fail


def test_check3_passes_clean_at_exactly_minus_5():
    data = ContrarianComebackData(**_base_data(etfSymbol="XLK", etfDailyBars=_etf_bars_for_return(-5.0)))
    checks = evaluate_auto_checks(data)
    assert checks["check3Status"] == "pass"


def test_check3_passes_with_no_etf_mapped():
    data = ContrarianComebackData(**_base_data(etfSymbol=None, etfDailyBars=[]))
    checks = evaluate_auto_checks(data)
    assert checks["check3Status"] == "pass"
    assert checks["etf6m"] is None


# ─── evaluate_auto_checks — Check 4 ────────────────────────────────────────────

def test_check4_fails_on_zero_revenue():
    data = ContrarianComebackData(**_base_data(incomeStatements=[{"revenue": 0, "grossProfit": 0}]))
    checks = evaluate_auto_checks(data)
    assert checks["check4Pass"] is False
    assert checks["failedCheck"] == "Check 4 — Company Viability"


def test_check1_failure_takes_precedence_over_check4():
    # Both check1 and check4 fail - failedCheck should report Check 1 (evaluated first)
    data = ContrarianComebackData(**_base_data(price=99.0, yearHigh=100.0, dailyBars=[_bar("2026-07-20", 99.0, high=100.0)], incomeStatements=[{"revenue": 0, "grossProfit": 0}]))
    checks = evaluate_auto_checks(data)
    assert checks["failedCheck"] == "Check 1 — Drawdown Severity"


# ─── compute_score — sector factor ─────────────────────────────────────────────

def test_sector_score_defaults_to_1_when_no_etf_data():
    score = compute_score(30, ["event"], None, None, False, False, 0, None, None, False, 0, False, False)
    assert score.sector == 1


def test_sector_score_forced_to_0_when_override_active_even_with_healthy_etf():
    score = compute_score(30, ["event"], 10.0, None, False, False, 0, None, None, False, 0, False, True)
    assert score.sector == 0


def test_sector_score_boundaries():
    assert compute_score(30, [], 5.1, None, False, False, 0, None, None, False, 0, False, False).sector == 2
    assert compute_score(30, [], 5.0, None, False, False, 0, None, None, False, 0, False, False).sector == 1
    assert compute_score(30, [], -2.0, None, False, False, 0, None, None, False, 0, False, False).sector == 1
    assert compute_score(30, [], -2.1, None, False, False, 0, None, None, False, 0, False, False).sector == 0


# ─── compute_score — technical factor (None-RSI guard) ────────────────────────

def test_technical_score_is_0_when_rsi_is_none_regardless_of_other_signals():
    score = compute_score(30, [], None, None, True, True, 0, None, None, False, 0, False, False)
    assert score.technical == 0


def test_technical_score_2_requires_rsi_below_35_and_vol_drying_and_obv_up():
    assert compute_score(30, [], None, 34.9, True, True, 0, None, None, False, 0, False, False).technical == 2
    assert compute_score(30, [], None, 34.9, False, True, 0, None, None, False, 0, False, False).technical == 1  # missing vol_drying -> falls to <40 branch
    assert compute_score(30, [], None, 40.0, True, True, 0, None, None, False, 0, False, False).technical == 0  # not <40


# ─── compute_score — value factor ──────────────────────────────────────────────

def test_value_score_zeroed_by_pe_sanity_check():
    assert compute_score(30, [], None, None, False, False, 100, 61.0, None, False, 0, False, False).value == 0
    assert compute_score(30, [], None, None, False, False, 100, 60.0, None, False, 0, False, False).value == 2  # pe==60 doesn't trigger (>60 only)


def test_value_score_zeroed_by_ps_sanity_check():
    assert compute_score(30, [], None, None, False, False, 100, None, 25.1, False, 0, False, False).value == 0


def test_value_score_upside_boundaries():
    assert compute_score(30, [], None, None, False, False, 40.1, None, None, False, 0, False, False).value == 2
    assert compute_score(30, [], None, None, False, False, 40.0, None, None, False, 0, False, False).value == 1
    assert compute_score(30, [], None, None, False, False, 25.0, None, None, False, 0, False, False).value == 0


# ─── compute_score — catalyst factor ───────────────────────────────────────────

def test_catalyst_score_insider_buying_wins_regardless_of_upgrades():
    assert compute_score(30, [], None, None, False, False, 0, None, None, True, 0, False, False).catalyst == 2


def test_catalyst_score_upgrades_only():
    assert compute_score(30, [], None, None, False, False, 0, None, None, False, 1, False, False).catalyst == 1
    assert compute_score(30, [], None, None, False, False, 0, None, None, False, 0, False, False).catalyst == 0


# ─── compute_score — cap rules ─────────────────────────────────────────────────

def test_hybrid_cap_limits_total_to_7():
    # breakdown=1(dd>=25) sector=2(etf6m>5) technical=0 value=2(upside>40) catalyst=2(insider) = 7 raw already;
    # bump breakdown to 2 via event+dd>40 to push raw total to 8, then confirm hybrid caps it back to 7.
    score = compute_score(41, ["event"], 10.0, None, False, False, 41, None, None, True, 0, True, False)
    assert score.total == 7
    assert score.hybridCapActive is True


def test_check3_override_caps_total_to_6_even_lower_than_hybrid():
    score = compute_score(41, ["event"], 10.0, None, False, False, 41, None, None, True, 0, True, True)
    assert score.total == 6  # lower of the two caps (6) wins
    assert score.sectorOverrideCapActive is True


def test_verdict_high_at_exactly_8():
    # breakdown=2(dd>40+event) sector=2 technical=2 value=2 catalyst=2 = 10, still >= 8 -> HIGH
    score = compute_score(41, ["event"], 10.0, 34.0, True, True, 41, None, None, True, 0, False, False)
    assert score.verdict == "HIGH"


def test_verdict_moderate_at_exactly_6():
    # breakdown=1 sector=2 technical=0 value=2 catalyst=1 = 6
    score = compute_score(25, [], 10.0, None, False, False, 41, None, None, False, 1, False, False)
    assert score.total == 6
    assert score.verdict == "MODERATE"


def test_verdict_speculative_at_exactly_4():
    # breakdown=1 sector=1 technical=0 value=1 catalyst=1 = 4
    score = compute_score(25, [], -1.0, None, False, False, 30, None, None, False, 1, False, False)
    assert score.total == 4
    assert score.verdict == "SPECULATIVE"


def test_verdict_avoid_below_4():
    score = compute_score(25, [], None, None, False, False, 0, None, None, False, 0, False, False)
    assert score.total < 4
    assert score.verdict == "AVOID"


# ─── assemble_submit_result — Format B branching ───────────────────────────────

def _submit_data(**overrides) -> dict:
    base = _base_data()
    base.update({"breakdownTypes": ["event"], "catalystAnswer": "yes", "check3Override": False, "check3OverrideReason": None})
    base.update(overrides)
    return base


def test_submit_format_b_on_check1_failure():
    req = ContrarianComebackSubmitRequest(**_submit_data(price=99.0, yearHigh=100.0, dailyBars=[_bar("2026-07-20", 99.0, high=100.0)]))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.failedCheck == "Check 1 — Drawdown Severity"


def test_submit_format_b_on_red_breakdown_type():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["structural"]))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.failedCheck == "Check 2 — Breakdown Type"
    assert "Avoid" in result.route


def test_submit_format_b_valuation_breakdown_routes_to_lt_mt_analyzer():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["valuation"]))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert "LT-MT Stock Analyzer" in result.route


def test_submit_format_b_on_no_catalyst():
    req = ContrarianComebackSubmitRequest(**_submit_data(catalystAnswer="no"))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.failedCheck == "Check 5 — Recovery Catalyst"


def test_submit_format_b_when_override_available_but_not_selected():
    req = ContrarianComebackSubmitRequest(**_submit_data(etfSymbol="XLK", etfDailyBars=_etf_bars_for_return(-10.0), check3Override=False))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.failedCheck == "Check 3 — Sector Health"


def test_submit_format_b_when_override_selected_but_no_reason():
    req = ContrarianComebackSubmitRequest(**_submit_data(etfSymbol="XLK", etfDailyBars=_etf_bars_for_return(-10.0), check3Override=True, check3OverrideReason=None))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.failedCheck == "Check 3 — Sector Health"


def test_submit_format_a_with_override_reason_caps_score_and_zeroes_sector():
    req = ContrarianComebackSubmitRequest(**_submit_data(
        etfSymbol="XLK", etfDailyBars=_etf_bars_for_return(-10.0), check3Override=True, check3OverrideReason="macro",
    ))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.check3Override is True
    assert result.check3OverrideReason == "macro"
    assert result.score.sector == 0
    assert result.score.total <= 6


def test_submit_format_a_hybrid_yellow_only_caps_score_at_7():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["cyclical"]))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.hybridCap is True
    assert result.score.total <= 7


def test_submit_format_a_clean_pass_no_caps():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["event"]))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.hybridCap is False
    assert result.check3Override is False


def test_submit_format_a_includes_fundamental_health_and_catalyst_pipeline():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["event"]))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.fundamentalHealth is not None
    assert result.catalystPipeline is not None


def test_submit_format_b_leaves_fundamental_health_and_catalyst_pipeline_null():
    req = ContrarianComebackSubmitRequest(**_submit_data(catalystAnswer="no"))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.fundamentalHealth is None
    assert result.catalystPipeline is None


# ─── compute_fundamental_health — Phase 2 ───────────────────────────────────────

def _fh_data(**overrides) -> ContrarianComebackData:
    base = _base_data()
    base.update({
        "totalDebt": None, "totalStockholdersEquity": None,
        "totalCurrentAssets": None, "totalCurrentLiabilities": None,
        "cashAndCashEquivalents": None, "operatingCashFlow": None, "capitalExpenditure": None,
    })
    base.update(overrides)
    return ContrarianComebackData(**base)


def test_debt_to_equity_tier_boundaries():
    assert compute_fundamental_health(_fh_data(totalDebt=150, totalStockholdersEquity=100)).debtToEquity.tier == "green"  # 1.5
    assert compute_fundamental_health(_fh_data(totalDebt=151, totalStockholdersEquity=100)).debtToEquity.tier == "yellow"  # 1.51
    assert compute_fundamental_health(_fh_data(totalDebt=300, totalStockholdersEquity=100)).debtToEquity.tier == "yellow"  # 3.0
    assert compute_fundamental_health(_fh_data(totalDebt=301, totalStockholdersEquity=100)).debtToEquity.tier == "red"  # 3.01


def test_debt_to_equity_null_when_data_missing():
    metric = compute_fundamental_health(_fh_data()).debtToEquity
    assert metric.value is None
    assert metric.tier is None


def test_current_ratio_tier_boundaries():
    assert compute_fundamental_health(_fh_data(totalCurrentAssets=120, totalCurrentLiabilities=100)).currentRatio.tier == "green"  # 1.2
    assert compute_fundamental_health(_fh_data(totalCurrentAssets=119, totalCurrentLiabilities=100)).currentRatio.tier == "yellow"  # 1.19
    assert compute_fundamental_health(_fh_data(totalCurrentAssets=80, totalCurrentLiabilities=100)).currentRatio.tier == "yellow"  # 0.8
    assert compute_fundamental_health(_fh_data(totalCurrentAssets=79, totalCurrentLiabilities=100)).currentRatio.tier == "red"  # 0.79


def test_free_cash_flow_tier_and_positive_flag():
    positive = compute_fundamental_health(_fh_data(operatingCashFlow=100, capitalExpenditure=-20))
    assert positive.freeCashFlow.value == 80
    assert positive.freeCashFlow.tier == "green"
    assert positive.positiveFcf is True

    negative = compute_fundamental_health(_fh_data(operatingCashFlow=10, capitalExpenditure=-20))
    assert negative.freeCashFlow.value == -10
    assert negative.freeCashFlow.tier == "red"
    assert negative.positiveFcf is False


def test_free_cash_flow_null_when_no_cash_flow_data_at_all():
    metric = compute_fundamental_health(_fh_data()).freeCashFlow
    assert metric.value is None
    assert metric.tier is None


def test_revenue_growth_tier_boundaries():
    green = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 1001, "grossProfit": 1}, {"revenue": 1000, "grossProfit": 1}]))
    assert green.revenueGrowthPct.tier == "green"
    yellow_boundary = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 900, "grossProfit": 1}, {"revenue": 1000, "grossProfit": 1}]))
    assert yellow_boundary.revenueGrowthPct.tier == "red"  # exactly -10% is NOT > -10, so red
    yellow = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 901, "grossProfit": 1}, {"revenue": 1000, "grossProfit": 1}]))
    assert yellow.revenueGrowthPct.tier == "yellow"  # -9.9%


def test_revenue_growth_null_with_only_one_period():
    metric = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 1000, "grossProfit": 1}])).revenueGrowthPct
    assert metric.value is None
    assert metric.tier is None


def test_gross_margin_tier_boundaries():
    green = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 1000, "grossProfit": 300}])).grossMarginPct
    assert green.tier == "green"  # 30%
    yellow = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 1000, "grossProfit": 299}])).grossMarginPct
    assert yellow.tier == "yellow"  # 29.9%
    yellow_boundary = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 1000, "grossProfit": 150}])).grossMarginPct
    assert yellow_boundary.tier == "yellow"  # 15%
    red = compute_fundamental_health(_fh_data(incomeStatements=[{"revenue": 1000, "grossProfit": 149}])).grossMarginPct
    assert red.tier == "red"  # 14.9%


def test_cash_runway_only_computed_when_burning_cash():
    burning = compute_fundamental_health(_fh_data(operatingCashFlow=10, capitalExpenditure=-30, cashAndCashEquivalents=360))  # FCF=-20, runway=216mo
    assert burning.cashRunwayMonths.value == 216
    assert burning.cashRunwayMonths.tier == "green"

    profitable = compute_fundamental_health(_fh_data(operatingCashFlow=100, capitalExpenditure=-20, cashAndCashEquivalents=360))
    assert profitable.cashRunwayMonths.value is None
    assert profitable.positiveFcf is True


def test_cash_runway_tier_boundaries():
    def runway_tier(months: float) -> str | None:
        # cashRun = cash / abs(FCF) * 12  =>  cash = months * abs(FCF) / 12
        fcf = -10.0
        cash = months * abs(fcf) / 12
        return compute_fundamental_health(_fh_data(operatingCashFlow=0, capitalExpenditure=fcf, cashAndCashEquivalents=cash)).cashRunwayMonths.tier

    assert runway_tier(18) == "green"
    assert runway_tier(17.9) == "yellow"
    assert runway_tier(9) == "yellow"
    assert runway_tier(8.9) == "red"


# ─── analyze_insiders / analyze_grades — recent rows (Phase 2) ─────────────────

def test_analyze_insiders_recent_only_includes_last_90_days_capped_at_5():
    recent_date = "2026-07-01"
    stale_date = "2020-01-01"
    trades = [InsiderTrade(transactionDate=recent_date, transactionType="Sale", securitiesTransacted=1, price=1) for _ in range(6)]
    trades.append(InsiderTrade(transactionDate=stale_date, transactionType="Sale", securitiesTransacted=1, price=1))
    result = analyze_insiders(trades)
    assert len(result["recent"]) == 5
    assert all(t.transactionDate == recent_date for t in result["recent"])


def test_analyze_grades_recent_only_includes_last_90_days_capped_at_5():
    recent_date = "2026-07-01"
    stale_date = "2020-01-01"
    grades = [GradeRecord(date=recent_date, gradingCompany=f"Firm{i}", newGrade="Buy", action="upgrade") for i in range(6)]
    grades.append(GradeRecord(date=stale_date, gradingCompany="OldFirm", newGrade="Buy", action="upgrade"))
    result = analyze_grades(grades)
    assert len(result["recent"]) == 5
    assert all(g.date == recent_date for g in result["recent"])


# ─── compute_staged_entry — Phase 3 ──────────────────────────────────────────

def test_staged_entry_tranche_prices():
    entry = compute_staged_entry(price=100.0, fib382=80.0, market_cap=5e9)
    t1, t2, t3 = entry.tranches
    assert (t1.label, t1.sizePct, t1.priceLow, t1.priceHigh) == ("T1", 40, 97.0, 103.0)
    assert (t2.label, t2.sizePct, t2.priceLow, t2.priceHigh) == ("T2", 35, 105.0, 118.0)
    assert (t3.label, t3.sizePct) == ("T3", 25)
    assert t3.priceLow == pytest.approx(76.0)
    assert t3.priceHigh == pytest.approx(84.0)


def test_staged_entry_hard_stop_is_15_percent_below_price():
    entry = compute_staged_entry(price=100.0, fib382=80.0, market_cap=5e9)
    assert entry.hardStop == 85.0


def test_staged_entry_cap_label_and_mid_cap_flag_boundaries():
    assert compute_staged_entry(100.0, 80.0, 10e9).capLabel == "Large-Cap"
    assert compute_staged_entry(100.0, 80.0, 10e9).isMidCap is False
    assert compute_staged_entry(100.0, 80.0, 9.99e9).capLabel == "Mid-Cap"
    assert compute_staged_entry(100.0, 80.0, 9.99e9).isMidCap is True
    assert compute_staged_entry(100.0, 80.0, 2e9).capLabel == "Mid-Cap"
    assert compute_staged_entry(100.0, 80.0, 1.99e9).capLabel == "Small-Cap"
    assert compute_staged_entry(100.0, 80.0, 1.99e9).isMidCap is True  # small-caps also trigger the note, verbatim source behavior


def test_staged_entry_zero_or_none_market_cap_is_small_cap_not_mid_cap_flagged():
    entry = compute_staged_entry(100.0, 80.0, None)
    assert entry.capLabel == "Small-Cap"
    assert entry.isMidCap is False  # mktCap>0 guard - a missing market cap doesn't spuriously trigger the liquidity note


# ─── compute_recovery_targets — Phase 3 ──────────────────────────────────────

def test_recovery_targets_conservative_and_bull_case():
    targets = compute_recovery_targets(price=100.0, fib382=120.0, fib618=140.0, fib100=200.0, hard_stop=85.0, pt_avg=0.0, price_target=None)
    assert targets.conservative.price == 120.0
    assert targets.conservative.returnPct == pytest.approx(20.0)
    assert targets.bullCase.price == 200.0
    assert targets.bullCase.returnPct == pytest.approx(100.0)


def test_recovery_targets_base_case_picks_the_greater_of_fib618_or_analyst_target():
    higher_pt = compute_recovery_targets(100.0, 120.0, 140.0, 200.0, 85.0, pt_avg=160.0, price_target=PriceTargetInfo(targetLow=150, targetHigh=170, targetConsensus=160))
    assert higher_pt.baseCase.price == 160.0  # ptAvg > fib618
    lower_pt = compute_recovery_targets(100.0, 120.0, 140.0, 200.0, 85.0, pt_avg=110.0, price_target=PriceTargetInfo(targetLow=100, targetHigh=120, targetConsensus=110))
    assert lower_pt.baseCase.price == 140.0  # fib618 > ptAvg
    no_pt = compute_recovery_targets(100.0, 120.0, 140.0, 200.0, 85.0, pt_avg=0.0, price_target=None)
    assert no_pt.baseCase.price == 140.0  # no price target at all -> falls back to fib618


def test_recovery_targets_analyst_consensus_only_present_when_pt_avg_positive():
    with_pt = compute_recovery_targets(100.0, 120.0, 140.0, 200.0, 85.0, pt_avg=160.0, price_target=PriceTargetInfo(targetLow=150, targetHigh=170, targetConsensus=160))
    assert with_pt.analystConsensus is not None
    assert with_pt.analystConsensus.low == 150
    assert with_pt.analystConsensus.high == 170
    assert with_pt.analystConsensus.average == 160

    without_pt = compute_recovery_targets(100.0, 120.0, 140.0, 200.0, 85.0, pt_avg=0.0, price_target=None)
    assert without_pt.analystConsensus is None


def test_recovery_targets_risk_reward_ratio_present_only_when_fib618_beats_hard_stop():
    present = compute_recovery_targets(100.0, 120.0, 140.0, 200.0, hard_stop=85.0, pt_avg=0.0, price_target=None)
    assert present.riskRewardRatio == pytest.approx((140.0 - 100.0) / (100.0 - 85.0))

    absent = compute_recovery_targets(100.0, 120.0, 80.0, 200.0, hard_stop=85.0, pt_avg=0.0, price_target=None)
    assert absent.riskRewardRatio is None


# ─── assemble_submit_result — staged entry / recovery targets wiring ─────────

def test_submit_format_a_includes_staged_entry_and_recovery_targets():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["event"]))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.stagedEntry is not None
    assert len(result.stagedEntry.tranches) == 3
    assert result.recoveryTargets is not None


def test_submit_format_b_leaves_staged_entry_and_recovery_targets_null():
    req = ContrarianComebackSubmitRequest(**_submit_data(catalystAnswer="no"))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.stagedEntry is None
    assert result.recoveryTargets is None


# ─── compute_score — hints ───────────────────────────────────────────────────

def test_breakdown_hint_mentions_event_driven_only_at_score_2():
    two = compute_score(41, ["event"], None, None, False, False, 0, None, None, False, 0, False, False)
    assert "event-driven" in two.hints["breakdown"]
    one = compute_score(30, [], None, None, False, False, 0, None, None, False, 0, False, False)
    assert "event-driven" not in one.hints["breakdown"]
    assert "30.0% drawdown" in one.hints["breakdown"]


def test_sector_hint_variants():
    override = compute_score(30, [], 10.0, None, False, False, 0, None, None, False, 0, False, True)
    assert "override" in override.hints["sector"].lower()
    no_data = compute_score(30, [], None, None, False, False, 0, None, None, False, 0, False, False)
    assert "no sector etf data" in no_data.hints["sector"].lower()
    weak = compute_score(30, [], -5.0, None, False, False, 0, None, None, False, 0, False, False)
    assert "weak" in weak.hints["sector"].lower()
    flat = compute_score(30, [], 0.0, None, False, False, 0, None, None, False, 0, False, False)
    assert "flat" in flat.hints["sector"].lower()
    healthy = compute_score(30, [], 10.0, None, False, False, 0, None, None, False, 0, False, False)
    assert "weak" not in healthy.hints["sector"].lower() and "flat" not in healthy.hints["sector"].lower()


def test_technical_hint_variants():
    insufficient = compute_score(30, [], None, None, False, False, 0, None, None, False, 0, False, False)
    assert "insufficient" in insufficient.hints["technical"].lower()
    strong = compute_score(30, [], None, 30.0, True, True, 0, None, None, False, 0, False, False)
    assert "volume drying" in strong.hints["technical"] and "obv turning up" in strong.hints["technical"].lower()
    weak = compute_score(30, [], None, 38.0, False, False, 0, None, None, False, 0, False, False)
    assert "oversold zone" in weak.hints["technical"]
    neutral = compute_score(30, [], None, 50.0, False, False, 0, None, None, False, 0, False, False)
    assert "not yet oversold" in neutral.hints["technical"]


def test_value_hint_variants():
    sanity = compute_score(30, [], None, None, False, False, 0, 70.0, None, False, 0, False, False)
    assert "sanity check failed" in sanity.hints["value"].lower()
    assert "pe 70.0" in sanity.hints["value"].lower()
    below = compute_score(30, [], None, None, False, False, 10.0, None, None, False, 0, False, False)
    assert "below 25% threshold" in below.hints["value"]
    good = compute_score(30, [], None, None, False, False, 45.0, None, None, False, 0, False, False)
    assert "below 25% threshold" not in good.hints["value"]
    assert "+45.0%" in good.hints["value"]


def test_catalyst_hint_variants():
    buying = compute_score(30, [], None, None, False, False, 0, None, None, True, 0, False, False)
    assert "insider buying" in buying.hints["catalyst"].lower()
    upgrades = compute_score(30, [], None, None, False, False, 0, None, None, False, 3, False, False)
    assert "3 analyst upgrade(s)" in upgrades.hints["catalyst"]
    neither = compute_score(30, [], None, None, False, False, 0, None, None, False, 0, False, False)
    assert "no insider buying or analyst upgrades" in neither.hints["catalyst"].lower()


# ─── compute_value_dislocation ───────────────────────────────────────────────

def test_value_dislocation_sanity_check_flag():
    triggered_pe = compute_value_dislocation(70.0, None, 10.0)
    assert triggered_pe.sanityCheckTriggered is True
    triggered_ps = compute_value_dislocation(None, 30.0, 10.0)
    assert triggered_ps.sanityCheckTriggered is True
    clean = compute_value_dislocation(20.0, 5.0, 45.0)
    assert clean.sanityCheckTriggered is False
    assert clean.peRatio == 20.0
    assert clean.priceToSales == 5.0
    assert clean.analystUpsidePct == 45.0


# ─── assemble_submit_result — Catalyst Pipeline signal / Value Dislocation ───

def test_submit_format_a_catalyst_pipeline_carries_insider_signal_and_upgrade_count():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["event"]))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.catalystPipeline.insiderSignal in ("Net Buying", "Net Selling", "Neutral")
    assert result.catalystPipeline.analystUpgrades90d == 0  # no grades in the base fixture


def test_submit_format_a_includes_value_dislocation():
    req = ContrarianComebackSubmitRequest(**_submit_data(breakdownTypes=["event"]))
    result = assemble_submit_result(req)
    assert result.format == "A"
    assert result.valueDislocation is not None


def test_submit_format_b_leaves_value_dislocation_null():
    req = ContrarianComebackSubmitRequest(**_submit_data(catalystAnswer="no"))
    result = assemble_submit_result(req)
    assert result.format == "B"
    assert result.valueDislocation is None
