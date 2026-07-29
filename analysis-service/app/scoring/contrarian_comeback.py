from datetime import date as date_cls, datetime, timedelta, timezone

from app.models.contrarian_comeback import (
    AnalystConsensusTarget,
    CatalystPipeline,
    ContrarianComebackData,
    ContrarianComebackGateResponse,
    ContrarianComebackSubmitRequest,
    ContrarianComebackSubmitResponse,
    DailyBar,
    FibonacciLevels,
    FundamentalHealth,
    FundamentalMetric,
    GradeRecord,
    InsiderTrade,
    PriceTargetInfo,
    RecoveryTarget,
    RecoveryTargets,
    ScoreBreakdown,
    StagedEntry,
    TrancheEntry,
    WeeklyTechnicals,
)

# Ported from CreateStockPortfolioViewWOSkill/contrarian-analysis.html (re-read
# verbatim 2026-07-27, not assumed from the earlier scoping doc - see plan for
# the 3 corrections that surfaced). Node fetches/normalizes raw FMP fields;
# everything below is pure derivation, same division of labor as
# app/scoring/long_term.py.


# ── Weekly bars ──────────────────────────────────────────────────────────

def _monday_of(d: date_cls) -> date_cls:
    return d - timedelta(days=d.weekday())


def to_weekly_bars(daily: list[DailyBar]) -> list[dict]:
    """Buckets daily bars (newest-first) into Mon-start weeks. Returns
    newest-first, each week a dict with date/high/low/close/volume."""
    if not daily:
        return []
    weeks: dict[str, dict] = {}
    for d in reversed(daily):  # oldest -> newest
        dt = date_cls.fromisoformat(d.date[:10])
        key = _monday_of(dt).isoformat()
        if key not in weeks:
            weeks[key] = {'date': key, 'high': d.high, 'low': d.low, 'close': d.close, 'volume': d.volume or 0}
        else:
            w = weeks[key]
            if d.high is not None:
                w['high'] = max(w['high'], d.high) if w['high'] is not None else d.high
            if d.low is not None:
                w['low'] = min(w['low'], d.low) if w['low'] is not None else d.low
            w['close'] = d.close
            w['volume'] = (w['volume'] or 0) + (d.volume or 0)
    return list(reversed(list(weeks.values())))


def weekly_rsi(bars: list[dict], period: int = 14) -> float | None:
    """Wilder's smoothing on weekly closes. `bars` is newest-first."""
    if len(bars) < period + 2:
        return None
    closes = [b['close'] for b in reversed(bars)]  # oldest -> newest
    diffs = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    ag = sum(d for d in diffs[:period] if d > 0) / period
    al = sum(-d for d in diffs[:period] if d < 0) / period
    for d in diffs[period:]:
        ag = (ag * (period - 1) + (d if d > 0 else 0)) / period
        al = (al * (period - 1) + (-d if d < 0 else 0)) / period
    return 100.0 if al == 0 else 100 - (100 / (1 + ag / al))


def obv_trend(bars: list[dict]) -> str:
    """'up' | 'down' | 'flat' | 'insufficient_data'. `bars` is newest-first."""
    if len(bars) < 12:
        return 'insufficient_data'
    b = list(reversed(bars))  # oldest -> newest
    obv = 0.0
    series = [0.0]
    for i in range(1, len(b)):
        if b[i]['close'] > b[i - 1]['close']:
            obv += b[i]['volume'] or 0
        elif b[i]['close'] < b[i - 1]['close']:
            obv -= b[i]['volume'] or 0
        series.append(obv)
    n = len(series)
    a4 = sum(series[n - 8:n - 4]) / 4
    b4 = sum(series[n - 4:]) / 4
    if b4 > a4 * 1.02:
        return 'up'
    if b4 < a4 * 0.98:
        return 'down'
    return 'flat'


def vol_drying(bars: list[dict]) -> bool:
    """`bars` is newest-first - slice(0,4) is the most recent 4 weeks."""
    if len(bars) < 8:
        return False
    r4 = sum((b['volume'] or 0) for b in bars[:4]) / 4
    p4 = sum((b['volume'] or 0) for b in bars[4:8]) / 4
    return r4 < p4 * 0.85


def sma(bars: list[dict], n: int) -> float:
    """`bars` is newest-first - averages however many bars exist, up to n."""
    s = bars[:min(n, len(bars))]
    return sum(b['close'] for b in s) / len(s)


