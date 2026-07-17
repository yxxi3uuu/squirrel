"""Pydantic contracts for Module 4 decision evidence chains."""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceRef(StrictBaseModel):
    evidence_id: str
    source: str
    field: str
    value: object
    description: str


class DecisionEvent(StrictBaseModel):
    event_id: str
    type: str
    severity: str
    status: str
    location: str
    description: str
    affected_segment: str
    affected_road: Optional[str] = None
    timestamp: str


class SnapshotSummary(StrictBaseModel):
    timestamp: str
    source_versions: Dict[str, str]
    affected_road: Dict[str, object]


class RuleHit(StrictBaseModel):
    sop_id: str
    clause: str
    title: str
    condition: str
    observed: object
    threshold: object
    result: str
    evidence_ids: List[str] = Field(default_factory=list)


class ClassificationResult(StrictBaseModel):
    level: Literal["A", "B", "NORMAL", "UNKNOWN"]
    method: Literal["deterministic_rule"]
    rule_version: str
    evidence_ids: List[str] = Field(default_factory=list)


class ETEResult(StrictBaseModel):
    severity: str
    base_minutes: float
    average_saturation: float
    congestion_adjustment_minutes: float
    total_minutes: float
    formula: str
    calculation_version: str
    evidence_ids: List[str] = Field(default_factory=list)


class RouteCandidate(StrictBaseModel):
    segment_id: str
    name: str
    capacity_vph: int
    current_saturation: Optional[float] = None
    lane_status: Optional[str] = None
    is_designated_alternative: bool
    directly_connected: bool
    upstream_status: Literal["upstream", "downstream", "unknown", "not_connected"]
    predicted_inflow_vph: float
    predicted_saturation: Optional[float] = None
    pedestrian_conflict: bool
    score: float
    rank: int
    status: Literal["recommended", "backup", "excluded"]
    exclusion_codes: List[str] = Field(default_factory=list)
    exclusion_reasons: List[str] = Field(default_factory=list)
    evidence_ids: List[str] = Field(default_factory=list)


class DataQuality(StrictBaseModel):
    completeness: float
    freshness_seconds: float
    missing_fields: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ConfidenceScore(StrictBaseModel):
    score: float
    label: Literal["high", "medium", "low"]
    components: Dict[str, float]
    explanation_items: List[str] = Field(default_factory=list)


class EvidenceStep(StrictBaseModel):
    order: int
    title: str
    detail: str
    evidence_ids: List[str] = Field(default_factory=list)


class ExcludedRouteExplanation(StrictBaseModel):
    segment_id: str
    name: str
    reason: str
    evidence_values: List[str] = Field(default_factory=list)


class DecisionExplanation(StrictBaseModel):
    summary: str
    classification_explanation: str
    sop_citations: List[str]
    recommended_route_explanation: str
    excluded_route_explanations: List[ExcludedRouteExplanation]
    ete_explanation: str
    confidence_explanation: str
    warnings: List[str] = Field(default_factory=list)


class ValidationIssue(StrictBaseModel):
    severity: Literal["error", "warning"]
    code: str
    message: str


class DecisionRecord(StrictBaseModel):
    decision_id: str
    created_at: str
    event: DecisionEvent
    snapshot: SnapshotSummary
    evidence: List[EvidenceRef]
    rule_hits: List[RuleHit]
    classification: ClassificationResult
    ete: ETEResult
    route_candidates: List[RouteCandidate]
    data_quality: DataQuality
    confidence: ConfidenceScore
    evidence_chain: List[EvidenceStep]
    explanation: DecisionExplanation
    validation_issues: List[ValidationIssue] = Field(default_factory=list)
    execution_time_ms: float
    model_version: str


class ExplainDecisionRequest(StrictBaseModel):
    timestamp: Optional[str] = None
    event_id: Optional[str] = None
    include_raw_snapshot: bool = False


class AskDecisionRequest(StrictBaseModel):
    question: str
    timestamp: Optional[str] = None
    event_id: Optional[str] = None
