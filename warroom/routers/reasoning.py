"""模組四 API：決策推理、解釋鏈、反事實、敏感度、Replay"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


# ── Request Models ─────────────────────────────────────────────────────────
class ExplainRequest(BaseModel):
    timestamp: Optional[str] = None
    event_id: Optional[str] = None


class AskRequest(BaseModel):
    question: str
    timestamp: Optional[str] = None
    event_id: Optional[str] = None


class CounterfactualRequest(BaseModel):
    timestamp: Optional[str] = None
    event_id: Optional[str] = None
    target_segment: Optional[str] = None
    target_field: str = "saturation_score"
    direction: str = "increase"
    step: float = 0.01
    max_steps: int = 200


class SensitivityRequest(BaseModel):
    timestamp: Optional[str] = None
    event_id: Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/explain")
def explain_decision(req: ExplainRequest):
    """建立完整 DecisionRecord 並回傳結構化解釋。"""
    from reasoning.builder import build_decision_record

    try:
        record = build_decision_record(timestamp=req.timestamp, event_id=req.event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return record.model_dump()


@router.get("/demo")
def demo_decision(timestamp: str = "2026-05-20 22:15", event_id: str = "TPE_2026_ACC_001"):
    """Demo 用預設決策。"""
    from reasoning.builder import build_decision_record

    try:
        return build_decision_record(timestamp=timestamp, event_id=event_id).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/ask")
def ask_decision(req: AskRequest):
    """追問：為什麼分級、為什麼推薦、為什麼排除等。"""
    from reasoning.builder import build_decision_record
    from reasoning.explanation import answer_followup

    try:
        record = build_decision_record(timestamp=req.timestamp, event_id=req.event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "decision_id": record.decision_id,
        "question": req.question,
        "answer": answer_followup(record, req.question),
        "evidence_chain": [step.model_dump() for step in record.evidence_chain],
    }


@router.post("/counterfactual")
def counterfactual_analysis(req: CounterfactualRequest):
    """反事實分析：什麼最小變化會讓推薦翻轉。"""
    from data.snapshot import get_snapshot
    from reasoning.builder import _build_evidence, _select_event
    from reasoning.counterfactual import find_all_counterfactuals, find_counterfactual

    try:
        snapshot = get_snapshot(req.timestamp)
        event = _select_event(snapshot, req.event_id)
        affected = snapshot["road_segments"].get(event["affected_segment"])
        if not affected:
            raise ValueError(f"Affected segment {event['affected_segment']} not found")
        _, evidence_by_key = _build_evidence(snapshot, event, affected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if req.target_segment:
        result = find_counterfactual(
            snapshot, event, evidence_by_key,
            target_segment=req.target_segment,
            target_field=req.target_field,
            direction=req.direction,
            step=req.step,
            max_steps=req.max_steps,
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


@router.post("/sensitivity")
def sensitivity_analysis(req: SensitivityRequest):
    """敏感度分析：決策穩定度與最近翻轉點。"""
    from data.snapshot import get_snapshot
    from reasoning.builder import _build_evidence, _select_event
    from reasoning.sensitivity import analyze_sensitivity

    try:
        snapshot = get_snapshot(req.timestamp)
        event = _select_event(snapshot, req.event_id)
        affected = snapshot["road_segments"].get(event["affected_segment"])
        if not affected:
            raise ValueError(f"Affected segment {event['affected_segment']} not found")
        _, evidence_by_key = _build_evidence(snapshot, event, affected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    report = analyze_sensitivity(snapshot, event, evidence_by_key)
    return report.to_dict()


@router.get("/replay")
def list_decisions(event_id: Optional[str] = None, limit: int = 50):
    """列出歷史決策紀錄。"""
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
                "reliability": e.record.reliability.overall,
                "stored_at": e.stored_at,
            }
            for e in entries
        ],
    }


@router.get("/summary")
def ai_summary(timestamp: Optional[str] = None, event_id: Optional[str] = None):
    """用 Ollama 產生指揮官摘要。Ollama 沒連線就回退 deterministic。"""
    import json
    import os
    import urllib.request

    from reasoning.builder import build_decision_record

    OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:1.7b")

    try:
        record = build_decision_record(timestamp=timestamp, event_id=event_id or "TPE_2026_ACC_001")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Build context for LLM
    rec_route = next((r for r in record.route_candidates if r.status == "recommended"), None)
    context = (
        f"事件：{record.event.event_id}，{record.event.description}\n"
        f"交通分級：{record.classification.level} 級\n"
        f"受影響路段：{record.snapshot.affected_road.get('name')}，飽和度 {record.snapshot.affected_road.get('saturation_score')}\n"
        f"推薦道路：{rec_route.name if rec_route else '無'}（飽和度 {rec_route.current_saturation if rec_route else '-'}）\n"
        f"ETE：{record.ete.total_minutes} 分鐘（{record.ete.formula}）\n"
        f"可靠度：{record.reliability.overall:.0%}\n"
        f"排除道路：{', '.join(r.name + '(' + '、'.join(r.exclusion_reasons) + ')' for r in record.route_candidates if r.status == 'excluded')}\n"
    )

    deterministic_summary = record.explanation.summary

    # Try Ollama
    prompt = (
        "你是城市交通指揮中心的決策摘要員。根據以下結構化決策資料，"
        "為交通指揮官撰寫一段 100-150 字的繁體中文摘要。"
        "語氣專業簡潔，只能使用提供的數據，不得新增資訊。\n\n"
        f"決策資料：\n{context}\n\n"
        "請直接輸出摘要，不要加標題或前綴。"
    )

    try:
        # Check Ollama connectivity
        check = urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2)
        models = json.loads(check.read())
        base = OLLAMA_MODEL.split(":")[0]
        if not any(m["name"].startswith(base) for m in models.get("models", [])):
            return {"summary": deterministic_summary, "source": "deterministic", "reason": "model_not_found"}

        payload = json.dumps({
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "options": {"temperature": 0.3, "num_predict": 300},
        }).encode()

        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        ai_text = result.get("response", "").strip()

        if ai_text and len(ai_text) > 20:
            return {"summary": ai_text, "source": "ollama", "model": OLLAMA_MODEL}
        else:
            return {"summary": deterministic_summary, "source": "deterministic", "reason": "empty_response"}

    except Exception as e:
        return {"summary": deterministic_summary, "source": "deterministic", "reason": str(e)}


@router.get("/anomaly")
def detect_anomalies_endpoint(timestamp: Optional[str] = None):
    """偵測當前快照的資料異常。"""
    from data.snapshot import available_timestamps, get_snapshot
    from reasoning.anomaly import detect_anomalies

    ts = timestamp or available_timestamps()[-1]
    snapshot = get_snapshot(ts)

    # Build history from earlier timestamps
    all_ts = available_timestamps()
    current_idx = all_ts.index(ts) if ts in all_ts else len(all_ts) - 1
    history_segments = []
    for prev_ts in all_ts[max(0, current_idx - 5):current_idx]:
        prev_snap = get_snapshot(prev_ts)
        history_segments.append(prev_snap.get("road_segments", {}))

    alerts = detect_anomalies(snapshot, history_segments)
    return {
        "timestamp": ts,
        "anomaly_count": len(alerts),
        "alerts": [a.to_dict() for a in alerts],
    }


@router.get("/forecast")
def forecast_endpoint(timestamp: Optional[str] = None):
    """預測各路段未來 5/10/15 分鐘的飽和度。"""
    from data.snapshot import available_timestamps, get_snapshot
    from reasoning.forecast import forecast_congestion

    all_ts = available_timestamps()
    ts = timestamp or all_ts[-1]
    snapshot = get_snapshot(ts)
    current_segments = snapshot.get("road_segments", {})

    # Build history
    current_idx = all_ts.index(ts) if ts in all_ts else len(all_ts) - 1
    history_segments = []
    for prev_ts in all_ts[max(0, current_idx - 5):current_idx]:
        prev_snap = get_snapshot(prev_ts)
        history_segments.append(prev_snap.get("road_segments", {}))

    # Estimate interval between data points
    if current_idx >= 2:
        from datetime import datetime
        t1 = datetime.strptime(all_ts[current_idx - 1], "%Y-%m-%d %H:%M")
        t2 = datetime.strptime(all_ts[current_idx], "%Y-%m-%d %H:%M")
        interval = (t2 - t1).total_seconds() / 60.0
    else:
        interval = 15.0

    results = forecast_congestion(current_segments, history_segments, interval)
    approaching = [r for r in results if r.approaching_threshold]

    return {
        "timestamp": ts,
        "interval_minutes": interval,
        "total_segments": len(results),
        "approaching_threshold": len(approaching),
        "forecasts": [r.to_dict() for r in results],
        "warnings": [r._narrative() for r in approaching],
    }
