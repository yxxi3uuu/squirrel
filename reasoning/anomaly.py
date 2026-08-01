"""Anomaly detection for traffic data quality (Z-score + consistency checks).

Detects:
1. Statistical outliers: saturation/speed deviating > 2 std from segment history
2. Logical inconsistencies: blocked status but high speed, etc.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class AnomalyAlert:
    segment_id: str
    segment_name: str
    alert_type: str  # "statistical_outlier" | "logical_inconsistency"
    field: str
    current_value: float
    expected_range: str
    severity: str  # "warning" | "critical"
    description: str

    def to_dict(self) -> dict:
        return {
            "segment_id": self.segment_id,
            "segment_name": self.segment_name,
            "alert_type": self.alert_type,
            "field": self.field,
            "current_value": self.current_value,
            "expected_range": self.expected_range,
            "severity": self.severity,
            "description": self.description,
        }


def detect_anomalies(snapshot: Dict, history_snapshots: List[Dict]) -> List[AnomalyAlert]:
    """
    Run anomaly detection on current snapshot using historical data.

    Args:
        snapshot: current TrafficSnapshot dict
        history_snapshots: list of previous snapshot road_segments dicts
    """
    alerts: List[AnomalyAlert] = []
    road_segments = snapshot.get("road_segments", {})

    # 1. Statistical outlier detection (Z-score)
    if history_snapshots:
        alerts.extend(_detect_statistical_outliers(road_segments, history_snapshots))

    # 2. Logical inconsistency detection
    alerts.extend(_detect_inconsistencies(road_segments))

    return alerts


def _detect_statistical_outliers(
    current_segments: Dict,
    history: List[Dict],
) -> List[AnomalyAlert]:
    """Z-score based outlier detection per segment."""
    alerts = []
    THRESHOLD = 2.0  # standard deviations

    for seg_id, seg in current_segments.items():
        # Collect historical saturation values for this segment
        hist_values = []
        for h in history:
            h_seg = h.get(seg_id, {})
            sat = h_seg.get("saturation_score")
            if sat is not None:
                hist_values.append(sat)

        if len(hist_values) < 3:
            continue

        current_sat = seg.get("saturation_score")
        if current_sat is None:
            continue

        mean = sum(hist_values) / len(hist_values)
        variance = sum((v - mean) ** 2 for v in hist_values) / len(hist_values)
        std = variance ** 0.5

        if std < 0.01:
            continue

        z_score = abs(current_sat - mean) / std
        if z_score > THRESHOLD:
            direction = "高於" if current_sat > mean else "低於"
            alerts.append(AnomalyAlert(
                segment_id=seg_id,
                segment_name=seg.get("name", seg_id),
                alert_type="statistical_outlier",
                field="saturation_score",
                current_value=round(current_sat, 4),
                expected_range=f"{mean - THRESHOLD * std:.2f} ~ {mean + THRESHOLD * std:.2f}",
                severity="critical" if z_score > 3.0 else "warning",
                description=f"飽和度 {current_sat:.2f} {direction}歷史均值 {mean:.2f}（Z={z_score:.1f}）",
            ))

    return alerts


def _detect_inconsistencies(road_segments: Dict) -> List[AnomalyAlert]:
    """Detect logical contradictions in current data."""
    alerts = []
    BLOCKED_STATUSES = {"Blocked", "Gridlock", "Closed"}

    for seg_id, seg in road_segments.items():
        lane_status = seg.get("lane_status")
        avg_speed = seg.get("avg_speed")
        saturation = seg.get("saturation_score")
        name = seg.get("name", seg_id)

        # Inconsistency 1: Blocked but high speed
        if lane_status in BLOCKED_STATUSES and avg_speed is not None and avg_speed > 20:
            alerts.append(AnomalyAlert(
                segment_id=seg_id,
                segment_name=name,
                alert_type="logical_inconsistency",
                field="avg_speed vs lane_status",
                current_value=avg_speed,
                expected_range="0 ~ 10 km/h (given Blocked status)",
                severity="critical",
                description=f"車道狀態為 {lane_status} 但車速 {avg_speed} km/h，資料可能有誤",
            ))

        # Inconsistency 2: Normal status but saturation >= 0.95
        if lane_status == "Normal" and saturation is not None and saturation >= 0.95:
            alerts.append(AnomalyAlert(
                segment_id=seg_id,
                segment_name=name,
                alert_type="logical_inconsistency",
                field="saturation vs lane_status",
                current_value=round(saturation, 4),
                expected_range="< 0.85 (given Normal status)",
                severity="warning",
                description=f"車道狀態為 Normal 但飽和度 {saturation:.2f}，分級可能有延遲",
            ))

        # Inconsistency 3: Very high saturation but also high speed
        if saturation is not None and saturation >= 0.95 and avg_speed is not None and avg_speed > 40:
            alerts.append(AnomalyAlert(
                segment_id=seg_id,
                segment_name=name,
                alert_type="logical_inconsistency",
                field="saturation vs avg_speed",
                current_value=avg_speed,
                expected_range="< 20 km/h (given saturation >= 0.95)",
                severity="warning",
                description=f"飽和度 {saturation:.2f} 但車速 {avg_speed} km/h，數據可能不同步",
            ))

    return alerts
