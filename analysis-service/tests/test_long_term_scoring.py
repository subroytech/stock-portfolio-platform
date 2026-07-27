import pytest

from app.models.long_term import (
    AnalystGrade,
    EarningsSurprise,
    IncomeStatementPeriod,
    PeerQuote,
    PriceTarget,
)
from app.scoring.long_term import (
    bucket_grades,
    build_bull_bear_signals,
    compute_earnings_surprise_pct,
    compute_financial_growth,
    compute_upside_pct,
    compute_valuation,
    derive_conviction,
)


# ─── bucket_grades ──────────────────────────────────────────────────────────

def test_bucket_grades_classifies_each_bucket():
    grades = [
        AnalystGrade(gradingCompany="A", newGrade="Strong Buy", date="2026-01-01"),
        AnalystGrade(gradingCompany="B", newGrade="Buy", date="2026-01-01"),
        AnalystGrade(gradingCompany="C", newGrade="Hold", date="2026-01-01"),
        AnalystGrade(gradingCompany="D", newGrade="Sell", date="2026-01-01"),
        AnalystGrade(gradingCompany="E", newGrade="Strong Sell", date="2026-01-01"),
    ]
    consensus = bucket_grades(grades)
    assert (consensus.strongBuy, consensus.buy, consensus.hold, consensus.sell, consensus.strongSell) == (1, 1, 1, 1, 1)
    assert consensus.totalAnalysts == 5
    assert consensus.buyPct == 40  # (1+1)/5 = 40%


def test_bucket_grades_dedupes_to_latest_per_firm():
    grades = [
        AnalystGrade(gradingCompany="A", newGrade="Sell", date="2026-01-01"),
        AnalystGrade(gradingCompany="A", newGrade="Buy", date="2026-02-01"),  # newer, should win
    ]
    consensus = bucket_grades(grades)
    assert consensus.buy == 1
    assert consensus.sell == 0
    assert consensus.totalAnalysts == 1


def test_bucket_grades_unknown_text_counts_as_strong_buy():
    grades = [AnalystGrade(gradingCompany="A", newGrade="Something Unrecognized", date="2026-01-01")]
    consensus = bucket_grades(grades)
    assert consensus.strongBuy == 1
    assert consensus.buy == 0


def test_bucket_grades_empty_list_is_all_zero():
    consensus = bucket_grades([])
    assert consensus.totalAnalysts == 0
    assert consensus.buyPct == 0
    assert consensus.holdPct == 0
    assert consensus.sellPct == 0


def test_bucket_grades_outperform_and_overweight_map_to_strong_buy():
    grades = [
        AnalystGrade(gradingCompany="A", newGrade="Outperform", date="2026-01-01"),
        AnalystGrade(gradingCompany="B", newGrade="Overweight", date="2026-01-01"),
    ]
    consensus = bucket_grades(grades)
    assert consensus.strongBuy == 2


# ─── compute_financial_growth ───────────────────────────────────────────────

def test_compute_financial_growth_happy_path():
    income = [
        IncomeStatementPeriod(fiscalYear="2026", revenue=1100, grossProfit=550, operatingIncome=220, netIncome=200, eps=2.2),
        IncomeStatementPeriod(fiscalYear="2025", revenue=1000, grossProfit=500, operatingIncome=200, netIncome=150, eps=2.0),
    ]
    growth = compute_financial_growth(income)
    assert growth.fyLabel == "FY2026"
    assert growth.fyPrevLabel == "FY2025"
    assert round(growth.revenue.yoyPct, 2) == 10.0
    assert round(growth.grossMargin.current, 2) == 50.0
    assert round(growth.grossMargin.deltaPp, 2) == 0.0
    assert round(growth.eps.yoyPct, 2) == 10.0
    assert growth.netIncomeGrowthPct == pytest.approx(33.33, abs=0.01)


def test_compute_financial_growth_missing_prior_period_returns_nulls():
    income = [IncomeStatementPeriod(fiscalYear="2026", revenue=1000, eps=2.0)]
    growth = compute_financial_growth(income)
    assert growth.revenue.yoyPct is None
    assert growth.eps.yoyPct is None
    assert growth.fyPrevLabel == "Prior Year"


def test_compute_financial_growth_empty_list_returns_nulls_not_crash():
    growth = compute_financial_growth([])
    assert growth.revenue.yoyPct is None
    assert growth.fyLabel == "Latest Annual"


