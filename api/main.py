"""FastAPI entry point for Module 4 reasoning and explainability."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from reasoning.builder import build_decision_record
from reasoning.explanation import answer_followup
from reasoning.models import AskDecisionRequest, ExplainDecisionRequest

FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"

app = FastAPI(
    title="Squirrel Module 4 Reasoning API",
    version="0.1.0",
    description="Deterministic decision evidence chains for traffic incident explainability.",
)

app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")


@app.get("/")
def dashboard() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "module": "reasoning-explainability"}


@app.post("/api/decisions/explain")
def explain_decision(request: ExplainDecisionRequest) -> dict:
    try:
        record = build_decision_record(timestamp=request.timestamp, event_id=request.event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return record.model_dump()


@app.get("/api/decisions/demo")
def demo_decision(timestamp: str = "2026-05-20 22:15", event_id: str = "TPE_2026_ACC_001") -> dict:
    try:
        return build_decision_record(timestamp=timestamp, event_id=event_id).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/decisions/ask")
def ask_decision(request: AskDecisionRequest) -> dict:
    try:
        record = build_decision_record(timestamp=request.timestamp, event_id=request.event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "decision_id": record.decision_id,
        "question": request.question,
        "answer": answer_followup(record, request.question),
        "evidence_chain": [step.model_dump() for step in record.evidence_chain],
    }
