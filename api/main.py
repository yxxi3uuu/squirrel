"""FastAPI entry point for Module 4 reasoning and explainability."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from reasoning.builder import build_decision_record
from reasoning.counterfactual import find_all_counterfactuals, find_counterfactual
from reasoning.explanation import answer_followup
from reasoning.models import AskDecisionRequest, CounterfactualRequest, ExplainDecisionRequest
from reasoning.sensitivity import analyze_sensitivity

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


@app.post("/api/decisions/counterfactual")
def counterfactual_decision(request: CounterfactualRequest) -> dict:
    from data.snapshot import get_snapshot
    from reasoning.builder import _build_evidence, _select_event

    try:
        snapshot = get_snapshot(request.timestamp)
        event = _select_event(snapshot, request.event_id)
        affected = snapshot["road_segments"].get(event["affected_segment"])
        if not affected:
            raise ValueError(f"Affected segment {event['affected_segment']} not found")
        _, evidence_by_key = _build_evidence(snapshot, event, affected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if request.target_segment:
        result = find_counterfactual(
            snapshot, event, evidence_by_key,
            target_segment=request.target_segment,
            target_field=request.target_field,
            direction=request.direction,
            step=request.step,
            max_steps=request.max_steps,
        )
        return {
            "mode": "single",
            "result": result.to_dict() if result else None,
            "message": result._narrative() if result else "在搜尋範圍內未找到翻轉點",
        }
    else:
        results = find_all_counterfactuals(snapshot, event, evidence_by_key)
        return {
            "mode": "auto",
            "results": [r.to_dict() for r in results],
            "summary": results[0]._narrative() if results else "在搜尋範圍內未找到翻轉點",
        }


@app.post("/api/decisions/sensitivity")
def sensitivity_analysis(request: ExplainDecisionRequest) -> dict:
    from data.snapshot import get_snapshot
    from reasoning.builder import _build_evidence, _select_event

    try:
        snapshot = get_snapshot(request.timestamp)
        event = _select_event(snapshot, request.event_id)
        affected = snapshot["road_segments"].get(event["affected_segment"])
        if not affected:
            raise ValueError(f"Affected segment {event['affected_segment']} not found")
        _, evidence_by_key = _build_evidence(snapshot, event, affected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    report = analyze_sensitivity(snapshot, event, evidence_by_key)
    return report.to_dict()


@app.post("/api/decisions/explain-ai")
def explain_with_bedrock(request: ExplainDecisionRequest) -> dict:
    """Generate explanation with Bedrock (falls back to deterministic)."""
    from reasoning.bedrock import generate_bedrock_review, generate_explanation_with_fallback

    try:
        record = build_decision_record(timestamp=request.timestamp, event_id=request.event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    enhanced_explanation = generate_explanation_with_fallback(record)
    review = generate_bedrock_review(record)

    return {
        "decision_id": record.decision_id,
        "explanation": enhanced_explanation.model_dump(),
        "review": review,
        "bedrock_enabled": __import__("reasoning.bedrock", fromlist=["BEDROCK_ENABLED"]).BEDROCK_ENABLED,
        "fallback_used": enhanced_explanation.summary == record.explanation.summary,
    }


@app.get("/api/replay")
def list_decisions(event_id: str = None, limit: int = 50) -> dict:
    """List stored decisions (optionally filtered by event)."""
    from reasoning.replay import replay_store

    if event_id:
        entries = replay_store.list_by_event(event_id)
    else:
        entries = replay_store.list_all(limit=limit)

    return {
        "total": replay_store.count(),
        "decisions": [
            {
                "decision_id": e.record.decision_id,
                "event_id": e.record.event.event_id,
                "created_at": e.record.created_at,
                "classification": e.record.classification.level,
                "recommended_route": next(
                    (r.name for r in e.record.route_candidates if r.status == "recommended"),
                    None,
                ),
                "confidence": e.record.confidence.score,
                "reliability": e.record.reliability.overall,
                "has_override": e.override is not None,
                "stored_at": e.stored_at,
            }
            for e in entries
        ],
    }


@app.get("/api/replay/{decision_id}")
def get_decision(decision_id: str) -> dict:
    """Retrieve a full stored DecisionRecord."""
    from reasoning.replay import replay_store

    entry = replay_store.get(decision_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Decision {decision_id} not found")
    return {
        "record": entry.record.model_dump(),
        "stored_at": entry.stored_at,
        "override": {
            "operator": entry.override.operator,
            "action": entry.override.action,
            "original_route": entry.override.original_route,
            "modified_route": entry.override.modified_route,
            "reason": entry.override.reason,
            "timestamp": entry.override.timestamp,
            "published": entry.override.published,
        } if entry.override else None,
    }


@app.post("/api/replay/{decision_id}/override")
def override_decision(decision_id: str, body: dict) -> dict:
    """Add a human override to a stored decision."""
    from reasoning.replay import HumanOverride, replay_store

    entry = replay_store.get(decision_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Decision {decision_id} not found")

    override = HumanOverride(
        operator=body.get("operator", "unknown"),
        original_route=body.get("original_route", ""),
        modified_route=body.get("modified_route"),
        reason=body.get("reason", ""),
        action=body.get("action", "accept"),
        timestamp=body.get("timestamp", ""),
        published=body.get("published", False),
    )

    success = replay_store.add_override(decision_id, override)
    if not success:
        raise HTTPException(status_code=404, detail="Failed to save override")

    return {
        "decision_id": decision_id,
        "action": override.action,
        "message": f"Override recorded: {override.action}",
    }