def test_compute_financial_growth_zero_prior_revenue_guards_division():
    income = [
        IncomeStatementPeriod(fiscalYear="2026", revenue=1000, eps=1.0),
        IncomeStatementPeriod(fiscalYear="2025", revenue=0, eps=1.0),
    ]
    growth = compute_financial_growth(income)
    assert growth.revenue.yoyPct is None


# ─── compute_earnings_surprise_pct ──────────────────────────────────────────

def test_compute_earnings_surprise_pct_uses_most_recent_quarter_only():
    surprises = [
        EarningsSurprise(date="2026-06-30", epsActual=1.1, epsEstimated=1.0),
        EarningsSurprise(date="2026-03-31", epsActual=0.5, epsEstimated=1.0),  # should be ignored
    ]
    assert round(compute_earnings_surprise_pct(surprises), 2) == 10.0


def test_compute_earnings_surprise_pct_empty_returns_none():
    assert compute_earnings_surprise_pct([]) is None


def test_compute_earnings_surprise_pct_missing_estimate_returns_none():
    assert compute_earnings_surprise_pct([EarningsSurprise(date="2026-06-30", epsActual=1.1, epsEstimated=None)]) is None


# ─── compute_upside_pct ──────────────────────────────────────────────────────

def test_compute_upside_pct_positive_and_negative():
    assert compute_upside_pct(100, PriceTarget(targetConsensus=120)) == 20.0
    assert compute_upside_pct(100, PriceTarget(targetConsensus=90)) == -10.0


def test_compute_upside_pct_no_target_returns_none():
    assert compute_upside_pct(100, None) is None
    assert compute_upside_pct(100, PriceTarget(targetConsensus=None)) is None


# ─── compute_valuation ──────────────────────────────────────────────────────

def test_compute_valuation_trailing_and_forward_pe():
    v = compute_valuation(price=100, eps0=5, forward_eps=4, ev_ebitda=12.5, peers=[])
    assert v.trailingPe == 20.0
    assert v.forwardPe == 25.0
    assert v.evToEbitda == 12.5
    assert v.peerCount == 0
    assert v.peerAvgTrailingPe is None


def test_compute_valuation_guards_zero_and_negative_eps():
    assert compute_valuation(100, 0, None, None, []).trailingPe is None
    assert compute_valuation(100, -1, None, None, []).trailingPe is None
    assert compute_valuation(100, 5, 0, None, []).forwardPe is None
    assert compute_valuation(100, 5, -1, None, []).forwardPe is None


def test_compute_valuation_peer_averages_partial_data():
    peers = [
        PeerQuote(symbol="A", trailingPe=10, evToEbitda=8),
        PeerQuote(symbol="B", trailingPe=20, evToEbitda=None),  # missing EV/EBITDA
        PeerQuote(symbol="C", trailingPe=None, evToEbitda=None),  # missing everything
    ]
    v = compute_valuation(100, 5, None, None, peers)
    assert v.peerCount == 3
    assert v.peerAvgTrailingPe == 15.0  # (10+20)/2
    assert v.peerAvgEvToEbitda == 8.0  # only one value present


def test_compute_valuation_no_peers_returns_none_averages():
    v = compute_valuation(100, 5, None, None, [])
    assert v.peerAvgTrailingPe is None
    assert v.peerAvgEvToEbitda is None


# ─── derive_conviction — every threshold boundary ───────────────────────────

def test_derive_conviction_buy_pct_boundaries():
    # buyPct >= 65 → +2/+2 ; exactly at boundary
    mt, lt = derive_conviction(buy_pct=65, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 2 and lt.score == 2
    # buyPct == 64 → still satisfies the >= 45 elif branch → +1/+1
    mt, lt = derive_conviction(buy_pct=64, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 1 and lt.score == 1
    # buyPct >= 45 → +1/+1
    mt, lt = derive_conviction(buy_pct=45, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 1 and lt.score == 1
    # buyPct == 44 → below both brackets → +0/+0
    mt, lt = derive_conviction(buy_pct=44, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 0 and lt.score == 0


def test_derive_conviction_surprise_pct_boundaries():
    # surprisePct == 5 → misses the > 5 branch but still satisfies the > 0 elif → +1
    mt, _ = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=5, forward_pe=None)
    assert mt.score == 1
    mt, _ = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=5.01, forward_pe=None)
    assert mt.score == 2
    # surprisePct == 0 → does not qualify (rule is strictly > 0)
    mt, _ = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=0, forward_pe=None)
    assert mt.score == 0
    mt, _ = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=0.01, forward_pe=None)
    assert mt.score == 1


