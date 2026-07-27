"""Counterfactual analysis: find the minimum change that flips the decision."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Dict, List, Optional

from reasoning.models import DecisionRecord, RouteCandidate
from reasoning.rules import compare_candidate_routes


@dataclass
class CounterfactualResult:
    """Result of a single counterfactual search."""

    original_route: str
    original_route_name: str
    new_route: str
    new_route_name: str
    changed_field: str
    changed_segment: str
    original_value: float
    switch_value: float
    minimum_change: float
    direction: str
    steps_taken: int

    def to_dict(self) -> dict:
        return {
            "original_route": self.original_route,
            "original_route_name": self.original_route_name,
            "new_route": self.new_route,
            "new_route_name": self.new_route_name,
            "changed_field": self.changed_field,
            "changed_segment": self.changed_segment,
            "original_value": self.original_value,
            "switch_value": self.switch_value,
            "minimum_change": round(self.minimum_change, 4),
            "direction": self.direction,
            "steps_taken": self.steps_taken,
            "narrative": self._narrative(),
        }

    def _narrative(self) -> str:
        field_labels = {
            "saturation_score": "飽和度",
            "capacity_vph": "容量 (vph)",
            "vehicle_count": "車流量",
        }
        field_label = field_labels.get(self.changed_field, self.changed_field)
        direction_label = "增加" if self.direction == "increase" else "減少"
        return (
            f"若 {self.changed_segment} 的{field_label}"
            f"由 {self.original_value} {direction_label}至 {self.switch_value}，"
            f"系統將改推薦 {self.new_route_name}（取代 {self.original_route_name}）。"
        )


def find_counterfactual(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
    target_segment: Optional[str] = None,
    target_field: str = "saturation_score",
    direction: str = "increase",
    step: float = 0.01,
    max_steps: int = 200,
) -> Optional[CounterfactualResult]:
    """
    Find the minimum perturbation to a single field that flips the recommended route.

    If target_segment is None, defaults to the current recommended route's segment.
    """
    # Get the current recommendation
    current_routes = compare_candidate_routes(snapshot, event, evidence_by_key)
    current_recommended = _get_recommended(current_routes)
    if current_recommended is None:
        return None

    # Default: perturb the recommended route itself
    segment_id = target_segment or current_recommended.segment_id
    road_segments = snapshot.get("road_segments", {})
    if segment_id not in road_segments:
        return None

    original_value = road_segments[segment_id].get(target_field)
    if original_value is None:
        return None

    original_value = float(original_value)
    sign = 1.0 if direction == "increase" else -1.0

    for i in range(1, max_steps + 1):
        perturbed_value = original_value + sign * step * i

        # Bounds check
        if target_field == "saturation_score" and (perturbed_value < 0 or perturbed_value > 2.0):
            break
        if target_field in ("capacity_vph", "vehicle_count") and perturbed_value < 0:
            break

        # Create perturbed snapshot
        perturbed_snapshot = _perturb_snapshot(snapshot, segment_id, target_field, perturbed_value)
        perturbed_routes = compare_candidate_routes(perturbed_snapshot, event, evidence_by_key)
        new_recommended = _get_recommended(perturbed_routes)

        if new_recommended and new_recommended.segment_id != current_recommended.segment_id:
            return CounterfactualResult(
                original_route=current_recommended.segment_id,
                original_route_name=current_recommended.name,
                new_route=new_recommended.segment_id,
                new_route_name=new_recommended.name,
                changed_field=target_field,
                changed_segment=segment_id,
                original_value=round(original_value, 4),
                switch_value=round(perturbed_value, 4),
                minimum_change=round(abs(perturbed_value - original_value), 4),
                direction=direction,
                steps_taken=i,
            )

    return None


def find_all_counterfactuals(
    snapshot: Dict,
    event: Dict,
    evidence_by_key: Dict[str, str],
) -> List[CounterfactualResult]:
    """
    Run counterfactual analysis on multiple fields and directions.

    Returns all discovered flip points sorted by minimum_change (easiest flip first).
    """
    current_routes = compare_candidate_routes(snapshot, event, evidence_by_key)
    recommended = _get_recommended(current_routes)
    if recommended is None:
        return []

    results: List[CounterfactualResult] = []

    # Try perturbing the recommended route's saturation upward
    cf = find_counterfactual(
        snapshot, event, evidence_by_key,
        target_segment=recommended.segment_id,
        target_field="saturation_score",
        direction="increase",
        step=0.01,
    )
    if cf:
        results.append(cf)

    # Try perturbing the recommended route's capacity downward
    cf = find_counterfactual(
        snapshot, event, evidence_by_key,
        target_segment=recommended.segment_id,
        target_field="capacity_vph",
        direction="decrease",
        step=100,
    )
    if cf:
        results.append(cf)

    # Try improving the runner-up's saturation (decrease)
    runner_up = _get_runner_up(current_routes, recommended.segment_id)
    if runner_up:
        cf = find_counterfactual(
            snapshot, event, evidence_by_key,
            target_segment=runner_up.segment_id,
            target_field="saturation_score",
            direction="decrease",
            step=0.01,
        )
        if cf:
            results.append(cf)

    results.sort(key=lambda r: r.minimum_change)
    return results


def _perturb_snapshot(
    snapshot: Dict,
    segment_id: str,
    field: str,
    value: float,
) -> Dict:
    """Create a deep copy of snapshot with one field changed."""
    perturbed = copy.deepcopy(snapshot)
    segment = perturbed["road_segments"][segment_id]

    if field == "capacity_vph":
        segment[field] = int(value)
    else:
        segment[field] = round(value, 4)

    return perturbed


def _get_recommended(routes: List[RouteCandidate]) -> Optional[RouteCandidate]:
    for route in routes:
        if route.status == "recommended":
            return route
    return None


def _get_runner_up(routes: List[RouteCandidate], exclude_id: str) -> Optional[RouteCandidate]:
    """Get the best non-recommended, non-excluded route (runner-up)."""
    candidates = [
        r for r in routes
        if r.segment_id != exclude_id and r.status != "excluded"
    ]
    if not candidates:
        # Fallback: get the second-ranked route regardless of status
        candidates = [r for r in routes if r.segment_id != exclude_id]
    if candidates:
        return min(candidates, key=lambda r: r.score)
    return None
