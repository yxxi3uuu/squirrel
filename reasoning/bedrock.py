"""Amazon Bedrock integration for explanation generation and review.

This module provides:
- ExplanationService: generates natural language explanations from DecisionRecord
- ReviewerService: identifies risks and concerns
- Fallback: returns deterministic explanation if Bedrock fails or hallucinates

Requires: BEDROCK_ENABLED=true, AWS credentials configured, BEDROCK_MODEL_ID set.
"""

from __future__ import annotations

import json
import os
from typing import Optional

from reasoning.models import DecisionExplanation, DecisionRecord


BEDROCK_ENABLED = os.getenv("BEDROCK_ENABLED", "false").lower() == "true" or os.getenv("LLM_MODE", "").lower() == "bedrock"
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
AWS_REGION = os.getenv("AWS_REGION", os.getenv("BEDROCK_REGION", "us-west-2"))

EXPLAINER_SYSTEM_PROMPT = """你是城市交通指揮中心的決策解釋員。

你不能重新做決策。你只能根據 verified_decision JSON 解釋已完成的程式計算結果。

規則：
1. 不得新增不存在的道路、事件、SOP 或數值。
2. 不得自行修改或重算數值。
3. 每個 claim 必須能追溯到 evidence。
4. 資料不足時必須說明，不得猜測。
5. 將確定結果與風險推測分開。
6. 使用繁體中文回應。
7. 語氣專業但易讀，適合交通指揮官閱讀。"""

REVIEWER_SYSTEM_PROMPT = """你是交通決策的安全審查員。

你的任務是檢查已生成的決策建議是否有潛在風險。
只根據提供的 verified_decision JSON 判斷，不得自行假設或新增資訊。

檢查項目：
1. 推薦道路是否可能導向高風險區域
2. 是否有人流衝突風險（鄰近捷運站人流 > 30000）
3. 資料是否過期（freshness > 600s）
4. 前兩名方案分數是否過於接近
5. 是否有必要的人工確認事項

輸出格式：
- risk_level: low / medium / high
- findings: 風險列表
- recommendations: 建議操作
- requires_human_review: true/false"""


class BedrockClient:
    """Thin wrapper around Bedrock Runtime Converse API."""

    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import boto3
            self._client = boto3.client(
                "bedrock-runtime",
                region_name=AWS_REGION,
            )
        return self._client

    def converse(self, system_prompt: str, user_message: str, max_tokens: int = 2000) -> Optional[str]:
        """Call Bedrock Converse API. Returns text or None on failure."""
        try:
            response = self.client.converse(
                modelId=BEDROCK_MODEL_ID,
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": user_message}],
                    }
                ],
                system=[{"text": system_prompt}],
                inferenceConfig={
                    "maxTokens": max_tokens,
                    "temperature": 0.1,
                },
            )
            output = response.get("output", {})
            message = output.get("message", {})
            content = message.get("content", [])
            if content and content[0].get("text"):
                return content[0]["text"]
            return None
        except Exception as e:
            print(f"[Bedrock] Error: {e}")
            return None


_bedrock = BedrockClient()


def generate_bedrock_explanation(record: DecisionRecord) -> Optional[str]:
    """Generate natural language explanation via Bedrock.

    Returns the raw text explanation, or None if Bedrock is disabled/fails.
    """
    if not BEDROCK_ENABLED:
        return None

    decision_json = _build_explanation_context(record)
    user_message = (
        "以下是程式產生的決策記錄 JSON。\n"
        "請用專業但易讀的繁體中文，為交通指揮官撰寫一段 200-400 字的決策摘要，\n"
        "涵蓋：事件狀況、交通分級理由、推薦道路及原因、ETE 計算、信心分數、主要限制。\n"
        "不得新增任何不在 JSON 中的道路名、數字或 SOP。\n\n"
        f"```json\n{decision_json}\n```"
    )

    return _bedrock.converse(EXPLAINER_SYSTEM_PROMPT, user_message, max_tokens=4096)


