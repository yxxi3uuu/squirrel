"""Multi-dimensional decision reliability scoring (設計文件 §16).

Breaks single confidence into four independent axes:
- Data Reliability: completeness + freshness + consistency
- Rule Reliability: SOP hit clarity + no fallback/conflict
- Decision Stability: does recommended route hold under perturbation?
- Evidence Coverage: proportion of key claims backed by evidence
"""

from __future__ import annotations

import copy
from typing import Dict, List

from reasoning.models import (
    DataQuality,
    EvidenceRef,
    ReliabilityScore,
    RouteCandidate,
    RuleHit,
)


def calculate_reliability(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
    data_quality: DataQuality,
    rule_hits: List[RuleHit],
    route_candidates: List[RouteCandidate],
    evidence: List[EvidenceRef],
) -> ReliabilityScore:
    """Calculate four-dimensional reliability score."""
    data_rel = _data_reliability(data_quality, snapshot, event)
    rule_rel = _rule_reliability(rule_hits)
    stability = _decision_stability(snapshot, event, evidence_by_key, route_candidates)
    coverage = _evidence_coverage(evidence, rule_hits, route_candidates)

    overall = round(
        0.25 * data_rel + 0.25 * rule_rel + 0.30 * stability + 0.20 * coverage,
        2,
    )

    if overall >= 0.8:
        label = "high"
    elif overall >= 0.6:
        label = "medium"
    else:
        label = "low"

    warnings = _build_warnings(data_rel, rule_rel, stability, coverage, route_candidates)
    explanation_items = [
        f"資料可靠度 {data_rel:.0%}",
        f"規則可靠度 {rule_rel:.0%}",
        f"決策穩定度 {stability:.0%}",
        f"證據覆蓋率 {coverage:.0%}",
    ]

    return ReliabilityScore(
        overall=overall,
        label=label,
        data_reliability=round(data_rel, 2),
        rule_reliability=round(rule_rel, 2),
        decision_stability=round(stability, 2),
        evidence_coverage=round(coverage, 2),
        warnings=warnings,
        explanation_items=explanation_items,
    )


def _data_reliability(data_quality: DataQuality, snapshot: Dict, event: Dict) -> float:
    """Combine completeness, freshness, and consistency."""
    completeness = data_quality.completeness
    freshness = _freshness_score(data_quality.freshness_seconds)
    consistency = _consistency_check(snapshot, event)
    return 0.40 * completeness + 0.35 * freshness + 0.25 * consistency


def _rule_reliability(rule_hits: List[RuleHit]) -> float:
    """Check whether SOP rules matched clearly without UNKNOWN or conflicts."""
    if not rule_hits:
        return 0.5

    scores = []
    for hit in rule_hits:
        if hit.result == "UNKNOWN":
            scores.append(0.2)
        elif hit.result in ("TRIGGERED", "A", "B", "NORMAL"):
            scores.append(1.0)
        else:
            scores.append(0.7)

    return sum(scores) / len(scores)


def _decision_stability(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
    route_candidates: List[RouteCandidate],
) -> float:
    """
    Perturbation test: check if the recommendation holds under ±variations.

    Test saturation ±0.03, capacity ±5%, vehicle_count ±10%.
    """
    from reasoning.rules import compare_candidate_routes

    recommended = next((r for r in route_candidates if r.status == "recommended"), None)
    if not recommended:
        return 0.3

    roads = snapshot.get("road_segments", {})
    segment_id = recommended.segment_id
    segment = roads.get(segment_id, {})

    perturbations = []

    # Saturation perturbations
    sat = segment.get("saturation_score")
    if sat is not None:
        for delta in (-0.03, -0.02, -0.01, 0.01, 0.02, 0.03):
            new_val = max(0.0, min(2.0, sat + delta))
            perturbations.append((segment_id, "saturation_score", new_val))

    # Capacity perturbations (±5%, ±10%)
    cap = segment.get("capacity_vph")
    if cap:
        for factor in (0.90, 0.95, 1.05, 1.10):
            perturbations.append((segment_id, "capacity_vph", int(cap * factor)))

    # Vehicle count perturbations (±10%)
    vc = segment.get("vehicle_count")
    if vc:
        for factor in (0.90, 0.95, 1.05, 1.10):
            perturbations.append((segment_id, "vehicle_count", int(vc * factor)))

    if not perturbations:
        return 0.5

    unchanged = 0
    for seg_id, field, new_value in perturbations:
        perturbed = copy.deepcopy(snapshot)
        perturbed["road_segments"][seg_id][field] = new_value
        try:
            new_routes = compare_candidate_routes(perturbed, event, evidence_by_key)
            new_rec = next((r for r in new_routes if r.status == "recommended"), None)
            if new_rec and new_rec.segment_id == recommended.segment_id:
                unchanged += 1
        except Exception:
            pass

    return unchanged / len(perturbations)


