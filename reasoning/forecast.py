"""Simple congestion forecasting using linear regression on recent history.

Predicts saturation_score for each segment 5/10/15 minutes into the future
based on the trend from the last N data points.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class ForecastResult:
    segment_id: str
    segment_name: str
    current_saturation: float
    forecast_5min: float
    forecast_10min: float
    forecast_15min: float
    trend: str  # "rising" | "stable" | "falling"
    approaching_threshold: Optional[str]  # "A" | "B" | None

    def to_dict(self) -> dict:
        return {
            "segment_id": self.segment_id,
            "segment_name": self.segment_name,
            "current_saturation": round(self.current_saturation, 4),
            "forecast_5min": round(self.forecast_5min, 4),
            "forecast_10min": round(self.forecast_10min, 4),
            "forecast_15min": round(self.forecast_15min, 4),
            "trend": self.trend,
            "approaching_threshold": self.approaching_threshold,
            "narrative": self._narrative(),
        }

    def _narrative(self) -> str:
        if self.approaching_threshold == "A":
            return f"{self.segment_name} 預計 {self._when_threshold(0.95)} 將達 A 級門檻（0.95）"
        if self.approaching_threshold == "B":
            return f"{self.segment_name} 預計 {self._when_threshold(0.85)} 將達 B 級門檻（0.85）"
        if self.trend == "rising":
            return f"{self.segment_name} 飽和度呈上升趨勢（{self.current_saturation:.2f} → {self.forecast_15min:.2f}）"
        if self.trend == "falling":
            return f"{self.segment_name} 飽和度呈下降趨勢（{self.current_saturation:.2f} → {self.forecast_15min:.2f}）"
        return f"{self.segment_name} 飽和度穩定（{self.current_saturation:.2f}）"

    def _when_threshold(self, threshold: float) -> str:
        if self.forecast_5min >= threshold:
            return "5 分鐘內"
        if self.forecast_10min >= threshold:
            return "10 分鐘內"
        return "15 分鐘內"


def forecast_congestion(
    current_segments: Dict,
    history_segments: List[Dict],
    interval_minutes: float = 15.0,
) -> List[ForecastResult]:
    """
    Predict future saturation for each segment using simple linear regression.

    Args:
        current_segments: current snapshot road_segments dict
        history_segments: list of previous road_segments dicts (oldest first)
        interval_minutes: average minutes between data points
    """
    results = []

    for seg_id, seg in current_segments.items():
        current_sat = seg.get("saturation_score")
        if current_sat is None:
            continue

        # Collect historical values (oldest first) + current
        values = []
        for h in history_segments:
            h_seg = h.get(seg_id, {})
            sat = h_seg.get("saturation_score")
            if sat is not None:
                values.append(sat)
        values.append(current_sat)

        if len(values) < 2:
            continue

        # Simple linear regression: y = slope * x + intercept
        slope = _calculate_slope(values)

        # Predict future (in units of data intervals)
        steps_5min = 5.0 / max(interval_minutes, 1.0)
        steps_10min = 10.0 / max(interval_minutes, 1.0)
        steps_15min = 15.0 / max(interval_minutes, 1.0)

        forecast_5 = _clamp(current_sat + slope * steps_5min)
        forecast_10 = _clamp(current_sat + slope * steps_10min)
        forecast_15 = _clamp(current_sat + slope * steps_15min)

        # Determine trend
        if slope > 0.005:
            trend = "rising"
        elif slope < -0.005:
            trend = "falling"
        else:
            trend = "stable"

        # Check if approaching threshold
        approaching = None
        if current_sat < 0.95 and forecast_15 >= 0.95:
            approaching = "A"
        elif current_sat < 0.85 and forecast_15 >= 0.85:
            approaching = "B"

        results.append(ForecastResult(
            segment_id=seg_id,
            segment_name=seg.get("name", seg_id),
            current_saturation=current_sat,
            forecast_5min=forecast_5,
            forecast_10min=forecast_10,
            forecast_15min=forecast_15,
            trend=trend,
            approaching_threshold=approaching,
        ))

    # Sort: segments approaching thresholds first, then by forecast_15min descending
    results.sort(key=lambda r: (
        0 if r.approaching_threshold == "A" else 1 if r.approaching_threshold == "B" else 2,
        -r.forecast_15min,
    ))

    return results


def _calculate_slope(values: List[float]) -> float:
    """Simple least-squares slope calculation."""
    n = len(values)
    if n < 2:
        return 0.0
    # Use last 5 points max for recent trend
    recent = values[-5:]
    n = len(recent)
    x_mean = (n - 1) / 2.0
    y_mean = sum(recent) / n

    numerator = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent))
    denominator = sum((i - x_mean) ** 2 for i in range(n))

    if denominator == 0:
        return 0.0
    return numerator / denominator


def _clamp(value: float) -> float:
    """Clamp saturation between 0 and 1.5 (allow slight overshoot for prediction)."""
    return max(0.0, min(1.5, value))
