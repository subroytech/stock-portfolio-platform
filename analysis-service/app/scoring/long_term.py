import re

from app.models.long_term import (
    AnalystConsensus,
    AnalystGrade,
    ConvictionResult,
    EarningsSurprise,
    FinancialGrowth,
    GrowthMetric,
    IncomeStatementPeriod,
    LongTermAnalysisRequest,
    LongTermAnalysisResponse,
    MarginMetric,
    PeerQuote,
    PriceTarget,
    ValuationMetrics,
)

# Ported verbatim from CreateStockPortfolioViewWOSkill/lt-analysis.html's
# grade-classification regexes.
STRONG_BUY_RE = re.compile(r"strong.?buy|outperform|overweight|top.?pick|conviction.?buy", re.I)
BUY_RE = re.compile(r"^buy$|^long$|^positive$", re.I)
HOLD_RE = re.compile(r"hold|neutral|market.?perform|equal.?weight|sector.?perform|in.?line", re.I)
SELL_RE = re.compile(r"sell|underperform|underweight|negative|reduce", re.I)
STRONG_SELL_RE = re.compile(r"strong.?sell", re.I)


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{'+' if value >= 0 else ''}{value:.1f}%"


def bucket_grades(grades: list[AnalystGrade]) -> AnalystConsensus:
    """Dedupe to the latest record per firm, then classify into
    strongBuy/buy/hold/sell/strongSell buckets — ported from the source
    app's client-side logic (it fetched raw /grades records and did this
    classification in the browser; here it's server-side Python instead)."""
    latest_by_firm: dict[str, AnalystGrade] = {}
    for g in grades:
        existing = latest_by_firm.get(g.gradingCompany)
        if existing is None or g.date > existing.date:
            latest_by_firm[g.gradingCompany] = g

    sb = b = h = s = ss = 0
    for g in latest_by_firm.values():
        grade_text = (g.newGrade or "").strip()
        if STRONG_SELL_RE.search(grade_text):
            ss += 1
        elif SELL_RE.search(grade_text):
            s += 1
        elif HOLD_RE.search(grade_text):
            h += 1
        elif STRONG_BUY_RE.search(grade_text):
            sb += 1
        elif BUY_RE.search(grade_text):
            b += 1
        else:
            sb += 1  # unknown/unrecognized grade text → counted as strongBuy, matches source

    total = sb + b + h + s + ss
    buy_pct = round((sb + b) / total * 100) if total else 0
    hold_pct = round(h / total * 100) if total else 0
    sell_pct = 100 - buy_pct - hold_pct if total else 0

    return AnalystConsensus(
        strongBuy=sb, buy=b, hold=h, sell=s, strongSell=ss,
        totalAnalysts=total, buyPct=buy_pct, holdPct=hold_pct, sellPct=sell_pct,
    )


def _net_income_growth_pct(i0: IncomeStatementPeriod, i1: IncomeStatementPeriod) -> float | None:
    if i0.netIncome is not None and i1.netIncome:
        return ((i0.netIncome - i1.netIncome) / abs(i1.netIncome)) * 100
    return None


def compute_financial_growth(income: list[IncomeStatementPeriod]) -> FinancialGrowth:
    """Uses only the 2 most recent of the (up to 3) annual periods passed in,
    matching the source app exactly."""
    i0 = income[0] if len(income) > 0 else IncomeStatementPeriod()
    i1 = income[1] if len(income) > 1 else IncomeStatementPeriod()

    rev0, rev1 = i0.revenue, i1.revenue
    rev_growth = ((rev0 - rev1) / abs(rev1)) * 100 if rev0 and rev1 else None

    gm0 = (i0.grossProfit / i0.revenue) * 100 if i0.grossProfit is not None and i0.revenue else None
    gm1 = (i1.grossProfit / i1.revenue) * 100 if i1.grossProfit is not None and i1.revenue else None
    gm_delta = gm0 - gm1 if gm0 is not None and gm1 is not None else None

    om0 = (i0.operatingIncome / i0.revenue) * 100 if i0.operatingIncome is not None and i0.revenue else None
    om1 = (i1.operatingIncome / i1.revenue) * 100 if i1.operatingIncome is not None and i1.revenue else None
    om_delta = om0 - om1 if om0 is not None and om1 is not None else None

    eps0, eps1 = i0.eps, i1.eps
    eps_growth = ((eps0 - eps1) / abs(eps1)) * 100 if eps0 and eps1 else None

    fy_label = f"FY{i0.fiscalYear}" if i0.fiscalYear else "Latest Annual"
    fy_prev_label = f"FY{i1.fiscalYear}" if i1.fiscalYear else "Prior Year"

    return FinancialGrowth(
        fyLabel=fy_label,
        fyPrevLabel=fy_prev_label,
        revenue=GrowthMetric(current=rev0, prior=rev1, yoyPct=rev_growth),
        grossMargin=MarginMetric(current=gm0, prior=gm1, deltaPp=gm_delta),
        operatingMargin=MarginMetric(current=om0, prior=om1, deltaPp=om_delta),
        eps=GrowthMetric(current=eps0, prior=eps1, yoyPct=eps_growth),
        netIncomeGrowthPct=_net_income_growth_pct(i0, i1),
    )


