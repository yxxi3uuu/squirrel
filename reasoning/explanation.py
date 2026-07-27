"""Faithful natural-language explanations from verified decision facts."""

from __future__ import annotations

from typing import List

from reasoning.models import (
    DecisionExplanation,
    DecisionRecord,
    ExcludedRouteExplanation,
    RouteCandidate,
)


SYSTEM_PROMPT = """你是城市交通指揮中心的決策解釋員。
只能根據 verified_decision JSON 解釋已完成的程式計算，不得新增道路、SOP、數值或事件。
若資料不足，必須明確指出限制。輸出需符合 DecisionExplanation JSON schema。"""


def generate_deterministic_explanation(record: DecisionRecord) -> DecisionExplanation:
    event = record.event
    affected_name = str(record.snapshot.affected_road.get("name", event.affected_segment))
    recommended = _recommended_route(record.route_candidates)
    backups = [item for item in record.route_candidates if item.status == "backup"]
    excluded = [item for item in record.route_candidates if item.status == "excluded"]

    route_text = "尚無可採用替代道路"
    if recommended:
        route_text = recommended.name

    summary = (
        f"{record.classification.level} 級事件｜{affected_name} {event.status}，"
        f"建議改道 {route_text}，ETE {record.ete.total_minutes:.0f} 分鐘，"
        f"信心 {record.confidence.score:.0%}"
    )

    classification = (
        f"{affected_name} Saturation_Score={record.snapshot.affected_road.get('saturation_score')}，"
        f"依 SOP-1 門檻判定為 {record.classification.level} 級。"
    )

    recommended_explanation = "目前沒有替代道路可被列為主要方案，需人工接管。"
    if recommended:
        fallback_note = ""
        if "NOT_UPSTREAM" in recommended.exclusion_codes:
            fallback_note = "；此為 fallback，因上游候選方案風險更高，需人工確認"
        recommended_explanation = (
            f"建議 {recommended.name}：容量 {recommended.capacity_vph} vph、"
            f"目前飽和度 {recommended.current_saturation}、"
            f"導入 {recommended.predicted_inflow_vph:.0f} vph 後預測飽和度 "
            f"{recommended.predicted_saturation}，分數 {recommended.score}{fallback_note}。"
        )
        if backups:
            recommended_explanation += " 備援方案：" + "、".join(route.name for route in backups) + "。"

    excluded_explanations = [
        ExcludedRouteExplanation(
            segment_id=item.segment_id,
            name=item.name,
            reason="、".join(item.exclusion_reasons) or "分數較低",
            evidence_values=_route_evidence_values(item),
        )
        for item in excluded
    ]

    ete_explanation = (
        f"ETE 由程式依 SOP-7 計算：{record.ete.severity} 基礎時間 "
        f"{record.ete.base_minutes:.0f} 分鐘 + 壅塞修正 "
        f"{record.ete.congestion_adjustment_minutes:.0f} 分鐘 "
        f"(平均飽和度 {record.ete.average_saturation}) = "
        f"{record.ete.total_minutes:.0f} 分鐘。"
    )

    confidence = (
        f"決策信心 {record.confidence.score:.0%}（{record.confidence.label}）："
        + "；".join(record.confidence.explanation_items)
        + "。"
    )

    warnings: List[str] = list(record.data_quality.warnings)
    if recommended and recommended.exclusion_codes:
        warnings.append(
            f"主要方案 {recommended.name} 仍有風險代碼：{', '.join(recommended.exclusion_codes)}"
        )
    if not recommended:
        warnings.append("沒有乾淨可用的替代道路，需人工重新指定疏散方案")

    return DecisionExplanation(
        summary=summary,
        classification_explanation=classification,
        sop_citations=sorted({hit.sop_id for hit in record.rule_hits}),
        recommended_route_explanation=recommended_explanation,
        excluded_route_explanations=excluded_explanations,
        ete_explanation=ete_explanation,
        confidence_explanation=confidence,
        warnings=warnings,
    )


def answer_followup(record: DecisionRecord, question: str) -> str:
    text = question.strip()
    if "A" in text or "分級" in text or "級" in text:
        return record.explanation.classification_explanation
    if "ETE" in text.upper() or "恢復" in text or "多久" in text:
        return record.explanation.ete_explanation
    if "信心" in text or "可靠" in text:
        return record.explanation.confidence_explanation
    if "排除" in text or "為什麼不用" in text:
        if not record.explanation.excluded_route_explanations:
            return "目前沒有被排除的候選道路。"
        return "；".join(
            f"{item.name}：{item.reason}"
            for item in record.explanation.excluded_route_explanations
        )
    if "選" in text or "推薦" in text or "改道" in text:
        return record.explanation.recommended_route_explanation
    return record.explanation.summary


def _recommended_route(candidates: List[RouteCandidate]) -> RouteCandidate | None:
    for candidate in candidates:
        if candidate.status == "recommended":
            return candidate
    return None


def _route_evidence_values(candidate: RouteCandidate) -> List[str]:
    values = [
        f"capacity_vph={candidate.capacity_vph}",
        f"current_saturation={candidate.current_saturation}",
        f"predicted_saturation={candidate.predicted_saturation}",
    ]
    if candidate.lane_status:
        values.append(f"lane_status={candidate.lane_status}")
    return values