# ── Drawdown / Fibonacci ─────────────────────────────────────────────────

def compute_drawdown_and_fib(price: float, year_high: float | None, daily: list[DailyBar]) -> dict:
    high52w = year_high if year_high else price
    dd52w = (high52w - price) / high52w * 100 if high52w > 0 else 0.0
    highs = [b.high for b in daily if b.high is not None]
    high4y = max(highs) if highs else high52w
    dd4y = (high4y - price) / high4y * 100 if high4y > 0 else 0.0
    drawdown_pct = max(dd52w, dd4y)

    lows = [b.low for b in daily[:252] if b.low is not None]
    swing_low = min(lows) if len(daily) >= 252 and lows else price * 0.80
    ath_price = high4y
    fib382 = swing_low + (ath_price - swing_low) * 0.382
    fib618 = swing_low + (ath_price - swing_low) * 0.618
    fib100 = ath_price

    return {
        'dd52w': dd52w, 'dd4y': dd4y, 'drawdownPct': drawdown_pct,
        'swingLow': swing_low, 'athPrice': ath_price,
        'fib382': fib382, 'fib618': fib618, 'fib100': fib100,
    }


def compute_etf_return_6m(etf_daily: list[DailyBar]) -> float | None:
    if len(etf_daily) < 130:
        return None
    n = etf_daily[0].close or 1
    s6 = etf_daily[min(130, len(etf_daily) - 1)].close or n
    return (n - s6) / s6 * 100


# ── Insider / grades / price target ──────────────────────────────────────

def _within_90d(raw_date: str | None, cutoff: datetime) -> bool:
    if not raw_date:
        return False
    try:
        return datetime.fromisoformat(raw_date[:10]).replace(tzinfo=timezone.utc) >= cutoff
    except ValueError:
        return False


def analyze_insiders(trades: list[InsiderTrade]) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    recent = [t for t in trades if _within_90d(t.transactionDate, cutoff)]

    def is_buy(t: InsiderTrade) -> bool:
        tp = (t.transactionType or '').lower()
        ad = (t.acquisitionOrDisposition or '').upper()
        return 'purchase' in tp or ad == 'A'

    def is_sell(t: InsiderTrade) -> bool:
        tp = (t.transactionType or '').lower()
        ad = (t.acquisitionOrDisposition or '').upper()
        return 'sale' in tp or ad == 'D'

    buys = [t for t in recent if is_buy(t)]
    sells = [t for t in recent if is_sell(t)]
    b_value = sum((t.securitiesTransacted or 0) * (t.price or 0) for t in buys)
    s_value = sum((t.securitiesTransacted or 0) * (t.price or 0) for t in sells)
    if b_value > s_value * 1.5:
        signal = 'Net Buying'
    elif s_value > b_value * 2:
        signal = 'Net Selling'
    else:
        signal = 'Neutral'
    return {
        'buys': len(buys), 'sells': len(sells), 'signal': signal, 'insiderBuying': b_value > s_value * 1.5,
        'recent': recent[:5],  # Phase 2 - catalyst pipeline table, frontend caps display at 4
    }


def analyze_grades(grades: list[GradeRecord]) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    recent = [g for g in grades if _within_90d(g.date, cutoff)]
    upgrades = sum(1 for g in recent if (g.action or '').lower() == 'upgrade')
    downgrades = sum(1 for g in recent if (g.action or '').lower() == 'downgrade')
    return {'upgrades': upgrades, 'downgrades': downgrades, 'recent': recent[:5]}


def compute_pt_avg(pt: PriceTargetInfo | None) -> float:
    if not pt:
        return 0.0
    if pt.targetConsensus:
        return pt.targetConsensus
    if pt.targetHigh and pt.targetLow:
        return (pt.targetHigh + pt.targetLow) / 2
    return 0.0


def compute_analyst_upside(pt_avg: float, price: float) -> float:
    return (pt_avg - price) / price * 100 if pt_avg > 0 and price else 0.0


def compute_price_to_sales(market_cap: float | None, revenue: float | None) -> float | None:
    if market_cap and revenue and market_cap > 0 and revenue > 0:
        return market_cap / revenue
    return None


# ── Fundamental Health (Phase 2) ─────────────────────────────────────────

