from fastapi import FastAPI
from pydantic import BaseModel

from app.models.long_term import LongTermAnalysisRequest, LongTermAnalysisResponse
from app.scoring.long_term import assemble_long_term_analysis

app = FastAPI(title="analysis-service")


class HealthResponse(BaseModel):
    status: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/long-term-analysis", response_model=LongTermAnalysisResponse)
def long_term_analysis(payload: LongTermAnalysisRequest) -> LongTermAnalysisResponse:
    return assemble_long_term_analysis(payload)
