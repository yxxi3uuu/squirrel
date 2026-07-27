"""Validation checks for decision records and generated explanations."""

from __future__ import annotations

import re
from typing import Dict, List

from reasoning.models import DecisionExplanation, DecisionRecord, ValidationIssue


ALLOWED_SOP_IDS = {f"SOP-{number}" for number in range(1, 8)}


def validate_decision_record(record: DecisionRecord, snapshot: Dict) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    road_ids = set(snapshot.get("road_segments", {}).keys())
    route_ids = {route.segment_id for route in record.route_candidates}

    for hit in record.rule_hits:
        if hit.sop_id not in ALLOWED_SOP_IDS:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="INVALID_SOP_ID",
                    message=f"{hit.sop_id} is not an allowed SOP id",
                )
            )

    for route in record.route_candidates:
        if route.segment_id not in road_ids:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="UNKNOWN_ROUTE",
                    message=f"{route.segment_id} is not present in road network",
                )
            )

    recommended = [route for route in record.route_candidates if route.status == "recommended"]
    if len(recommended) != 1:
        issues.append(
            ValidationIssue(
                severity="warning",
                code="RECOMMENDED_ROUTE_COUNT",
                message=f"Expected 1 recommended route, got {len(recommended)}",
            )
        )

    issues.extend(validate_explanation(record.explanation, record, route_ids))
    return issues


def validate_explanation(
    explanation: DecisionExplanation,
    record: DecisionRecord,
    route_ids: set[str] | None = None,
) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    route_ids = route_ids or {route.segment_id for route in record.route_candidates}

    for sop_id in explanation.sop_citations:
        if sop_id not in ALLOWED_SOP_IDS:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="EXPLANATION_INVALID_SOP",
                    message=f"Explanation cited unknown SOP id {sop_id}",
                )
            )

    for item in explanation.excluded_route_explanations:
        if item.segment_id not in route_ids:
            issues.append(
                ValidationIssue(
                    severity="error",
                    code="EXPLANATION_UNKNOWN_ROUTE",
                    message=f"Explanation referenced route {item.segment_id} not in candidates",
                )
            )

    if f"{record.ete.total_minutes:.0f}" not in explanation.ete_explanation:
        issues.append(
            ValidationIssue(
                severity="error",
                code="ETE_MISMATCH",
                message="ETE explanation does not include the program-calculated total minutes",
            )
        )

    allowed_numbers = _allowed_numeric_strings(record)
    for number in _numbers_in_text(_explanation_text(explanation)):
        if number not in allowed_numbers:
            issues.append(
                ValidationIssue(
                    severity="warning",
                    code="UNTRACED_NUMBER",
                    message=f"Number {number} appears in explanation without a direct structured value",
                )
            )
    return issues


def _explanation_text(explanation: DecisionExplanation) -> str:
    excluded = " ".join(
        " ".join([item.segment_id, item.name, item.reason, " ".join(item.evidence_values)])
        for item in explanation.excluded_route_explanations
    )
    return " ".join(
        [
            explanation.summary,
            explanation.classification_explanation,
            explanation.recommended_route_explanation,
            explanation.ete_explanation,
            explanation.confidence_explanation,
            excluded,
        ]
    )


def _numbers_in_text(text: str) -> List[str]:
    text = re.sub(r"\b(?:RD|BS|EV|SOP)_[A-Z_]*\d+\b", " ", text)
    text = re.sub(r"\bSOP-\d+\b", " ", text)
    return re.findall(r"(?<![A-Za-z_])\d+(?:\.\d+)?%?", text)


def _allowed_numeric_strings(record: DecisionRecord) -> set[str]:
    values = {
        record.ete.base_minutes,
        record.ete.average_saturation,
        record.ete.congestion_adjustment_minutes,
        record.ete.total_minutes,
        record.confidence.score,
        record.snapshot.affected_road.get("saturation_score"),
    }
    for route in record.route_candidates:
        values.update(
            {
                route.capacity_vph,
                route.current_saturation,
                route.predicted_inflow_vph,
                route.predicted_saturation,
                route.score,
            }
        )
    for value in record.confidence.components.values():
        values.add(value)
    values.update({0.85, 0.95, 1000})
    allowed = set()
    for value in values:
        if value is None:
            continue
        if isinstance(value, float):
            allowed.add(f"{value:.0f}")
            allowed.add(f"{value:.1f}")
            allowed.add(f"{value:.2f}")
            allowed.add(f"{value:.4f}".rstrip("0").rstrip("."))
            allowed.add(f"{value:.0%}")
        else:
            allowed.add(str(value))
    for number in range(1, 8):
        allowed.add(str(number))
    return allowed