def compute_fundamental_health(data: ContrarianComebackData) -> FundamentalHealth:
    income = data.incomeStatements
    i0 = income[0] if len(income) > 0 else None
    i1 = income[1] if len(income) > 1 else None

    de = (data.totalDebt / data.totalStockholdersEquity
          if data.totalDebt and data.totalStockholdersEquity and data.totalDebt > 0 and data.totalStockholdersEquity > 0
          else None)
    de_tier = None if de is None else 'green' if de <= 1.5 else 'yellow' if de <= 3 else 'red'

    current_r = (data.totalCurrentAssets / data.totalCurrentLiabilities
                 if data.totalCurrentAssets and data.totalCurrentLiabilities and data.totalCurrentAssets > 0 and data.totalCurrentLiabilities > 0
                 else None)
    current_r_tier = None if current_r is None else 'green' if current_r >= 1.2 else 'yellow' if current_r >= 0.8 else 'red'

    fcf = (data.operatingCashFlow or 0) + (data.capitalExpenditure or 0) if (data.operatingCashFlow is not None or data.capitalExpenditure is not None) else None
    fcf_tier = None if fcf is None else 'green' if fcf > 0 else 'red'
    positive_fcf = fcf is not None and fcf > 0

    rev_growth = ((i0.revenue - i1.revenue) / abs(i1.revenue) * 100
                  if i0 and i1 and i0.revenue is not None and i1.revenue else None)
    rev_growth_tier = None if rev_growth is None else 'green' if rev_growth > 0 else 'yellow' if rev_growth > -10 else 'red'

    gross_mgn = (i0.grossProfit / i0.revenue * 100 if i0 and i0.grossProfit is not None and i0.revenue else None)
    gross_mgn_tier = None if gross_mgn is None else 'green' if gross_mgn >= 30 else 'yellow' if gross_mgn >= 15 else 'red'

    cash_run = (data.cashAndCashEquivalents / abs(fcf) * 12
                if fcf is not None and fcf < 0 and data.cashAndCashEquivalents else None)
    cash_run_tier = None if cash_run is None else 'green' if cash_run >= 18 else 'yellow' if cash_run >= 9 else 'red'

    return FundamentalHealth(
        debtToEquity=FundamentalMetric(value=de, tier=de_tier),
        currentRatio=FundamentalMetric(value=current_r, tier=current_r_tier),
        freeCashFlow=FundamentalMetric(value=fcf, tier=fcf_tier),
        revenueGrowthPct=FundamentalMetric(value=rev_growth, tier=rev_growth_tier),
        grossMarginPct=FundamentalMetric(value=gross_mgn, tier=gross_mgn_tier),
        cashRunwayMonths=FundamentalMetric(value=cash_run, tier=cash_run_tier),
        positiveFcf=positive_fcf,
    )


# ── Staged Entry + Recovery Targets (Phase 3) ────────────────────────────

def compute_staged_entry(price: float, fib382: float, market_cap: float | None) -> StagedEntry:
    hard_stop = price * 0.85  # -15% from Tranche 1 midpoint (= price), no exceptions

    tranches = [
        TrancheEntry(
            label='T1', sizePct=40, priceLow=price * 0.97, priceHigh=price * 1.03,
            trigger='Exhaustion signals present — Weekly RSI <38, volume drying, price ≥25% off high',
        ),
        TrancheEntry(
            label='T2', sizePct=35, priceLow=price * 1.05, priceHigh=price * 1.18,
            trigger='Bottoming pattern confirming — RSI recovering above 40, price holds swing low 3+ weeks',
        ),
        TrancheEntry(
            label='T3', sizePct=25, priceLow=fib382 * 0.95, priceHigh=fib382 * 1.05,
            trigger='Early recovery confirmed — RSI >50, price reclaims 20W SMA, catalyst materialising',
        ),
    ]

    mcap = market_cap or 0
    cap_label = 'Large-Cap' if mcap >= 10e9 else 'Mid-Cap' if mcap >= 2e9 else 'Small-Cap'
    # Verbatim source behavior: true for anything under $10B, small-caps included -
    # not exclusively "true mid-cap". See model docstring.
    is_mid_cap = 0 < mcap < 10e9

    return StagedEntry(tranches=tranches, hardStop=hard_stop, capLabel=cap_label, isMidCap=is_mid_cap)


