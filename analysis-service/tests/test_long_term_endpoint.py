from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _valid_payload() -> dict:
    return {
        "symbol": "AAPL",
        "companyName": "Apple Inc.",
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "exchange": "NASDAQ",
        "price": 200.0,
        "marketCap": 3_000_000_000_000,
        "beta": 1.2,
        "range52w": "150.00-220.00",
        "lastDividend": 1.0,
        "incomeStatements": [
            {"fiscalYear": "2026", "revenue": 1100, "grossProfit": 550, "operatingIncome": 220, "netIncome": 200, "eps": 6.0},
            {"fiscalYear": "2025", "revenue": 1000, "grossProfit": 500, "operatingIncome": 200, "netIncome": 150, "eps": 5.0},
        ],
        "earningsSurprises": [
            {"date": "2026-06-30", "epsActual": 1.6, "epsEstimated": 1.5},
        ],
        "priceTarget": {"targetConsensus": 230.0, "targetHigh": 260.0, "targetLow": 190.0},
        "grades": [
            {"gradingCompany": "Firm A", "newGrade": "Buy", "date": "2026-01-01"},
            {"gradingCompany": "Firm B", "newGrade": "Strong Buy", "date": "2026-01-01"},
        ],
        "peers": [
            {"symbol": "MSFT", "price": 400.0, "trailingPe": 30.0, "evToEbitda": 20.0, "marketCap": 3_000_000_000_000},
        ],
        "forwardEpsEstimate": 6.5,
        "evToEbitda": 22.0,
        "news": [
            {"date": "2026-07-20", "title": "Apple announces new product", "source": "Reuters", "url": "https://example.com"},
        ],
    }


def test_long_term_analysis_valid_payload_returns_200_with_expected_shape():
    response = client.post("/long-term-analysis", json=_valid_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["mediumTerm"]["rating"] in ("bullish", "neutral", "bearish")
    assert body["longTerm"]["rating"] in ("bullish", "neutral", "bearish")
    assert body["valuation"]["trailingPe"] is not None
    assert body["valuation"]["forwardPe"] is not None
    assert body["consensus"]["totalAnalysts"] == 2


def test_long_term_analysis_missing_required_field_returns_422():
    payload = _valid_payload()
    del payload["price"]
    response = client.post("/long-term-analysis", json=payload)
    assert response.status_code == 422


def test_long_term_analysis_minimal_payload_returns_200_with_nulled_metrics():
    response = client.post("/long-term-analysis", json={"symbol": "XYZ", "price": 10.0})
    assert response.status_code == 200
    body = response.json()
    assert body["valuation"]["trailingPe"] is None
    assert body["valuation"]["forwardPe"] is None
    assert body["consensus"]["totalAnalysts"] == 0
    assert body["mediumTerm"]["rating"] == "bearish"
    assert body["longTerm"]["rating"] == "bearish"