def _evidence_coverage(
    evidence: List[EvidenceRef],
    rule_hits: List[RuleHit],
    route_candidates: List[RouteCandidate],
) -> float:
    """What fraction of key claims have evidence backing?"""
    # Key claims that need evidence:
    # 1. Classification has evidence
    # 2. Each route candidate has evidence
    # 3. Each rule hit has evidence
    total_claims = 0
    covered_claims = 0

    # Rule hits should have evidence_ids
    for hit in rule_hits:
        total_claims += 1
        if hit.evidence_ids:
            covered_claims += 1

    # Route candidates should have evidence_ids
    for route in route_candidates:
        total_claims += 1
        if route.evidence_ids:
            covered_claims += 1

    # Base evidence count (should have at least core fields)
    core_fields = {"saturation_score", "lane_status", "vehicle_count", "capacity_vph"}
    evidence_fields = {ev.field for ev in evidence}
    for field in core_fields:
        total_claims += 1
        if any(field.lower() in ef.lower() for ef in evidence_fields):
            covered_claims += 1

    return covered_claims / total_claims if total_claims > 0 else 0.5


def _consistency_check(snapshot: Dict, event: Dict) -> float:
    """Check whether data is internally consistent."""
    affected_id = event.get("affected_segment")
    segment = snapshot.get("road_segments", {}).get(affected_id, {})

    score = 1.0
    status = event.get("status")
    avg_speed = segment.get("avg_speed")
    lane_status = segment.get("lane_status")

    # If event says blocked/closed but speed is high → inconsistent
    if status in ("Closed", "Blocked") and avg_speed is not None and avg_speed > 30:
        score -= 0.4

    # If lane_status says Normal but saturation > 0.95 → suspicious
    sat = segment.get("saturation_score")
    if lane_status == "Normal" and sat is not None and sat > 0.95:
        score -= 0.3

    return max(0.0, score)


def _freshness_score(age_seconds: float) -> float:
    """Same as rules.py version for consistency."""
    if age_seconds <= 30:
        return 1.0
    if age_seconds <= 60:
        return 0.8
    if age_seconds <= 180:
        return 0.5
    if age_seconds <= 600:
        return 0.35
    return 0.2


def _build_warnings(
    data_rel: float,
    rule_rel: float,
    stability: float,
    coverage: float,
    route_candidates: List[RouteCandidate],
) -> List[str]:
    """Generate human-readable warnings based on reliability dimensions."""
    warnings = []

    if data_rel < 0.6:
        warnings.append("資料可靠度偏低，建議確認資料來源是否正常")

    if rule_rel < 0.8:
        warnings.append("部分 SOP 規則匹配不明確，可能需要人工判斷")

    if stability < 0.6:
        warnings.append("決策穩定度偏低：輸入數據微幅變動即可能導致推薦方案翻轉")

    if stability < 0.4:
        warnings.append("警告：前兩名候選道路成本極為接近，建議人工複核")

    if coverage < 0.8:
        warnings.append("部分決策依據缺少原始證據支撐")

    # Check route margin
    recommended = [r for r in route_candidates if r.status == "recommended"]
    others = [r for r in route_candidates if r.status != "excluded" and r.status != "recommended"]
    if recommended and others:
        gap = min(r.score for r in others) - recommended[0].score
        if gap < 0.05:
            warnings.append(f"首選與備援方案分數差距僅 {gap:.3f}，決策邊界模糊")

    return warnings