def compute_recovery_targets(
    price: float, fib382: float, fib618: float, fib100: float, hard_stop: float,
    pt_avg: float, price_target: PriceTargetInfo | None,
) -> RecoveryTargets:
    def ret(target: float) -> float:
        return (target - price) / price * 100 if price else 0.0

    base_case_price = max(fib618, pt_avg or fib618)

    analyst_consensus = None
    if pt_avg > 0 and price_target and price_target.targetLow is not None and price_target.targetHigh is not None:
        analyst_consensus = AnalystConsensusTarget(
            low=price_target.targetLow, high=price_target.targetHigh, average=pt_avg, returnPct=ret(pt_avg),
        )

    risk_reward = (fib618 - price) / (price - hard_stop) if fib618 > hard_stop and price > hard_stop else None

    return RecoveryTargets(
        conservative=RecoveryTarget(label='Conservative', horizon='12M', price=fib382, returnPct=ret(fib382)),
        baseCase=RecoveryTarget(label='Base Case', horizon='18M', price=base_case_price, returnPct=ret(base_case_price)),
        bullCase=RecoveryTarget(label='Bull Case', horizon='24M', price=fib100, returnPct=ret(fib100)),
        analystConsensus=analyst_consensus,
        riskRewardRatio=risk_reward,
    )


# ── Gate — checks 1, 3, 4 (auto) ─────────────────────────────────────────

def evaluate_auto_checks(data: ContrarianComebackData) -> dict:
    """Checks 1/3/4 only - shared by the gate-preview and submit paths so the
    two never drift. Populates failedCheck/reason/route the moment the FIRST
    auto-check fails (source app's main() evaluates them in this exact
    order and short-circuits on the first failure)."""
    dd = compute_drawdown_and_fib(data.price, data.yearHigh, data.dailyBars)
    check1_pass = dd['drawdownPct'] >= 25

    etf6m = compute_etf_return_6m(data.etfDailyBars) if data.etfSymbol else None
    if etf6m is not None and etf6m < -5:
        check3_status = 'hard_block' if etf6m < -20 else 'override_available'
    else:
        check3_status = 'pass'

    most_recent_revenue = data.incomeStatements[0].revenue if data.incomeStatements else None
    check4_pass = (most_recent_revenue or 0) > 0

    failed_check = reason = route = None
    if not check1_pass:
        failed_check = 'Check 1 — Drawdown Severity'
        reason = (
            f"{data.symbol} is only {dd['dd52w']:.1f}% below its 52-week high and "
            f"{dd['dd4y']:.1f}% below its 4-year high. Neither window reaches the ≥25% "
            "threshold needed for a meaningful dislocation."
        )
        route = 'Momentum Trading Skill (for near-ATH setups)'
    elif check3_status == 'hard_block':
        failed_check = 'Check 3 — Sector Health (Hard Block — override not available)'
        reason = (
            f"The {data.sector} sector ETF ({data.etfSymbol}) returned {etf6m:.1f}% over 6 "
            "months — a decline exceeding -20%. This level of sector damage is too severe to "
            "override; the tailwind this strategy requires is absent."
        )
        route = 'Revisit when the sector ETF stabilises above its 12-month moving average'
    elif not check4_pass:
        failed_check = 'Check 4 — Company Viability'
        reason = (
            f"{data.companyName or data.symbol} shows no positive revenue in available "
            "filings, raising viability concerns that disqualify it from contrarian analysis."
        )
        route = 'Avoid until financial viability is confirmed'

    return {
        **dd,
        'check1Pass': check1_pass,
        'etf6m': etf6m,
        'check3Status': check3_status,
        'check4Pass': check4_pass,
        'failedCheck': failed_check,
        'reason': reason,
        'route': route,
    }


def assemble_gate_response(data: ContrarianComebackData) -> ContrarianComebackGateResponse:
    checks = evaluate_auto_checks(data)
    insider = analyze_insiders(data.insiderTrades)
    grades = analyze_grades(data.grades)
    pt_avg = compute_pt_avg(data.priceTarget)
    upside = compute_analyst_upside(pt_avg, data.price)

    return ContrarianComebackGateResponse(
        symbol=data.symbol,
        check1Pass=checks['check1Pass'],
        drawdownPct=checks['drawdownPct'],
        dd52w=checks['dd52w'],
        dd4y=checks['dd4y'],
        check3Status=checks['check3Status'],
        etfSymbol=data.etfSymbol,
        etfReturn6M=checks['etf6m'],
        check4Pass=checks['check4Pass'],
        recentNews=data.news[:5],
        insiderSignal=insider['signal'],
        insiderBuys=insider['buys'],
        insiderSells=insider['sells'],
        analystUpgrades90d=grades['upgrades'],
        analystDowngrades90d=grades['downgrades'],
        priceTargetAvg=pt_avg if pt_avg > 0 else None,
        analystUpsidePct=upside if pt_avg > 0 else None,
        failedCheck=checks['failedCheck'],
        reason=checks['reason'],
        route=checks['route'],
    )


