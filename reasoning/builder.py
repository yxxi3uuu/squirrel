"""Decision fact builder for Module 4."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Dict, List, Optional

from data.snapshot import get_snapshot
from reasoning.explanation import generate_deterministic_explanation
from reasoning.models import (
    DecisionEvent,
    DecisionRecord,
    EvidenceRef,
    EvidenceStep,
    SnapshotSummary,
)
from reasoning.rules import (
    ETE_VERSION,
    ROUTE_SCORE_VERSION,
    SOP_VERSION,
    build_rule_hit_for_incident,
    build_rule_hit_for_signal_failure,
    build_rule_hit_for_crowd_diversion,
    build_rule_hit_for_dome_dispersal,
    calculate_confidence,
    calculate_data_quality,
    calculate_ete,
    classify_traffic_level,
    compare_candidate_routes,
)
from reasoning.reliability import calculate_reliability
from reasoning.replay import replay_store
from reasoning.validator import validate_decision_record


MODEL_VERSION = f"module4-local-deterministic/{ROUTE_SCORE_VERSION}/{ETE_VERSION}"


def build_decision_record(
    timestamp: Optional[str] = None,
    event_id: Optional[str] = None,
) -> DecisionRecord:
    start = time.perf_counter()
    snapshot = get_snapshot(timestamp)
    event = _select_event(snapshot, event_id)
    affected = snapshot["road_segments"].get(event["affected_segment"])
    if not affected:
        raise ValueError(f"Affected segment {event['affected_segment']} not found in snapshot road_segments")

    evidence, evidence_by_key = _build_evidence(snapshot, event, affected)
    classification_rule, classification = classify_traffic_level(
        event["affected_segment"],
        affected,
        [
            evidence_by_key["affected:saturation"],
            evidence_by_key["affected:lane_status"],
        ],
    )
    rule_hits = [classification_rule]
    incident_rule = build_rule_hit_for_incident(
        event,
        [
            evidence_by_key["event:status"],
            evidence_by_key["event:severity"],
            evidence_by_key["event:affected_segment"],
        ],
    )
    if incident_rule:
        rule_hits.append(incident_rule)

    # SOP-5: 號誌故障
    signal_rule = build_rule_hit_for_signal_failure(
        event,
        [evidence_by_key["event:status"], evidence_by_key["event:severity"]],
    )
    if signal_rule:
        rule_hits.append(signal_rule)

    # SOP-3: 捷運分流
    crowd_rule = build_rule_hit_for_crowd_diversion(snapshot, [])
    if crowd_rule:
        rule_hits.append(crowd_rule)

    # SOP-4: 大巨蛋散場
    dome_rule = build_rule_hit_for_dome_dispersal(snapshot, [])
    if dome_rule:
        rule_hits.append(dome_rule)

    ete = calculate_ete(
        event["severity"],
        [float(affected["saturation_score"])] if affected.get("saturation_score") is not None else [],
        [evidence_by_key["event:severity"], evidence_by_key["affected:saturation"]],
    )
    routes = compare_candidate_routes(snapshot, event, evidence_by_key)
    data_quality = calculate_data_quality(snapshot, event, evidence)
    confidence = calculate_confidence(data_quality, rule_hits, routes)
    reliability = calculate_reliability(
        snapshot, event, evidence_by_key,
        data_quality, rule_hits, routes, evidence,
    )
    snapshot_summary = SnapshotSummary(
        timestamp=snapshot["timestamp"],
        source_versions={
            "traffic": f"city_traffic_flow@{snapshot['timestamp']}",
            "road_network": "road-network-v1",
            "incidents": "live-incidents-v1",
            "sop": SOP_VERSION,
        },
        affected_road={
            "segment_id": event["affected_segment"],
            "name": affected.get("name"),
            "saturation_score": affected.get("saturation_score"),
            "avg_speed": affected.get("avg_speed"),
            "vehicle_count": affected.get("vehicle_count"),
            "capacity_vph": affected.get("capacity_vph"),
            "lane_status": affected.get("lane_status"),
        },
    )
    event_model = DecisionEvent(**event)
    created_at = datetime.now().astimezone().isoformat(timespec="seconds")
    record = DecisionRecord(
        decision_id=_decision_id(snapshot["timestamp"], event["event_id"]),
        created_at=created_at,
        event=event_model,
        snapshot=snapshot_summary,
        evidence=evidence,
        rule_hits=rule_hits,
        classification=classification,
        ete=ete,
        route_candidates=routes,
        data_quality=data_quality,
        confidence=confidence,
        reliability=reliability,
        evidence_chain=_build_evidence_chain(classification.level, routes, ete.total_minutes),
        explanation=_empty_explanation(),
        validation_issues=[],
        execution_time_ms=0.0,
        model_version=MODEL_VERSION,
    )
    record.explanation = generate_deterministic_explanation(record)
    record.validation_issues = validate_decision_record(record, snapshot)
    record.execution_time_ms = round((time.perf_counter() - start) * 1000, 2)
    replay_store.save(record)
    return record


def _select_event(snapshot: Dict, event_id: Optional[str]) -> Dict:
    incidents = snapshot.get("incidents", [])
    if event_id:
        for incident in incidents:
            if incident.get("event_id") == event_id:
                return incident
        raise ValueError(f"Event {event_id!r} is not available at snapshot {snapshot['timestamp']}")
    road_incidents = [
        incident
        for incident in incidents
        if str(incident.get("affected_segment", "")).startswith("RD_")
        and incident.get("severity") in {"High", "Critical"}
    ]
    if road_incidents:
        return road_incidents[-1]
    if incidents:
        return incidents[-1]
    raise ValueError(f"No incident is available at snapshot {snapshot['timestamp']}")


def _build_evidence(
    snapshot: Dict,
    event: Dict,
    affected: Dict,
) -> tuple[List[EvidenceRef], Dict[str, str]]:
    evidence: List[EvidenceRef] = []
    index: Dict[str, str] = {}

    def add(key: str, source: str, field: str, value: object, description: str) -> None:
        evidence_id = f"EV-{len(evidence) + 1:03d}"
        index[key] = evidence_id
        evidence.append(
            EvidenceRef(
                evidence_id=evidence_id,
                source=source,
                field=field,
                value=value,
                description=description,
            )
        )

    add("event:status", "live_incidents.json", "status", event.get("status"), "事故狀態")
    add("event:severity", "live_incidents.json", "severity", event.get("severity"), "事故嚴重度")
    add(
        "event:affected_segment",
        "live_incidents.json",
        "affected_segment",
        event.get("affected_segment"),
        "受影響路段 ID",
    )
    add(
        "affected:saturation",
        "city_traffic_flow.csv",
        "Saturation_Score",
        affected.get("saturation_score"),
        "受影響路段飽和度",
    )
    add(
        "affected:lane_status",
        "city_traffic_flow.csv",
        "Lane_Status",
        affected.get("lane_status"),
        "受影響路段車道狀態",
    )
    add(
        "affected:vehicle_count",
        "city_traffic_flow.csv",
        "Vehicle_Count",
        affected.get("vehicle_count"),
        "受影響路段車流量",
    )
    add(
        "affected:capacity",
        "road_network_geometry.json",
        "capacity_vph",
        affected.get("capacity_vph"),
        "受影響路段容量",
    )

    for segment_id in affected.get("alternatives", []):
        road = snapshot.get("road_segments", {}).get(segment_id, {})
        add(
            f"road:{segment_id}:capacity",
            "road_network_geometry.json",
            f"{segment_id}.capacity_vph",
            road.get("capacity_vph"),
            f"{road.get('name', segment_id)} 容量",
        )
        add(
            f"road:{segment_id}:saturation",
            "city_traffic_flow.csv",
            f"{segment_id}.Saturation_Score",
            road.get("saturation_score"),
            f"{road.get('name', segment_id)} 飽和度",
        )
        add(
            f"road:{segment_id}:lane_status",
            "city_traffic_flow.csv",
            f"{segment_id}.Lane_Status",
            road.get("lane_status"),
            f"{road.get('name', segment_id)} 車道狀態",
        )

    return evidence, index


def _build_evidence_chain(level: str, routes, ete_minutes: float) -> List[EvidenceStep]:
    recommended = next((route for route in routes if route.status == "recommended"), None)
    route_text = recommended.name if recommended else "無可用替代道路"
    return [
        EvidenceStep(order=1, title="偵測事件", detail="讀取 live_incidents.json 中已發生事件", evidence_ids=["EV-001", "EV-002", "EV-003"]),
        EvidenceStep(order=2, title="讀取即時數據", detail="擷取受影響路段車流、容量、車道狀態", evidence_ids=["EV-004", "EV-005", "EV-006", "EV-007"]),
        EvidenceStep(order=3, title="命中 SOP", detail=f"依 SOP-1 判定交通等級為 {level}", evidence_ids=["EV-004"]),
        EvidenceStep(order=4, title="比較候選方案", detail=f"候選道路依容量、飽和度、連通性與預測分流後飽和度排序，主要方案為 {route_text}", evidence_ids=[]),
        EvidenceStep(order=5, title="計算恢復時間", detail=f"依 SOP-7 公式計算 ETE={ete_minutes:.0f} 分鐘", evidence_ids=["EV-002", "EV-004"]),
        EvidenceStep(order=6, title="產生可解釋輸出", detail="輸出結構化解釋、排除理由、信心與限制", evidence_ids=[]),
    ]


def _decision_id(timestamp: str, event_id: str) -> str:
    compact_ts = timestamp.replace("-", "").replace(":", "").replace(" ", "T")
    return f"DEC-{compact_ts}-{event_id}"


def _empty_explanation():
    from reasoning.models import DecisionExplanation

    return DecisionExplanation(
        summary="",
        classification_explanation="",
        sop_citations=[],
        recommended_route_explanation="",
        excluded_route_explanations=[],
        ete_explanation="",
        confidence_explanation="",
        warnings=[],
    )
