"""
Common data contracts for all modules.

Schema 完全鏡射主辦方官方資料欄位（city_traffic_flow.csv、
signaling_crowd_density.csv、road_network_geometry.json、live_incidents.json），
避免各模組之間多一層欄位名轉換。

正規化約定（由 data/snapshot.py 統一處理，模組不要各自轉）：
- Roaming_User_Pct 官方為帶 % 字串（"5%"），快照內一律轉為 0-1 float。
- Timestamp 一律使用官方格式 "YYYY-MM-DD HH:MM"（SOP 第 6 條要求）。
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Station(StrictBaseModel):
    """基地台 / 人流站點（BS_ 開頭）。

    官方 signaling_crowd_density.csv 只有一種 BS_ 實體：
    捷運站、場館（大巨蛋）、商圈、轉運站都在這裡，
    同一站同時有人數、增幅與漫遊率（SOP 3/4/6 都由此判定）。
    """

    name: str                       # 官方 Location_Name，例：捷運市政府站
    aliases: List[str] = Field(default_factory=list)
    user_count: int                 # User_Count
    stay_time_avg: Optional[int] = None   # Stay_Time_Avg（分鐘）
    growth_rate: float              # Growth_Rate（官方已算好）
    roaming_user_pct: float         # 已正規化為 0-1 float（官方原始為 "5%" 字串）
    peak_user_count: Optional[int] = None  # 截至快照時間的歷史峰值（SOP 4 用）


class RoadSegment(StrictBaseModel):
    """道路路段（RD_ 開頭）＝ road_network_geometry.json ＋ 該時間點車流。"""

    name: str                       # 官方 Road_Name / name
    aliases: List[str] = Field(default_factory=list)
    flow_direction: str             # 官方原字串，例："南北向 (事故影響南下車流)"
    intersections: List[str] = Field(default_factory=list)
    # 相交路口「路名」，官方已依上游→下游排序（SOP 2a 上游判定用）
    capacity_vph: int
    alternatives: List[str] = Field(default_factory=list)   # 替代路段 segment_id
    nearby_stations: List[str] = Field(default_factory=list)  # 鄰近基地台 BS_ID
    # 以下來自 city_traffic_flow.csv 的當前時間點
    avg_speed: Optional[int] = None          # Avg_Speed km/h，0 = 完全停滯
    vehicle_count: Optional[int] = None      # Vehicle_Count
    saturation_score: Optional[float] = None # Saturation_Score（SOP 1 分級直接用）
    lane_status: Optional[str] = None
    # Normal / Congested / Critical / Accident_Impact / Blocked / Gridlock / Partial_Open


class Incident(StrictBaseModel):
    """突發事件，欄位名完全鏡射官方 live_incidents.json。"""

    event_id: str
    type: str                       # 例：Road_Collapse_Accident / Power_Failure
    location: str
    affected_segment: str           # RD_ 或 BS_ 開頭（SOP 2 條件 (3) 靠 prefix 判斷）
    affected_road: Optional[str] = None   # BS_ 人流事件可能額外標註受影響道路
    status: str                     # Closed / Restricted / Caution ...
    severity: Literal["Low", "Medium", "High", "Critical"]
    description: str
    timestamp: str                  # "YYYY-MM-DD HH:MM"


class TrafficSnapshot(StrictBaseModel):
    """某一時間點的完整現場快照。模組 1 產出，模組 2/3/4 讀取。"""

    timestamp: str                  # "YYYY-MM-DD HH:MM"
    source: str                     # official_files / api / dynamodb ...
    road_segments: Dict[str, RoadSegment] = Field(default_factory=dict)
    stations: Dict[str, Station] = Field(default_factory=dict)
    incidents: List[Incident] = Field(default_factory=list)  # 已發生（timestamp <= 快照時間）


class TriggerDecision(StrictBaseModel):
    """模組 2 規則判斷結果，供模組 3（引用）、4（顯示）、5（發送）共用。"""

    triggered: bool
    sop_clause: Optional[str] = None        # 例："第 3 條"
    clause_name: Optional[str] = None       # 例："捷運與接駁分流"
    entity_id: Optional[str] = None         # RD_ / BS_ ID
    entity_name: Optional[str] = None
    basis: str                              # 引用數值的判定依據（模組 4 解釋鏈用）
    actions: List[str] = Field(default_factory=list)
    cascade_checks: List[str] = Field(default_factory=list)  # 連動檢查（如觸發第3條時檢查第6條）
    severity: Optional[Literal["info", "yellow", "red", "critical"]] = None
    # SOP 2b / 7 的產出，模組 4 顯示、模組 5 發送會用到：
    primary_route: Optional[str] = None     # 主疏散 segment_id
    secondary_routes: List[str] = Field(default_factory=list)
    excluded_routes: List[Dict] = Field(default_factory=list)
    # [{"segment_id": ..., "reason": ...}] 排除理由（模組 4 解釋鏈要求）
    ete_minutes: Optional[float] = None     # SOP 7 公式結果（程式算，LLM 只解釋）
    cms_text: Optional[str] = None          # SOP 2b 產出的 CMS 文字
    guidance_text: Optional[str] = None     # LLM 產出的指揮官引導文字
    guidance_source: Optional[str] = None   # llm / bedrock / mock
    timestamp: Optional[str] = None