def test_derive_conviction_revenue_growth_boundaries():
    # revGrowth == 10 → misses mt's > 10 branch, but still satisfies lt's > 5 elif → mt=0, lt=1
    mt, lt = derive_conviction(buy_pct=0, rev_growth=10, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 0 and lt.score == 1
    mt, lt = derive_conviction(buy_pct=0, rev_growth=10.01, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 1 and lt.score == 2
    # revGrowth == 5 → does not qualify (rule is strictly > 5)
    mt, lt = derive_conviction(buy_pct=0, rev_growth=5, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 0 and lt.score == 0
    mt, lt = derive_conviction(buy_pct=0, rev_growth=5.01, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 0 and lt.score == 1


def test_derive_conviction_net_income_growth_boundaries():
    # netIncomeGrowth == 15 → misses the > 15 branch, but still satisfies the > 8 elif → lt=1
    _, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=15, surprise_pct=None, forward_pe=None)
    assert lt.score == 1
    _, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=15.01, surprise_pct=None, forward_pe=None)
    assert lt.score == 2
    # netIncomeGrowth == 8 → does not qualify (rule is strictly > 8)
    _, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=8, surprise_pct=None, forward_pe=None)
    assert lt.score == 0
    _, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=8.01, surprise_pct=None, forward_pe=None)
    assert lt.score == 1


def test_derive_conviction_forward_pe_boundaries_now_live():
    # Activated per this session's decision — was dead code in the source app.
    mt, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=0)
    assert mt.score == 0 and lt.score == 0  # exactly 0 does not qualify (rule is strictly > 0)
    mt, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=19.99)
    assert mt.score == 1 and lt.score == 1
    mt, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=20)
    assert mt.score == 0 and lt.score == 0  # exactly 20 does not qualify (rule is strictly < 20)


def test_derive_conviction_rating_boundaries():
    # score exactly 5 → bullish, exactly 3 → neutral, below → bearish
    mt, _ = derive_conviction(buy_pct=65, rev_growth=None, net_income_growth=None, surprise_pct=5.01, forward_pe=None)
    assert mt.score == 4  # 2 (buyPct) + 2 (surprise) = 4 -> neutral
    assert mt.rating == "neutral"
    mt, _ = derive_conviction(buy_pct=65, rev_growth=10.01, net_income_growth=None, surprise_pct=5.01, forward_pe=None)
    assert mt.score == 5
    assert mt.rating == "bullish"
    mt, _ = derive_conviction(buy_pct=45, rev_growth=None, net_income_growth=None, surprise_pct=0.01, forward_pe=None)
    assert mt.score == 2
    assert mt.rating == "bearish"
    mt, _ = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=None, surprise_pct=None, forward_pe=None)
    assert mt.score == 0
    assert mt.rating == "bearish"


def test_derive_conviction_mt_lt_can_diverge():
    # Strong net-income growth only helps LT, not MT — scores should differ.
    mt, lt = derive_conviction(buy_pct=0, rev_growth=None, net_income_growth=20, surprise_pct=None, forward_pe=None)
    assert mt.score == 0
    assert lt.score == 2
    assert mt.rating != lt.rating or mt.score != lt.score


# ─── build_bull_bear_signals ─────────────────────────────────────────────────

def test_build_bull_bear_signals_all_bullish_conditions():
    bull, bear = build_bull_bear_signals(rev_growth=15, eps_growth=15, gm_delta=2, buy_pct=70, upside_pct=15)
    assert len(bull) == 5
    assert len(bear) == 0


def test_build_bull_bear_signals_all_bearish_conditions():
    bull, bear = build_bull_bear_signals(rev_growth=2, eps_growth=-5, gm_delta=-3, buy_pct=20, upside_pct=-5)
    assert len(bear) == 5
    assert len(bull) == 0


def test_build_bull_bear_signals_insufficient_data_fallback():
    bull, bear = build_bull_bear_signals(rev_growth=None, eps_growth=None, gm_delta=None, buy_pct=50, upside_pct=None)
    assert bull == ["Insufficient data to derive bull signals — check income statement availability."]
    assert bear == ["Insufficient data to derive bear signals."]


def test_build_bull_bear_signals_uses_eps_growth_not_net_income_growth():
    # eps_growth (true EPS YoY) drives signals, independent of net-income growth
    # used by derive_conviction — this asserts the two are not accidentally
    # the same parameter.
    bull, _ = build_bull_bear_signals(rev_growth=None, eps_growth=11, gm_delta=None, buy_pct=0, upside_pct=None)
    assert any("EPS growth of +11.0% YoY" in s for s in bull)
