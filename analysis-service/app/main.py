from fastapi import FastAPI
from pydantic import BaseModel

from app.models.contrarian_comeback import (
    ContrarianComebackData,
    ContrarianComebackGateResponse,
    ContrarianComebackSubmitRequest,
    ContrarianComebackSubmitResponse,
)
from app.models.contrarian_finder import ContrarianFinderScanBatchRequest, ScanResult
from app.models.long_term import LongTermAnalysisRequest, LongTermAnalysisResponse
from app.models.momentum import MomentumAnalysisRequest, MomentumAnalysisResponse
from app.scoring.contrarian_comeback import assemble_gate_response, assemble_submit_result
from app.scoring.contrarian_finder import assemble_scan_batch
from app.scoring.long_term import assemble_long_term_analysis
from app.scoring.momentum import assemble_momentum_analysis

app = FastAPI(title="analysis-service")


class HealthResponse(BaseModel):
    status: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/long-term-analysis", response_model=LongTermAnalysisResponse)
def long_term_analysis(payload: LongTermAnalysisRequest) -> LongTermAnalysisResponse:
    return assemble_long_term_analysis(payload)


@app.post("/contrarian-comeback/gate", response_model=ContrarianComebackGateResponse)
def contrarian_comeback_gate(payload: ContrarianComebackData) -> ContrarianComebackGateResponse:
    return assemble_gate_response(payload)


@app.post("/contrarian-comeback", response_model=ContrarianComebackSubmitResponse)
def contrarian_comeback_submit(payload: ContrarianComebackSubmitRequest) -> ContrarianComebackSubmitResponse:
    return assemble_submit_result(payload)


@app.post("/momentum-analysis", response_model=MomentumAnalysisResponse)
def momentum_analysis(payload: MomentumAnalysisRequest) -> MomentumAnalysisResponse:
    return assemble_momentum_analysis(payload.closes, payload.lows, payload.volumes, payload.price)


@app.post("/contrarian-finder/scan-batch", response_model=list[ScanResult])
def contrarian_finder_scan_batch(payload: ContrarianFinderScanBatchRequest) -> list[ScanResult]:
    return assemble_scan_batch(payload.stocks, payload.quality, payload.scanDays)
