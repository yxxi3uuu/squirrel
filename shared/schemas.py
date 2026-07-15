"""
Common data contracts for all modules.

These Pydantic models document the shape of the shared traffic snapshot.
Feature modules can still pass plain dictionaries, but the models give the
team one agreed contract for validation, API handoff, and future integration.
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class EntityBase(BaseModel):
    name: str
    aliases: List[str] = Field(default_factory=list)


class MetroStation(EntityBase):
    user_count: int
    growth_rate: float
    roaming_user_pct: float
    capacity: int
    related_cell_towers: List[str] = Field(default_factory=list)


class RoadSegment(EntityBase):
    saturation_score: float
    capacity_vph: int
    flow_direction: Literal["east", "west", "north", "south", "unknown"] = "unknown"
    alternatives: List[str] = Field(default_factory=list)
    intersections: List[str] = Field(default_factory=list)


class Venue(EntityBase):
    user_count: int
    growth_rate: float
    peak_user_count: Optional[int] = None
    event_status: Literal["scheduled", "ongoing", "dismissal", "ended", "unknown"] = "unknown"
    roaming_user_pct: Optional[float] = None
    related_stations: List[str] = Field(default_factory=list)
    related_cell_towers: List[str] = Field(default_factory=list)


class CellTower(BaseModel):
    area: str
    aliases: List[str] = Field(default_factory=list)
    roaming_user_pct: float
    related_entities: List[str] = Field(default_factory=list)


class Incident(BaseModel):
    incident_id: str
    type: str
    status: str
    severity: Literal["Low", "Medium", "High", "Critical"]
    description: str
    affected_segment: Optional[str] = None
    affected_station: Optional[str] = None
    started_at: Optional[str] = None


class SignalStatus(BaseModel):
    status: Literal["normal", "degraded", "failed", "manual"]
    related_segments: List[str] = Field(default_factory=list)


class TrafficSnapshot(BaseModel):
    timestamp: str
    source: str
    metro_stations: Dict[str, MetroStation] = Field(default_factory=dict)
    road_segments: Dict[str, RoadSegment] = Field(default_factory=dict)
    venues: Dict[str, Venue] = Field(default_factory=dict)
    cell_towers: Dict[str, CellTower] = Field(default_factory=dict)
    incidents: List[Incident] = Field(default_factory=list)
    signals: Dict[str, SignalStatus] = Field(default_factory=dict)


class TriggerDecision(BaseModel):
    """
    Shared result shape for module 3 advisory, module 4 dashboard status,
    and module 5 notification generation.
    """

    triggered: bool
    sop_clause: Optional[str] = None
    clause_name: Optional[str] = None
    entity_id: Optional[str] = None
    entity_name: Optional[str] = None
    basis: str
    actions: List[str] = Field(default_factory=list)
    cascade_checks: List[str] = Field(default_factory=list)
    severity: Optional[Literal["info", "yellow", "red", "critical"]] = None