def compute_earnings_surprise_pct(surprises: list[EarningsSurprise]) -> float | None:
    """Most recent quarter only (index 0) — the surprise *table* shows 4
    quarters, but scoring only ever used the latest, matching source."""
    if not surprises:
        return None
    s0 = surprises[0]
    if s0.epsActual is None or s0.epsEstimated is None:
        return None
    return ((s0.epsActual - s0.epsEstimated) / abs(s0.epsEstimated)) * 100


def compute_upside_pct(price: float, price_target: PriceTarget | None) -> float | None:
    if not price_target or price_target.targetConsensus is None or not price:
        return None
    return ((price_target.targetConsensus - price) / price) * 100


def compute_valuation(
    price: float,
    eps0: float | None,
    forward_eps: float | None,
    ev_ebitda: float | None,
    peers: list[PeerQuote],
) -> ValuationMetrics:
    trailing_pe = price / eps0 if eps0 and eps0 > 0 else None
    forward_pe = price / forward_eps if forward_eps and forward_eps > 0 else None

    peer_pes = [p.trailingPe for p in peers if p.trailingPe is not None]
    peer_evs = [p.evToEbitda for p in peers if p.evToEbitda is not None]
    peer_avg_pe = sum(peer_pes) / len(peer_pes) if peer_pes else None
    peer_avg_ev = sum(peer_evs) / len(peer_evs) if peer_evs else None

    return ValuationMetrics(
        trailingPe=trailing_pe,
        forwardPe=forward_pe,
        evToEbitda=ev_ebitda,
        peerAvgTrailingPe=peer_avg_pe,
        peerAvgEvToEbitda=peer_avg_ev,
        peerCount=len(peers),
    )


def _mt_rationale(rating: str, buy_pct: int, surprise_pct: float | None, rev_growth: float | None) -> str:
    surp = surprise_pct or 0
    if rating == "bullish":
        beat_clause = f"beat (+{surp:.1f}%)" if surp > 0 else "performance"
        return (
            f"Analyst consensus ({buy_pct}% Buy) and recent earnings {beat_clause} "
            f"support a constructive medium-term view. Revenue growth of {_fmt_pct(rev_growth)} "
            "provides near-term momentum."
        )
    if rating == "neutral":
        return (
            f"Mixed signals — analyst consensus at {buy_pct}% Buy with moderate earnings growth. "
            "Monitor next quarterly results for directional clarity."
        )
    return (
        "Earnings trends and analyst sentiment suggest near-term caution. "
        "Watch for guidance revisions before adding exposure."
    )


def _lt_rationale(rating: str, net_income_growth: float | None) -> str:
    if rating == "bullish":
        return (
            f"Strong earnings growth trajectory ({_fmt_pct(net_income_growth)} net income growth YoY) "
            "and solid analyst conviction make this a viable long-term compounder. Thesis holds as "
            "long as revenue growth remains above 8%."
        )
    if rating == "neutral":
        return (
            "Reasonable long-term fundamentals but valuation or growth rate does not yet justify "
            "high conviction. Re-evaluate after 2 more quarters of data."
        )
    return (
        "Long-term fundamentals appear challenged. Declining revenue growth or weak analyst "
        "conviction warrants a cautious position."
    )


def _rating_from_score(score: int) -> str:
    return "bullish" if score >= 5 else "neutral" if score >= 3 else "bearish"


def derive_conviction(
    buy_pct: int,
    rev_growth: float | None,
    net_income_growth: float | None,
    surprise_pct: float | None,
    forward_pe: float | None,
) -> tuple[ConvictionResult, ConvictionResult]:
    """Ported point-scoring rules from lt-analysis.html's deriveConviction().
    Medium-term (mt) and long-term (lt) scores computed independently and
    allowed to diverge. The forward-P/E rule was dead code in the source
    (its `fwdPe` was always 0 — the field it read didn't exist in FMP's
    /stable tier) — here it is activated with a real forward P/E value."""
    rev = rev_growth or 0
    net_inc = net_income_growth or 0
    surp = surprise_pct or 0
    fwd_pe = forward_pe or 0

    mt_score = 0
    lt_score = 0

    if buy_pct >= 65:
        mt_score += 2
        lt_score += 2
    elif buy_pct >= 45:
        mt_score += 1
        lt_score += 1

    if surp > 5:
        mt_score += 2
    elif surp > 0:
        mt_score += 1

    if rev > 10:
        mt_score += 1
        lt_score += 2
    elif rev > 5:
        lt_score += 1

    if net_inc > 15:
        lt_score += 2
    elif net_inc > 8:
        lt_score += 1

    if 0 < fwd_pe < 20:
        mt_score += 1
        lt_score += 1

    mt_rating = _rating_from_score(mt_score)
    lt_rating = _rating_from_score(lt_score)

    return (
        ConvictionResult(rating=mt_rating, score=mt_score, rationale=_mt_rationale(mt_rating, buy_pct, surprise_pct, rev_growth)),
        ConvictionResult(rating=lt_rating, score=lt_score, rationale=_lt_rationale(lt_rating, net_income_growth)),
    )


