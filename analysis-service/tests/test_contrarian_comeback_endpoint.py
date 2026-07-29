from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _bar(date_str: str, close: float, high=None, low=None, volume=1000) -> dict:
    return {"date": date_str, "high": high if high is not None else close, "low": low if low is not None else close, "close": close, "volume": volume}


def _valid_data(**overrides) -> dict:
    data = {
        "symbol": "AAPL",
        "companyName": "Apple Inc.",
        "sector": "Technology",
        "exchange": "NASDAQ",
        "price": 50.0,
        "marketCap": 1_000_000_000,
        "yearHigh": 100.0,
        "peRatio": 15.0,
        "incomeStatements": [{"revenue": 1000.0, "grossProfit": 400.0}, {"revenue": 900.0, "grossProfit": 350.0}],
        "dailyBars": [_bar("2026-07-20", 50.0, high=100.0)],
        "etfSymbol": None,
        "etfDailyBars": [],
        "priceTarget": {"targetConsensus": 70.0, "targetHigh": 80.0, "targetLow": 60.0},
        "grades": [],
        "insiderTrades": [],
        "news": [],
    }
    data.update(overrides)
    return data


def test_gate_returns_200_with_no_failed_check_for_a_healthy_dislocation():
    response = client.post("/contrarian-comeback/gate", json=_valid_data())
    assert response.status_code == 200
    body = response.json()
    assert body["check1Pass"] is True
    assert body["check4Pass"] is True
    assert body["check3Status"] == "pass"
    assert body["failedCheck"] is None


def test_gate_reports_failed_check_when_drawdown_insufficient():
    payload = _valid_data(price=99.0, yearHigh=100.0, dailyBars=[_bar("2026-07-20", 99.0, high=100.0)])
    response = client.post("/contrarian-comeback/gate", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["check1Pass"] is False
    assert body["failedCheck"] == "Check 1 — Drawdown Severity"


def test_gate_missing_required_field_returns_422():
    payload = _valid_data()
    del payload["price"]
    response = client.post("/contrarian-comeback/gate", json=payload)
    assert response.status_code == 422


def test_submit_returns_format_a_for_a_clean_pass():
    payload = {**_valid_data(), "breakdownTypes": ["event"], "catalystAnswer": "yes"}
    response = client.post("/contrarian-comeback", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "A"
    assert body["score"]["total"] >= 0
    assert body["score"]["verdict"] in ("HIGH", "MODERATE", "SPECULATIVE", "AVOID")


def test_submit_returns_format_b_for_no_catalyst():
    payload = {**_valid_data(), "breakdownTypes": ["event"], "catalystAnswer": "no"}
    response = client.post("/contrarian-comeback", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "B"
    assert body["failedCheck"] == "Check 5 — Recovery Catalyst"


def test_submit_empty_breakdown_types_returns_422():
    payload = {**_valid_data(), "breakdownTypes": [], "catalystAnswer": "yes"}
    response = client.post("/contrarian-comeback", json=payload)
    assert response.status_code == 422


def test_submit_missing_catalyst_answer_returns_422():
    payload = {**_valid_data(), "breakdownTypes": ["event"]}
    response = client.post("/contrarian-comeback", json=payload)
    assert response.status_code == 422


def test_submit_format_a_response_includes_fundamental_health_and_catalyst_pipeline():
    payload = {**_valid_data(), "breakdownTypes": ["event"], "catalystAnswer": "yes"}
    response = client.post("/contrarian-comeback", json=payload)
    body = response.json()
    assert body["format"] == "A"
    assert body["fundamentalHealth"] is not None
    assert set(body["fundamentalHealth"].keys()) == {
        "debtToEquity", "currentRatio", "freeCashFlow", "revenueGrowthPct", "grossMarginPct", "cashRunwayMonths", "positiveFcf",
    }
    assert body["catalystPipeline"] is not None
    assert set(body["catalystPipeline"].keys()) == {"recentInsiderTrades", "recentGrades", "news"}


def test_submit_format_a_response_includes_staged_entry_and_recovery_targets():
    payload = {**_valid_data(), "breakdownTypes": ["event"], "catalystAnswer": "yes"}
    response = client.post("/contrarian-comeback", json=payload)
    body = response.json()
    assert body["format"] == "A"
    assert body["stagedEntry"] is not None
    assert len(body["stagedEntry"]["tranches"]) == 3
    assert set(body["stagedEntry"].keys()) == {"tranches", "hardStop", "capLabel", "isMidCap"}
    assert body["recoveryTargets"] is not None
    assert set(body["recoveryTargets"].keys()) == {"conservative", "baseCase", "bullCase", "analystConsensus", "riskRewardRatio"}
