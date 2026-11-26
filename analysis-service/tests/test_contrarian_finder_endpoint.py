from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _bar(date: str, close: float) -> dict:
    return {"date": date, "close": close, "low": close - 1}


def _valid_payload() -> dict:
    return {
        "stocks": [
            {
                "symbol": "AAPL",
                "quote": {"price": 200.0, "marketCap": 3_000_000_000_000, "name": "Apple Inc.", "sector": "Technology", "volume": 1000, "avgVolume": 800},
                "historicalBars": [_bar(f"2026-06-{10 + i}", 200 - i) for i in range(10)],
            },
        ],
        "quality": {"minPrice": 10, "minMarketCap": 5e9},
        "scanDays": 7,
    }


def test_scan_batch_valid_payload_returns_200_with_expected_shape():
    response = client.post("/contrarian-finder/scan-batch", json=_valid_payload())
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["symbol"] == "AAPL"
    assert "filterFail" in body[0]


def test_scan_batch_missing_required_field_returns_422():
    payload = _valid_payload()
    del payload["quality"]
    response = client.post("/contrarian-finder/scan-batch", json=payload)
    assert response.status_code == 422


def test_scan_batch_empty_stocks_list_returns_200_with_empty_results():
    payload = _valid_payload()
    payload["stocks"] = []
    response = client.post("/contrarian-finder/scan-batch", json=payload)
    assert response.status_code == 200
    assert response.json() == []