# ── 5-factor score ────────────────────────────────────────────────────────

def compute_score(
    drawdown_pct: float,
    breakdown_types: list[str],
    etf6m: float | None,
    weekly_rsi_value: float | None,
    is_vol_drying: bool,
    obv_up: bool,
    upside_pct: float,
    pe_ratio: float | None,
    price_to_sales: float | None,
    insider_buying: bool,
    analyst_upgrades: int,
    hybrid_cap: bool,
    check3_override: bool,
) -> ScoreBreakdown:
    is_event = any(t in ('event', 'corporate') for t in breakdown_types)
    breakdown = 2 if (drawdown_pct > 40 and is_event) else 1 if drawdown_pct >= 25 else 0

    if check3_override:
        sector = 0
    elif etf6m is None:
        sector = 1
    elif etf6m > 5:
        sector = 2
    elif etf6m >= -2:
        sector = 1
    else:
        sector = 0

    # rsi-is-not-None guards are load-bearing (unlike JS, `None < 40` raises
    # in Python rather than silently coercing to 0 < 40) - see plan.
    if weekly_rsi_value is not None and weekly_rsi_value < 35 and is_vol_drying and obv_up:
        technical = 2
    elif weekly_rsi_value is not None and weekly_rsi_value < 40:
        technical = 1
    else:
        technical = 0

    if (pe_ratio is not None and pe_ratio > 60) or (price_to_sales is not None and price_to_sales > 25):
        value = 0
    elif upside_pct > 40:
        value = 2
    elif upside_pct > 25:
        value = 1
    else:
        value = 0

    # 'strong catalyst' branch omitted - dead code in the source app, see plan.
    catalyst = 2 if insider_buying else 1 if analyst_upgrades > 0 else 0

    total = breakdown + sector + technical + value + catalyst
    if hybrid_cap:
        total = min(total, 7)
    if check3_override:
        total = min(total, 6)

    verdict = 'HIGH' if total >= 8 else 'MODERATE' if total >= 6 else 'SPECULATIVE' if total >= 4 else 'AVOID'

    return ScoreBreakdown(
        breakdown=breakdown, sector=sector, technical=technical, value=value, catalyst=catalyst,
        total=total, verdict=verdict, hybridCapActive=hybrid_cap, sectorOverrideCapActive=check3_override,
    )


# ── Submit — full gate (checks 1-5) + score ──────────────────────────────

_RED_TYPES = ('structural', 'valuation', 'fraud')
_YELLOW_TYPES = ('cyclical', 'guidance')
_RED_LABELS = {'structural': 'Structural Breakdown', 'valuation': 'Valuation Reset', 'fraud': 'Fraud / Governance'}


