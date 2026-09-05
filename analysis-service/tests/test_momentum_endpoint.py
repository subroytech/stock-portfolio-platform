from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _make_series(length: int) -> list[float]:
    return [float(length - i) for i in range(length)]


def _valid_payload() -> dict:
    closes = _make_series(60)
    return {
        "closes": closes,
        "lows": [c - 1 for c in closes],
        "volumes": [100.0] * 60,
        "price": closes[0],
    }


def test_momentum_analysis_valid_payload_returns_200_with_expected_shape():
    response = client.post("/momentum-analysis", json=_valid_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["signal"] in ("STRONG BUY", "BUY", "WATCH", "AVOID")
    assert body["score"]["total"] == (
        body["score"]["rsi"] + body["score"]["macd"] + body["score"]["volume"]
        + body["score"]["trend"] + body["score"]["riskReward"]
    )
    assert len(body["flags"]) >= 1


def test_momentum_analysis_missing_required_field_returns_422():
    payload = _valid_payload()
    del payload["price"]
    response = client.post("/momentum-analysis", json=payload)
    assert response.status_code == 422