def generate_bedrock_review(record: DecisionRecord) -> Optional[dict]:
    """Run Bedrock Reviewer Agent. Returns structured review or None."""
    if not BEDROCK_ENABLED:
        return None

    decision_json = _build_explanation_context(record)
    user_message = (
        "請審查以下交通決策記錄，檢查是否有安全風險或需要人工確認的事項。\n"
        "以 JSON 格式回應：{\"risk_level\": ..., \"findings\": [...], "
        "\"recommendations\": [...], \"requires_human_review\": bool}\n\n"
        f"```json\n{decision_json}\n```"
    )

    text = _bedrock.converse(REVIEWER_SYSTEM_PROMPT, user_message, max_tokens=2048)
    if not text:
        return None

    # Try to parse JSON from response
    try:
        # Handle markdown code blocks
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        return json.loads(text)
    except (json.JSONDecodeError, IndexError):
        return {"risk_level": "unknown", "findings": [text], "recommendations": [], "requires_human_review": True}


def generate_explanation_with_fallback(record: DecisionRecord) -> DecisionExplanation:
    """
    Try Bedrock explanation first; fall back to deterministic if it fails or hallucinates.

    Flow:
    1. Try Bedrock → get text
    2. Validate text (no hallucinated roads/numbers)
    3. If valid → return enhanced explanation
    4. If invalid or error → return deterministic explanation
    """
    from reasoning.explanation import generate_deterministic_explanation
    from reasoning.validator import validate_explanation

    # Always have deterministic as baseline
    deterministic = generate_deterministic_explanation(record)

    if not BEDROCK_ENABLED:
        return deterministic

    bedrock_text = generate_bedrock_explanation(record)
    if not bedrock_text:
        return deterministic

    # Use bedrock text as the summary, but keep structured fields from deterministic
    enhanced = deterministic.model_copy()
    enhanced_dict = enhanced.model_dump()
    enhanced_dict["summary"] = bedrock_text[:500]  # Cap length

    try:
        enhanced = DecisionExplanation(**enhanced_dict)
        # Validate the enhanced explanation
        route_ids = {r.segment_id for r in record.route_candidates}
        issues = validate_explanation(enhanced, record, route_ids)
        errors = [i for i in issues if i.severity == "error"]
        if errors:
            print(f"[Bedrock] Explanation failed validation: {[e.message for e in errors]}")
            return deterministic
        return enhanced
    except Exception as e:
        print(f"[Bedrock] Fallback to deterministic: {e}")
        return deterministic


def _build_explanation_context(record: DecisionRecord) -> str:
    """Build a compact JSON context for Bedrock prompts."""
    context = {
        "decision_id": record.decision_id,
        "event": {
            "event_id": record.event.event_id,
            "type": record.event.type,
            "severity": record.event.severity,
            "status": record.event.status,
            "location": record.event.location,
            "affected_segment": record.event.affected_segment,
        },
        "classification": {
            "level": record.classification.level,
            "rule_version": record.classification.rule_version,
        },
        "affected_road": record.snapshot.affected_road,
        "ete": {
            "severity": record.ete.severity,
            "base_minutes": record.ete.base_minutes,
            "congestion_adjustment_minutes": record.ete.congestion_adjustment_minutes,
            "total_minutes": record.ete.total_minutes,
            "formula": record.ete.formula,
        },
        "route_candidates": [
            {
                "name": r.name,
                "segment_id": r.segment_id,
                "status": r.status,
                "score": r.score,
                "capacity_vph": r.capacity_vph,
                "current_saturation": r.current_saturation,
                "predicted_saturation": r.predicted_saturation,
                "exclusion_reasons": r.exclusion_reasons,
            }
            for r in record.route_candidates
        ],
        "confidence": {
            "score": record.confidence.score,
            "label": record.confidence.label,
        },
        "reliability": {
            "overall": record.reliability.overall,
            "data_reliability": record.reliability.data_reliability,
            "rule_reliability": record.reliability.rule_reliability,
            "decision_stability": record.reliability.decision_stability,
            "evidence_coverage": record.reliability.evidence_coverage,
        },
        "rule_hits": [
            {"sop_id": h.sop_id, "title": h.title, "result": h.result}
            for h in record.rule_hits
        ],
        "data_quality_warnings": record.data_quality.warnings,
    }
    return json.dumps(context, ensure_ascii=False, indent=2)