def build_bull_bear_signals(
    rev_growth: float | None,
    eps_growth: float | None,
    gm_delta: float | None,
    buy_pct: int,
    upside_pct: float | None,
) -> tuple[list[str], list[str]]:
    """Ported verbatim from lt-analysis.html's bull/bear signal conditions.
    Note: `eps_growth` here is genuine EPS YoY growth (FinancialGrowth.eps.yoyPct),
    NOT the net-income-based figure derive_conviction() uses — the source app
    has two same-named-but-different local variables for these, kept distinct
    here as `eps.yoyPct` vs `netIncomeGrowthPct`."""
    bull: list[str] = []
    bear: list[str] = []

    if rev_growth is not None and rev_growth > 10:
        bull.append(f"Revenue growth of {_fmt_pct(rev_growth)} YoY demonstrates strong top-line momentum.")
    if eps_growth is not None and eps_growth > 10:
        bull.append(f"EPS growth of {_fmt_pct(eps_growth)} YoY signals improving profitability.")
    if gm_delta is not None and gm_delta > 0:
        bull.append(f"Gross margin expanding (+{gm_delta:.1f}pp) — pricing power intact.")
    if buy_pct >= 65:
        bull.append(f"{buy_pct}% of analysts rate this a Buy — strong institutional conviction.")
    if upside_pct is not None and upside_pct > 10:
        bull.append(f"Consensus price target implies {upside_pct:.1f}% upside from current levels.")
    if rev_growth is None and eps_growth is None:
        bull.append("Insufficient data to derive bull signals — check income statement availability.")

    if rev_growth is not None and rev_growth < 5:
        bear.append(f"Revenue growth of only {_fmt_pct(rev_growth)} — below healthy threshold of 10%.")
    if eps_growth is not None and eps_growth < 0:
        bear.append(f"EPS declining {_fmt_pct(eps_growth)} YoY — earnings deterioration risk.")
    if gm_delta is not None and gm_delta < -2:
        bear.append(f"Gross margin contracting ({gm_delta:.1f}pp) — potential commoditisation pressure.")
    if buy_pct < 45:
        bear.append(f"Only {buy_pct}% Buy consensus — limited analyst conviction.")
    if upside_pct is not None and upside_pct < 0:
        bear.append("Stock trading above consensus price target — limited upside priced in.")
    if rev_growth is None and eps_growth is None:
        bear.append("Insufficient data to derive bear signals.")

    return bull, bear


def assemble_long_term_analysis(req: LongTermAnalysisRequest) -> LongTermAnalysisResponse:
    financials = compute_financial_growth(req.incomeStatements)
    eps0 = req.incomeStatements[0].eps if req.incomeStatements else None

    surprise_pct = compute_earnings_surprise_pct(req.earningsSurprises)
    consensus = bucket_grades(req.grades)
    valuation = compute_valuation(req.price, eps0, req.forwardEpsEstimate, req.evToEbitda, req.peers)
    upside_pct = compute_upside_pct(req.price, req.priceTarget)

    medium_term, long_term = derive_conviction(
        consensus.buyPct,
        financials.revenue.yoyPct,
        financials.netIncomeGrowthPct,
        surprise_pct,
        valuation.forwardPe,
    )
    bull_signals, bear_signals = build_bull_bear_signals(
        financials.revenue.yoyPct,
        financials.eps.yoyPct,
        financials.grossMargin.deltaPp,
        consensus.buyPct,
        upside_pct,
    )

    peer_note = (
        f"Sector peers sourced live from FMP. Revenue/EPS growth shown for {req.symbol} only; "
        "peer P/E and EV/EBITDA derived from live quote/key-metrics data."
        if req.peers
        else f"No peer data returned for {req.symbol}."
    )

    return LongTermAnalysisResponse(
        symbol=req.symbol,
        companyName=req.companyName,
        sector=req.sector,
        industry=req.industry,
        exchange=req.exchange,
        price=req.price,
        marketCap=req.marketCap,
        beta=req.beta,
        range52w=req.range52w,
        dividend=req.lastDividend if req.lastDividend and req.lastDividend > 0 else None,
        valuation=valuation,
        financials=financials,
        earningsSurprises=req.earningsSurprises[:4],
        priceTarget=req.priceTarget,
        upsidePct=upside_pct,
        consensus=consensus,
        peers=req.peers,
        peerNote=peer_note,
        bullSignals=bull_signals,
        bearSignals=bear_signals,
        mediumTerm=medium_term,
        longTerm=long_term,
        news=req.news,
    )
