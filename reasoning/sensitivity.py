"""Decision sensitivity analysis (設計文件 §17).

Proactively calculates how close the current decision is to flipping,
and reports the closest flip margins across multiple input dimensions.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Dict, List, Optional

from reasoning.models import RouteCandidate
from reasoning.rules import compare_candidate_routes


@dataclass
class SensitivityMargin:
    """How much a single input can change before the decision flips."""

    field: str
    segment_id: str
    segment_name: str
    current_value: float
    flip_value: Optional[float]
    margin: Optional[float]
    direction: str  # "increase" or "decrease"
    is_critical: bool  # margin < threshold

    def to_dict(self) -> dict:
        return {
            "field": self.field,
            "segment_id": self.segment_id,
            "segment_name": self.segment_name,
            "current_value": self.current_value,
            "flip_value": self.flip_value,
            "margin": round(self.margin, 4) if self.margin is not None else None,
            "direction": self.direction,
            "is_critical": self.is_critical,
            "narrative": self._narrative(),
        }

    def _narrative(self) -> str:
        if self.flip_value is None:
            return f"{self.segment_name} 的{_field_label(self.field)}在搜尋範圍內不會導致方案翻轉。"
        field_label = _field_label(self.field)
        dir_label = "增加" if self.direction == "increase" else "減少"
        critical_note = "⚠️ " if self.is_critical else ""
        return (
            f"{critical_note}{self.segment_name} 的{field_label}"
            f"{dir_label} {abs(self.margin):.4g} "
            f"（從 {self.current_value} → {self.flip_value}）"
            f"即會改變推薦方案。"
        )


@dataclass
class SensitivityReport:
    """Full sensitivity analysis result."""

    stability_score: float
    closest_flip: Optional[SensitivityMargin]
    margins: List[SensitivityMargin]
    perturbation_count: int
    flip_count: int

    def to_dict(self) -> dict:
        return {
            "stability_score": round(self.stability_score, 2),
            "stability_label": self._label(),
            "closest_flip": self.closest_flip.to_dict() if self.closest_flip else None,
            "margins": [m.to_dict() for m in self.margins],
            "perturbation_count": self.perturbation_count,
            "flip_count": self.flip_count,
            "summary": self._summary(),
        }

    def _label(self) -> str:
        if self.stability_score >= 0.8:
            return "穩定"
        if self.stability_score >= 0.5:
            return "中等"
        return "敏感"

    def _summary(self) -> str:
        if not self.closest_flip or self.closest_flip.flip_value is None:
            return f"決策穩定度 {self.stability_score:.0%}，在所有測試變動範圍內推薦方案不變。"
        return (
            f"決策穩定度 {self.stability_score:.0%}。"
            f"最近翻轉點：{self.closest_flip._narrative()}"
        )


def analyze_sensitivity(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
) -> SensitivityReport:
    """
    Run comprehensive sensitivity analysis.

    For the recommended route, test saturation ±0.01~0.30 and capacity ±5%~50%.
    Report how far each dimension is from causing a flip.
    """
    current_routes = compare_candidate_routes(snapshot, event, evidence_by_key)
    recommended = next((r for r in current_routes if r.status == "recommended"), None)
    if not recommended:
        return SensitivityReport(
            stability_score=0.0,
            closest_flip=None,
            margins=[],
            perturbation_count=0,
            flip_count=0,
        )

    segment_id = recommended.segment_id
    segment = snapshot.get("road_segments", {}).get(segment_id, {})
    margins: List[SensitivityMargin] = []
    total_perturbations = 0
    total_flips = 0

    # Test saturation increase on recommended route
    sat = segment.get("saturation_score")
    if sat is not None:
        flip_val = _find_flip_point(
            snapshot, event, evidence_by_key,
            segment_id, "saturation_score", float(sat),
            direction="increase", step=0.01, max_steps=50,
            recommended_id=recommended.segment_id,
        )
        margin = abs(flip_val - sat) if flip_val is not None else None
        margins.append(SensitivityMargin(
            field="saturation_score",
            segment_id=segment_id,
            segment_name=segment.get("name", segment_id),
            current_value=round(sat, 4),
            flip_value=round(flip_val, 4) if flip_val is not None else None,
            margin=margin,
            direction="increase",
            is_critical=margin is not None and margin < 0.10,
        ))
        total_perturbations += 50
        if flip_val is not None:
            total_flips += 1

    # Test capacity decrease on recommended route
    cap = segment.get("capacity_vph")
    if cap:
        flip_val = _find_flip_point(
            snapshot, event, evidence_by_key,
            segment_id, "capacity_vph", float(cap),
            direction="decrease", step=100, max_steps=30,
            recommended_id=recommended.segment_id,
        )
        margin = abs(flip_val - cap) if flip_val is not None else None
        margins.append(SensitivityMargin(
            field="capacity_vph",
            segment_id=segment_id,
            segment_name=segment.get("name", segment_id),
            current_value=float(cap),
            flip_value=flip_val,
            margin=margin,
            direction="decrease",
            is_critical=margin is not None and margin < 500,
        ))
        total_perturbations += 30
        if flip_val is not None:
            total_flips += 1

    # Test runner-up improvement
    runner_up = _get_runner_up(current_routes, recommended.segment_id)
    if runner_up:
        ru_segment = snapshot.get("road_segments", {}).get(runner_up.segment_id, {})
        ru_sat = ru_segment.get("saturation_score")
        if ru_sat is not None:
            flip_val = _find_flip_point(
                snapshot, event, evidence_by_key,
                runner_up.segment_id, "saturation_score", float(ru_sat),
                direction="decrease", step=0.01, max_steps=50,
                recommended_id=recommended.segment_id,
            )
            margin = abs(flip_val - ru_sat) if flip_val is not None else None
            margins.append(SensitivityMargin(
                field="saturation_score",
                segment_id=runner_up.segment_id,
                segment_name=ru_segment.get("name", runner_up.segment_id),
                current_value=round(ru_sat, 4),
                flip_value=round(flip_val, 4) if flip_val is not None else None,
                margin=margin,
                direction="decrease",
                is_critical=margin is not None and margin < 0.10,
            ))
            total_perturbations += 50
            if flip_val is not None:
                total_flips += 1

    # Compute stability from perturbation results
    stability = 1.0 - (total_flips / max(len(margins), 1)) * 0.3
    stability = max(0.0, min(1.0, stability))

    # Find closest flip
    valid_margins = [m for m in margins if m.margin is not None]
    closest = None
    if valid_margins:
        # Normalize margins for comparison (saturation margin vs capacity margin)
        closest = min(valid_margins, key=lambda m: _normalized_margin(m))

    return SensitivityReport(
        stability_score=stability,
        closest_flip=closest,
        margins=margins,
        perturbation_count=total_perturbations,
        flip_count=total_flips,
    )


def _find_flip_point(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
    segment_id: str,
    field: str,
    current_value: float,
    direction: str,
    step: float,
    max_steps: int,
    recommended_id: str,
) -> Optional[float]:
    """Binary-search style flip point finder."""
    sign = 1.0 if direction == "increase" else -1.0

    for i in range(1, max_steps + 1):
        new_value = current_value + sign * step * i

        if field == "saturation_score" and (new_value < 0 or new_value > 2.0):
            return None
        if field in ("capacity_vph", "vehicle_count") and new_value < 0:
            return None

        perturbed = copy.deepcopy(snapshot)
        seg = perturbed["road_segments"][segment_id]
        if field == "capacity_vph":
            seg[field] = int(new_value)
        else:
            seg[field] = round(new_value, 4)

        try:
            new_routes = compare_candidate_routes(perturbed, event, evidence_by_key)
            new_rec = next((r for r in new_routes if r.status == "recommended"), None)
            if new_rec and new_rec.segment_id != recommended_id:
                return new_value
        except Exception:
            pass

    return None


def _get_runner_up(routes: List[RouteCandidate], exclude_id: str) -> Optional[RouteCandidate]:
    candidates = [r for r in routes if r.segment_id != exclude_id and r.status != "excluded"]
    if not candidates:
        candidates = [r for r in routes if r.segment_id != exclude_id]
    return min(candidates, key=lambda r: r.score) if candidates else None


def _normalized_margin(margin: SensitivityMargin) -> float:
    """Normalize margin to a 0-1 scale for cross-field comparison."""
    if margin.margin is None:
        return float("inf")
    if margin.field == "saturation_score":
        return margin.margin / 1.0  # max range is ~1.0
    if margin.field == "capacity_vph":
        return margin.margin / 4000.0  # max capacity
    return margin.margin


def _field_label(field: str) -> str:
    labels = {
        "saturation_score": "飽和度",
        "capacity_vph": "容量",
        "vehicle_count": "車流量",
    }
    return labels.get(field, field)