def assemble_submit_result(req: ContrarianComebackSubmitRequest) -> ContrarianComebackSubmitResponse:
    checks = evaluate_auto_checks(req)

    if checks['failedCheck'] is not None:  # check 1, 3-hard-block, or 4
        return ContrarianComebackSubmitResponse(
            symbol=req.symbol, format='B',
            failedCheck=checks['failedCheck'], reason=checks['reason'], route=checks['route'],
        )

    has_red = any(t in _RED_TYPES for t in req.breakdownTypes)
    has_yellow = any(t in _YELLOW_TYPES for t in req.breakdownTypes)
    if has_red:
        red_type = next(t for t in req.breakdownTypes if t in _RED_TYPES)
        label = _RED_LABELS[red_type]
        if red_type == 'valuation':
            reason = (
                f'The selected breakdown type "{label}" indicates the decline is not temporary. '
                f"If {req.symbol}'s business is healthy while the stock fell, this is multiple "
                "compression — not a contrarian setup."
            )
            route = 'LT-MT Stock Analyzer (for valuation-driven declines in fundamentally strong companies)'
        else:
            reason = (
                f'The selected breakdown type "{label}" indicates the decline is not temporary. '
                "This category disqualifies the stock from contrarian analysis."
            )
            route = ('Avoid — re-evaluate if structural thesis reverses' if red_type == 'structural'
                      else 'Avoid entirely until governance issues are resolved')
        return ContrarianComebackSubmitResponse(symbol=req.symbol, format='B', failedCheck='Check 2 — Breakdown Type', reason=reason, route=route)

    hybrid_cap = has_yellow and not has_red

    if req.catalystAnswer == 'no':
        return ContrarianComebackSubmitResponse(
            symbol=req.symbol, format='B',
            failedCheck='Check 5 — Recovery Catalyst',
            reason=(
                f'No recovery catalyst has been identified for {req.symbol}. A contrarian thesis '
                'without a catalyst is speculation, not analysis. Revisit when a catalyst emerges '
                '(earnings stabilisation, overhang resolution, insider buying, analyst upgrade).'
            ),
            route='Monitor and re-run analysis when a catalyst appears',
        )

    check3_override_active = False
    if checks['check3Status'] == 'override_available':
        if not req.check3Override:
            return ContrarianComebackSubmitResponse(
                symbol=req.symbol, format='B',
                failedCheck='Check 3 — Sector Health',
                reason=(
                    f"The {req.sector} sector ETF ({req.etfSymbol}) returned {checks['etf6m']:.1f}% "
                    "over 6 months. The override option was available but not selected."
                ),
                route='Wait for sector recovery before re-evaluating',
            )
        if not req.check3OverrideReason:
            return ContrarianComebackSubmitResponse(
                symbol=req.symbol, format='B',
                failedCheck='Check 3 — Sector Health',
                reason='An override reason is required to proceed with the sector-health override.',
                route='Select an override reason and resubmit.',
            )
        check3_override_active = True

    weekly_bars = to_weekly_bars(req.dailyBars)
    w_rsi = weekly_rsi(weekly_bars) if len(weekly_bars) >= 20 else None
    obv_dir = obv_trend(weekly_bars)
    vd = vol_drying(weekly_bars)
    sma200w = sma(weekly_bars, 200) if len(weekly_bars) >= 10 else None

    pt_avg = compute_pt_avg(req.priceTarget)
    upside = compute_analyst_upside(pt_avg, req.price)
    insider = analyze_insiders(req.insiderTrades)
    grades = analyze_grades(req.grades)
    most_recent_revenue = req.incomeStatements[0].revenue if req.incomeStatements else None
    price_to_sales = compute_price_to_sales(req.marketCap, most_recent_revenue)
    fundamental_health = compute_fundamental_health(req)
    catalyst_pipeline = CatalystPipeline(
        recentInsiderTrades=insider['recent'][:4], recentGrades=grades['recent'][:4], news=req.news,
    )
    staged_entry = compute_staged_entry(req.price, checks['fib382'], req.marketCap)
    recovery_targets = compute_recovery_targets(
        req.price, checks['fib382'], checks['fib618'], checks['fib100'],
        staged_entry.hardStop, pt_avg, req.priceTarget,
    )

    score = compute_score(
        drawdown_pct=checks['drawdownPct'],
        breakdown_types=req.breakdownTypes,
        etf6m=checks['etf6m'],
        weekly_rsi_value=w_rsi,
        is_vol_drying=vd,
        obv_up=(obv_dir == 'up'),
        upside_pct=upside,
        pe_ratio=req.peRatio,
        price_to_sales=price_to_sales,
        insider_buying=insider['insiderBuying'],
        analyst_upgrades=grades['upgrades'],
        hybrid_cap=hybrid_cap,
        check3_override=check3_override_active,
    )

    return ContrarianComebackSubmitResponse(
        symbol=req.symbol, format='A',
        companyName=req.companyName, sector=req.sector, exchange=req.exchange, price=req.price,
        drawdownPct=checks['drawdownPct'],
        breakdownTypes=req.breakdownTypes, hybridCap=hybrid_cap,
        check3Override=check3_override_active,
        check3OverrideReason=req.check3OverrideReason if check3_override_active else None,
        etfSymbol=req.etfSymbol, etfReturn6M=checks['etf6m'],
        score=score,
        technicals=WeeklyTechnicals(weeklyRsi=w_rsi, obvTrend=obv_dir, volumeDrying=vd, sma200w=sma200w),
        fibonacci=FibonacciLevels(
            swingLow=checks['swingLow'], athPrice=checks['athPrice'],
            fib382=checks['fib382'], fib618=checks['fib618'], fib100=checks['fib100'],
        ),
        fundamentalHealth=fundamental_health,
        catalystPipeline=catalyst_pipeline,
        stagedEntry=staged_entry,
        recoveryTargets=recovery_targets,
    )
