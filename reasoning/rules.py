"""Deterministic rules and calculations for Module 4."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from reasoning.models import (
    ClassificationResult,
    ConfidenceScore,
    DataQuality,
    ETEResult,
    EvidenceRef,
    RouteCandidate,
    RuleHit,
)
from shared.lookup import normalize_name


SOP_VERSION = "emergency-sop-v1"
TRAFFIC_LEVEL_VERSION = "traffic-level-v1"
ROUTE_SCORE_VERSION = "route-score-v1"
ETE_VERSION = "ete-v1"
CONFIDENCE_VERSION = "confidence-v1"

BASE_CLEARANCE = {
    "Medium": 20.0,
    "High": 40.0,
    "Critical": 60.0,
}

EXCLUSION_REASONS = {
    "BLOCKED": "道路目前封閉或完全壅塞",
    "ACCIDENT_AFFECTED": "道路仍位於事故影響範圍",
    "INSUFFICIENT_CAPACITY": "道路容量不足 1000 vph",
    "PREDICTED_OVERLOAD": "預測分流後將超過容量",
    "NOT_DIRECTLY_CONNECTED": "不符合直接相交條件",
    "NOT_UPSTREAM": "不符合上游分流條件",
    "CURRENTLY_CRITICAL": "道路目前已達嚴重壅塞",
    "PEDESTRIAN_CONFLICT": "可能與主要疏散人流發生衝突",
    "STALE_DATA": "即時資料過期，暫不採用",
}

BLOCKED_STATUSES = {"Blocked", "Gridlock"}
CRITICAL_STATUSES = {"Critical", "Accident_Impact"}


def classify_traffic_level(
    segment_id: str,
    segment: Dict,
    evidence_ids: List[str],
) -> Tuple[RuleHit, ClassificationResult]:
    saturation = segment.get("saturation_score")
    if saturation is None:
        rule = RuleHit(
            sop_id="SOP-1",
            clause="第 1 條",
            title="交通擁塞級別判定",
            condition="Saturation_Score is missing",
            observed=None,
            threshold={"B": 0.85, "A": 0.95},
            result="UNKNOWN",
            evidence_ids=evidence_ids,
        )
        result = ClassificationResult(
            level="UNKNOWN",
            method="deterministic_rule",
            rule_version=TRAFFIC_LEVEL_VERSION,
            evidence_ids=evidence_ids,
        )
        return rule, result

    if saturation >= 0.95:
        condition = "Saturation_Score >= 0.95"
        level = "A"
        threshold: object = 0.95
    elif saturation >= 0.85:
        condition = "0.85 <= Saturation_Score < 0.95"
        level = "B"
        threshold = 0.85
    else:
        condition = "Saturation_Score < 0.85"
        level = "NORMAL"
        threshold = 0.85

    rule = RuleHit(
        sop_id="SOP-1",
        clause="第 1 條",
        title="交通擁塞級別判定",
        condition=condition,
        observed=round(float(saturation), 4),
        threshold=threshold,
        result=level,
        evidence_ids=evidence_ids,
    )
    result = ClassificationResult(
        level=level,
        method="deterministic_rule",
        rule_version=TRAFFIC_LEVEL_VERSION,
        evidence_ids=evidence_ids,
    )
    return rule, result


def calculate_ete(
    severity: str,
    affected_saturations: Iterable[float],
    evidence_ids: List[str],
) -> ETEResult:
    normalized = severity.strip().title()
    if normalized not in BASE_CLEARANCE:
        normalized = "Medium"

    saturations = list(affected_saturations)
    average_saturation = sum(saturations) / len(saturations) if saturations else 0.0
    base = BASE_CLEARANCE[normalized]
    adjustment = max(0.0, (average_saturation - 0.5) * 60.0)
    total = base + adjustment
    return ETEResult(
        severity=normalized,
        base_minutes=round(base, 2),
        average_saturation=round(average_saturation, 4),
        congestion_adjustment_minutes=round(adjustment, 2),
        total_minutes=round(total, 2),
        formula="base_clearance + max(0, (average_saturation - 0.5) * 60)",
        calculation_version=ETE_VERSION,
        evidence_ids=evidence_ids,
    )


def compare_candidate_routes(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
) -> List[RouteCandidate]:
    roads = snapshot.get("road_segments", {})
    affected_id = event["affected_segment"]
    affected = roads.get(affected_id, {})
    alternatives = affected.get("alternatives", [])
    affected_vehicle_count = affected.get("vehicle_count") or affected.get("capacity_vph") or 0
    predicted_inflow = round(float(affected_vehicle_count) * 0.50, 2)
    incident_intersection = _detect_incident_intersection(event, affected)

    candidates = []
    for segment_id in alternatives:
        candidate = roads.get(segment_id)
        if not candidate:
            continue
        exclusion_codes: List[str] = []
        evidence_ids = [
            evidence_by_key.get(f"road:{segment_id}:capacity"),
            evidence_by_key.get(f"road:{segment_id}:saturation"),
            evidence_by_key.get(f"road:{segment_id}:lane_status"),
        ]
        evidence_ids = [item for item in evidence_ids if item]

        saturation = candidate.get("saturation_score")
        capacity = int(candidate.get("capacity_vph") or 0)
        lane_status = candidate.get("lane_status")
        directly_connected = _is_directly_connected(affected, candidate)
        upstream_status = _upstream_status(affected, candidate, incident_intersection)
        predicted_saturation = _predicted_saturation(saturation, predicted_inflow, capacity)
        pedestrian_conflict = _has_pedestrian_conflict(snapshot, candidate)

        if lane_status in BLOCKED_STATUSES:
            exclusion_codes.append("BLOCKED")
        if segment_id == affected_id:
            exclusion_codes.append("ACCIDENT_AFFECTED")
        if capacity < 1000:
            exclusion_codes.append("INSUFFICIENT_CAPACITY")
        if not directly_connected:
            exclusion_codes.append("NOT_DIRECTLY_CONNECTED")
        if upstream_status == "downstream":
            exclusion_codes.append("NOT_UPSTREAM")
        if lane_status in CRITICAL_STATUSES or (saturation is not None and saturation >= 0.95):
            exclusion_codes.append("CURRENTLY_CRITICAL")
        if predicted_saturation is not None and predicted_saturation >= 1.0:
            exclusion_codes.append("PREDICTED_OVERLOAD")
        if pedestrian_conflict:
            exclusion_codes.append("PEDESTRIAN_CONFLICT")

        score = _route_score(
            saturation=saturation,
            predicted_saturation=predicted_saturation,
            capacity=capacity,
            directly_connected=directly_connected,
            upstream_status=upstream_status,
            exclusion_codes=exclusion_codes,
        )
        candidates.append(
            RouteCandidate(
                segment_id=segment_id,
                name=candidate.get("name", segment_id),
                capacity_vph=capacity,
                current_saturation=round(float(saturation), 4) if saturation is not None else None,
                lane_status=lane_status,
                is_designated_alternative=True,
                directly_connected=directly_connected,
                upstream_status=upstream_status,
                predicted_inflow_vph=predicted_inflow,
                predicted_saturation=predicted_saturation,
                pedestrian_conflict=pedestrian_conflict,
                score=score,
                rank=0,
                status="excluded",
                exclusion_codes=exclusion_codes,
                exclusion_reasons=[EXCLUSION_REASONS[code] for code in exclusion_codes],
                evidence_ids=evidence_ids,
            )
        )

    ranked = sorted(candidates, key=lambda item: item.score)
    for index, candidate in enumerate(ranked, start=1):
        candidate.rank = index

    _assign_route_statuses(ranked)
    return ranked


def calculate_data_quality(snapshot: Dict, event: Dict, evidence: List[EvidenceRef]) -> DataQuality:
    affected = snapshot.get("road_segments", {}).get(event["affected_segment"], {})
    required_fields = [
        "capacity_vph",
        "avg_speed",
        "vehicle_count",
        "saturation_score",
        "lane_status",
    ]
    missing = [field for field in required_fields if affected.get(field) in (None, "")]
    completeness = (len(required_fields) - len(missing)) / len(required_fields)
    freshness_seconds = max(0.0, (_parse_time(snapshot["timestamp"]) - _parse_time(event["timestamp"])).total_seconds())
    warnings = []
    if missing:
        warnings.append(f"受影響路段缺少欄位：{', '.join(missing)}")
    if freshness_seconds > 600:
        warnings.append("事故事件與目前快照相差超過 10 分鐘，需人工確認事件狀態是否仍有效")

    return DataQuality(
        completeness=round(completeness, 2),
        freshness_seconds=round(freshness_seconds, 2),
        missing_fields=missing,
        warnings=warnings,
    )


def calculate_confidence(
    data_quality: DataQuality,
    rule_hits: List[RuleHit],
    route_candidates: List[RouteCandidate],
) -> ConfidenceScore:
    completeness = data_quality.completeness
    freshness = _freshness_score(data_quality.freshness_seconds)
    rule_clarity = 1.0 if rule_hits and all(hit.result != "UNKNOWN" for hit in rule_hits) else 0.5
    margin = _margin_score(route_candidates)
    score = 0.30 * completeness + 0.25 * freshness + 0.25 * rule_clarity + 0.20 * margin
    rounded = round(score, 2)
    if rounded >= 0.8:
        label = "high"
    elif rounded >= 0.6:
        label = "medium"
    else:
        label = "low"
    items = [
        f"資料完整度 {completeness:.0%}",
        f"資料新鮮度分數 {freshness:.0%}",
        f"SOP 規則匹配清晰度 {rule_clarity:.0%}",
        f"候選方案分數差距分數 {margin:.0%}",
    ]
    return ConfidenceScore(
        score=rounded,
        label=label,
        components={
            "completeness": round(completeness, 2),
            "freshness": round(freshness, 2),
            "rule_clarity": round(rule_clarity, 2),
            "route_margin": round(margin, 2),
        },
        explanation_items=items,
    )


def build_rule_hit_for_incident(event: Dict, evidence_ids: List[str]) -> Optional[RuleHit]:
    if not str(event.get("affected_segment", "")).startswith("RD_"):
        return None
    status_ok = event.get("status") in {"Closed", "Blocked", "Restricted"}
    severity_ok = event.get("severity") in {"High", "Critical"}
    if not (status_ok and severity_ok):
        return None
    return RuleHit(
        sop_id="SOP-2",
        clause="第 2 條",
        title="車禍與路障應變",
        condition="status in {Closed, Blocked, Restricted} and severity in {High, Critical} and affected_segment startswith RD_",
        observed={
            "status": event.get("status"),
            "severity": event.get("severity"),
            "affected_segment": event.get("affected_segment"),
        },
        threshold={
            "status": ["Closed", "Blocked", "Restricted"],
            "severity": ["High", "Critical"],
            "segment_prefix": "RD_",
        },
        result="TRIGGERED",
        evidence_ids=evidence_ids,
    )


def _assign_route_statuses(candidates: List[RouteCandidate]) -> None:
    acceptable = [
        item
        for item in candidates
        if not set(item.exclusion_codes).intersection(
            {"BLOCKED", "INSUFFICIENT_CAPACITY", "CURRENTLY_CRITICAL", "PREDICTED_OVERLOAD", "PEDESTRIAN_CONFLICT"}
        )
    ]
    strict = [item for item in acceptable if item.directly_connected and item.upstream_status == "upstream"]
    direct_fallback = [item for item in acceptable if item.directly_connected]
    pool = strict or direct_fallback or acceptable
    if not pool and candidates:
        pool = [
            item
            for item in candidates
            if "BLOCKED" not in item.exclusion_codes and "INSUFFICIENT_CAPACITY" not in item.exclusion_codes
        ] or candidates

    if pool:
        selected = min(pool, key=lambda item: item.score)
        selected.status = "recommended"
        for item in candidates:
            if item is selected:
                continue
            severe = {"BLOCKED", "INSUFFICIENT_CAPACITY", "CURRENTLY_CRITICAL", "PREDICTED_OVERLOAD"}
            if not severe.intersection(item.exclusion_codes) and item.directly_connected:
                item.status = "backup"


def _route_score(
    saturation: Optional[float],
    predicted_saturation: Optional[float],
    capacity: int,
    directly_connected: bool,
    upstream_status: str,
    exclusion_codes: List[str],
) -> float:
    sat = saturation if saturation is not None else 1.0
    predicted = predicted_saturation if predicted_saturation is not None else 1.2
    capacity_score = 1.0 - min(capacity, 4000) / 4000
    score = 0.45 * predicted + 0.25 * sat + 0.15 * capacity_score
    if not directly_connected:
        score += 0.20
    if upstream_status == "downstream":
        score += 0.08
    if upstream_status == "unknown":
        score += 0.03
    score += 0.12 * len(set(exclusion_codes).intersection({"BLOCKED", "CURRENTLY_CRITICAL", "PREDICTED_OVERLOAD"}))
    score += 0.08 * len(set(exclusion_codes).intersection({"INSUFFICIENT_CAPACITY", "PEDESTRIAN_CONFLICT"}))
    return round(score, 4)


def _predicted_saturation(
    current_saturation: Optional[float],
    predicted_inflow: float,
    capacity: int,
) -> Optional[float]:
    if current_saturation is None or capacity <= 0:
        return None
    return round(float(current_saturation) + predicted_inflow / capacity, 4)


def _is_directly_connected(affected: Dict, candidate: Dict) -> bool:
    affected_intersections = {normalize_name(name) for name in affected.get("intersections", [])}
    candidate_intersections = {normalize_name(name) for name in candidate.get("intersections", [])}
    affected_name = normalize_name(affected.get("name", ""))
    candidate_name = normalize_name(candidate.get("name", ""))
    return candidate_name in affected_intersections or affected_name in candidate_intersections


def _upstream_status(affected: Dict, candidate: Dict, incident_intersection: Optional[str]) -> str:
    if not _is_directly_connected(affected, candidate):
        return "not_connected"
    intersections = affected.get("intersections", [])
    if not incident_intersection:
        return "unknown"
    candidate_name = normalize_name(candidate.get("name", ""))
    incident_name = normalize_name(incident_intersection)
    candidate_index = _find_intersection_index(intersections, candidate_name)
    incident_index = _find_intersection_index(intersections, incident_name)
    if candidate_index is None or incident_index is None:
        return "unknown"
    return "upstream" if candidate_index <= incident_index else "downstream"


def _find_intersection_index(intersections: List[str], normalized_name: str) -> Optional[int]:
    for index, name in enumerate(intersections):
        if normalize_name(name) == normalized_name:
            return index
    return None


def _detect_incident_intersection(event: Dict, affected: Dict) -> Optional[str]:
    text = normalize_name(" ".join(str(event.get(field, "")) for field in ("location", "description")))
    for intersection in affected.get("intersections", []):
        normalized = normalize_name(intersection)
        loose = _loose_road_name(normalized)
        if normalized and (normalized in text or (loose and loose in text)):
            return intersection
    return None


def _loose_road_name(value: str) -> str:
    for token in ("一段", "二段", "三段", "四段", "五段", "六段", "七段", "八段", "九段", "十段"):
        value = value.replace(token, "")
    return value.replace("路口", "")


def _has_pedestrian_conflict(snapshot: Dict, candidate: Dict) -> bool:
    for station_id in candidate.get("nearby_stations", []):
        station = snapshot.get("stations", {}).get(station_id, {})
        if station.get("user_count", 0) >= 30000:
            return True
    return False


def _parse_time(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M")


def _freshness_score(age_seconds: float) -> float:
    if age_seconds <= 30:
        return 1.0
    if age_seconds <= 60:
        return 0.8
    if age_seconds <= 180:
        return 0.5
    if age_seconds <= 600:
        return 0.35
    return 0.2


def _margin_score(candidates: List[RouteCandidate]) -> float:
    if len(candidates) < 2:
        return 0.5
    ranked = sorted(candidates, key=lambda item: item.score)
    gap = max(0.0, ranked[1].score - ranked[0].score)
    return round(min(1.0, gap / 0.30), 2)


# ═══════════════════════════════════════════════════════════
# SOP-5: 號誌故障應變
# ═══════════════════════════════════════════════════════════

def build_rule_hit_for_signal_failure(event: Dict, evidence_ids: List[str]) -> Optional[RuleHit]:
    """SOP-5: type=Power_Failure 或描述含號誌故障/號誌失效。"""
    event_type = event.get("type", "")
    description = event.get("description", "")
    is_signal = (
        event_type == "Power_Failure"
        or "號誌故障" in description
        or "號誌失效" in description
    )
    if not is_signal:
        return None
    return RuleHit(
        sop_id="SOP-5",
        clause="第 5 條",
        title="號誌故障人工交管",
        condition="type=Power_Failure 或描述含「號誌故障/號誌失效」",
        observed={"type": event_type, "description_excerpt": description[:60]},
        threshold={"type": "Power_Failure", "keywords": ["號誌故障", "號誌失效"]},
        result="TRIGGERED",
        evidence_ids=evidence_ids,
    )


# ═══════════════════════════════════════════════════════════
# SOP-3: 捷運與接駁分流
# ═══════════════════════════════════════════════════════════

def build_rule_hit_for_crowd_diversion(snapshot: Dict, evidence_ids: List[str]) -> Optional[RuleHit]:
    """SOP-3: BS_MRT_BL17 Growth_Rate > 0.30 或 User_Count > 25000。"""
    stations = snapshot.get("stations", {})
    bl17 = stations.get("BS_MRT_BL17", {})
    user_count = bl17.get("user_count", 0)
    growth_rate = bl17.get("growth_rate", 0)

    triggered = user_count > 25000 or growth_rate > 0.30
    if not triggered:
        return None

    condition_parts = []
    if user_count > 25000:
        condition_parts.append(f"User_Count={user_count:,} > 25,000")
    if growth_rate > 0.30:
        condition_parts.append(f"Growth_Rate={growth_rate:.2f} > 0.30")

    return RuleHit(
        sop_id="SOP-3",
        clause="第 3 條",
        title="捷運與接駁分流",
        condition=" 且 ".join(condition_parts) if len(condition_parts) > 1 else condition_parts[0],
        observed={"station": "BS_MRT_BL17", "user_count": user_count, "growth_rate": growth_rate},
        threshold={"user_count": 25000, "growth_rate": 0.30},
        result="TRIGGERED",
        evidence_ids=evidence_ids,
    )


# ═══════════════════════════════════════════════════════════
# SOP-4: 大巨蛋散場啟動
# ═══════════════════════════════════════════════════════════

def build_rule_hit_for_dome_dispersal(snapshot: Dict, evidence_ids: List[str]) -> Optional[RuleHit]:
    """SOP-4: BS_TPE_DOME 峰值曾 >= 30000 且當前 Growth_Rate <= -0.20。"""
    stations = snapshot.get("stations", {})
    dome = stations.get("BS_TPE_DOME", {})
    user_count = dome.get("user_count", 0)
    growth_rate = dome.get("growth_rate", 0)
    peak = dome.get("peak_user_count", 0)

    triggered = peak >= 30000 and growth_rate <= -0.20
    if not triggered:
        return None

    return RuleHit(
        sop_id="SOP-4",
        clause="第 4 條",
        title="大巨蛋散場啟動",
        condition=f"峰值人數={peak:,} >= 30,000 且 Growth_Rate={growth_rate:.2f} <= -0.20",
        observed={"station": "BS_TPE_DOME", "peak": peak, "current_count": user_count, "growth_rate": growth_rate},
        threshold={"peak_user_count": 30000, "growth_rate": -0.20},
        result="TRIGGERED",
        evidence_ids=evidence_ids,
    )
