"""
SOP Rule Engine — Module 2: Live Incident Response

輸入：一筆事件 dict + TrafficSnapshot dict
輸出：List[TriggerDecision]（0 到多筆，對應本模組負責的 SOP 條款）

負責的 SOP 條款：
  - SOP-1  壅塞分級（僅在事件牽涉 RD_TPE_001/002 時順帶計算）
  - SOP-2  事故與路障應變（核心）
  - SOP-5  號誌故障應變（核心）
  - SOP-7  ETE 公式（內嵌於 SOP-2/SOP-5 結果，不獨立成一筆）
"""

from typing import List, Optional, Tuple

from shared.lookup import find_entities_in_text
from shared.schemas import TriggerDecision
from .llm_mock import generate_guidance

# ------------------------------------------------------------------
# 常數
# ------------------------------------------------------------------
TRIGGER_SEGMENTS = {"RD_TPE_001", "RD_TPE_002"}

SOP2_STATUS = {"Closed", "Blocked", "Restricted"}
SOP2_SEVERITY = {"High", "Critical"}

BASE_CLEARANCE = {"Critical": 60, "High": 40, "Medium": 20, "Low": 10}

ENABLE_SECONDARY_ROAD_NOTE = True


# ------------------------------------------------------------------
# 輔助：severity 字串 → shared.schemas 允許的 Literal
# ------------------------------------------------------------------
def _map_severity(raw: str) -> str:
    mapping = {
        "A": "critical",
        "B": "yellow",
        "Critical": "critical",
        "High": "red",
        "Medium": "yellow",
        "Low": "info",
    }
    return mapping.get(raw, "yellow")


# ------------------------------------------------------------------
# 上下游判定
# ------------------------------------------------------------------
def _name_to_segment_id(name: str, snapshot: dict) -> Optional[str]:
    matches = find_entities_in_text(name, snapshot, allowed_types=["road_segment"])
    for m in matches:
        if m["entity_type"] == "road_segment":
            return m["entity_id"]
    return None


def _intersection_in_text(intersection_name: str, text: str) -> bool:
    if intersection_name in text:
        return True
    import re
    stripped = re.sub(r"[一二三四五六七八九十]+段$", "", intersection_name)
    if stripped and stripped != intersection_name and stripped in text:
        return True
    return False


def _direction_keywords(flow_direction: str) -> Tuple[List[str], List[str]]:
    generic_before = ["上游"]
    generic_after = ["下游"]

    if "南北向" in flow_direction:
        before = ["北側", "以北", "北邊"] + generic_before
        after = ["南側", "以南", "南邊"] + generic_after
    elif "東西向" in flow_direction:
        before = ["西側", "以西", "西邊"] + generic_before
        after = ["東側", "以東", "東邊"] + generic_after
    else:
        before = generic_before
        after = generic_after

    return before, after


def resolve_upstream_downstream(
    incident: dict,
    segment: dict,
    snapshot: dict,
) -> Tuple[Optional[set], Optional[set]]:
    """
    利用事件 location 文字描述，比對事故落在路段 intersections 中的位置，
    切出上游與下游路口的 segment_id 集合。
    """
    intersections: List[str] = segment.get("intersections", [])
    location_text: str = incident.get("location", "")

    anchor_idx = None
    for idx, name in enumerate(intersections):
        if _intersection_in_text(name, location_text):
            anchor_idx = idx

    if anchor_idx is None:
        return None, None

    before_keywords, _after_keywords = _direction_keywords(
        segment.get("flow_direction", "")
    )
    incident_before_anchor = any(kw in location_text for kw in before_keywords)

    if incident_before_anchor:
        upstream_names = intersections[:anchor_idx]
        downstream_names = intersections[anchor_idx:]
    else:
        upstream_names = intersections[: anchor_idx + 1]
        downstream_names = intersections[anchor_idx + 1 :]

    upstream_ids = {_name_to_segment_id(n, snapshot) for n in upstream_names}
    downstream_ids = {_name_to_segment_id(n, snapshot) for n in downstream_names}
    upstream_ids.discard(None)
    downstream_ids.discard(None)
    return upstream_ids, downstream_ids


# ------------------------------------------------------------------
# ETE（SOP 第7條）
# ------------------------------------------------------------------
def calculate_ete(incident: dict, primary_seg_id: Optional[str], snapshot: dict) -> dict:
    severity = incident.get("severity", "Medium")
    base = BASE_CLEARANCE.get(severity, 20)

    affected_ids = [incident["affected_segment"]]
    if primary_seg_id:
        affected_ids.append(primary_seg_id)

    sats = [
        snapshot["road_segments"][sid]["saturation_score"]
        for sid in affected_ids
        if sid in snapshot["road_segments"]
        and snapshot["road_segments"][sid].get("saturation_score") is not None
    ]
    avg_sat = sum(sats) / len(sats) if sats else 0.5

    penalty = max(0.0, (avg_sat - 0.5) * 60)
    ete_minutes = round(base + penalty, 1)

    return {
        "ete_minutes": ete_minutes,
        "base_clearance": base,
        "avg_saturation": round(avg_sat, 2),
        "congestion_penalty": round(penalty, 1),
        "affected_segments_used": affected_ids,
        "formula_note": "ETE = base_clearance(依severity) + max(0,(平均飽和度-0.5)×60)",
    }


# ------------------------------------------------------------------
# CMS 文字（固定格式，不經 LLM）
# ------------------------------------------------------------------
def generate_cms_text(
    incident: dict, primary_route: Optional[dict], ete_minutes: float
) -> str:
    seg_name = incident.get("location", incident.get("affected_segment", ""))
    if primary_route:
        alt_name = primary_route.get("name", primary_route.get("segment_id", "替代道路"))
        return f"{seg_name}封閉，請改道 {alt_name}，預計延誤 {ete_minutes:.0f} 分鐘"
    return f"{seg_name}事故，請注意行車安全，預計延誤 {ete_minutes:.0f} 分鐘"


mock_generate_cms_text = generate_cms_text


# ------------------------------------------------------------------
# 疏散路徑規劃（SOP 第2條 Step 2）
# ------------------------------------------------------------------
def plan_accident_response(incident: dict, snapshot: dict) -> dict:
    seg_id: str = incident["affected_segment"]
    segment = snapshot["road_segments"].get(seg_id, {})

    upstream_ids, downstream_ids = resolve_upstream_downstream(
        incident, segment, snapshot
    )
    conservative_mode = upstream_ids is None
    if conservative_mode:
        upstream_ids = {
            _name_to_segment_id(n, snapshot)
            for n in segment.get("intersections", [])
        }
        upstream_ids.discard(None)
        downstream_ids = set()

    candidates = []
    for alt_id in segment.get("alternatives", []):
        alt = snapshot["road_segments"].get(alt_id)
        if not alt:
            continue
        if alt.get("capacity_vph", 0) < 1000:
            candidates.append(
                {
                    "segment_id": alt_id,
                    "name": alt["name"],
                    "capacity_vph": alt.get("capacity_vph"),
                    "saturation": alt.get("saturation_score"),
                    "position": "upstream" if alt_id in upstream_ids else "downstream",
                    "excluded_reason": f"容量不足（{alt.get('capacity_vph')} vph < 1000 vph）",
                }
            )
            continue
        intersects_accident = (
            alt_id in upstream_ids or alt_id in downstream_ids
        )
        if not intersects_accident:
            candidates.append(
                {
                    "segment_id": alt_id,
                    "name": alt["name"],
                    "capacity_vph": alt.get("capacity_vph"),
                    "saturation": alt.get("saturation_score"),
                    "position": "unknown",
                    "excluded_reason": "不與事故路段直接相交",
                }
            )
            continue

        candidates.append(
            {
                "segment_id": alt_id,
                "name": alt["name"],
                "capacity_vph": alt.get("capacity_vph"),
                "saturation": alt.get("saturation_score"),
                "position": "upstream" if alt_id in upstream_ids else "downstream",
                "excluded_reason": None,
            }
        )

    primary_pool = [
        c
        for c in candidates
        if c["position"] == "upstream"
        and c.get("saturation") is not None
        and c["excluded_reason"] is None
    ]
    primary = (
        min(primary_pool, key=lambda c: c["saturation"]) if primary_pool else None
    )

    secondary_pool = [
        c
        for c in candidates
        if c["position"] == "downstream" and c["excluded_reason"] is None
    ]

    excluded = []
    primary_id = primary["segment_id"] if primary else None
    for c in candidates:
        if c["segment_id"] == primary_id:
            continue
        if c in secondary_pool:
            continue
        reason = c.get("excluded_reason")
        if reason is None:
            if c.get("saturation") is None:
                reason = "位於上游但缺少即時飽和度資料，無法比較，故未列為主疏散"
            else:
                reason = "位於上游但飽和度高於其他候選，非最優解"
        excluded.append({**c, "excluded_reason": reason})

    for c in secondary_pool:
        excluded.append(
            {
                **c,
                "excluded_reason": "位於事故下游，SOP 規定僅能作次要疏散（不作主疏散）",
            }
        )

    return {
        "primary_evacuation": primary,
        "secondary_evacuation": secondary_pool,
        "excluded_candidates": excluded,
        "primary_congested_warning": bool(
            primary and primary.get("saturation", 0) >= 0.85
        ),
        "conservative_mode": conservative_mode,
    }


# ------------------------------------------------------------------
# SOP-1 壅塞分級判定
# ------------------------------------------------------------------
def classify_congestion_level(saturation: float) -> str:
    if saturation >= 0.95:
        return "A"
    if saturation >= 0.85:
        return "B"
    return "Normal"


def build_sop1_decision(incident: dict, snapshot: dict) -> Optional[TriggerDecision]:
    seg_id = incident.get("affected_segment")
    if seg_id not in TRIGGER_SEGMENTS:
        return None
    segment = snapshot["road_segments"].get(seg_id)
    if not segment:
        return None
    saturation = segment.get("saturation_score")
    if saturation is None:
        return None
    level = classify_congestion_level(saturation)
    if level == "Normal":
        return None

    alt_ids = segment.get("alternatives", [])
    actions = [
        f"長綠燈時制：替代道路 {', '.join(alt_ids)} 綠燈配時 +25%",
        f"警力淨空路口：派遣警力至 {seg_id} ({segment['name']})",
    ]
    cascade = []
    if level == "A":
        cascade.append(
            "A 級同時觸發 SOP-2 路網重規劃（若本次事件同時符合 SOP-2 條件）"
        )

    return TriggerDecision(
        triggered=True,
        sop_clause="SOP-1",
        clause_name="壅塞分級判定",
        entity_id=seg_id,
        entity_name=segment["name"],
        basis=(
            f"飽和度 {saturation:.2f}，達 {level} 級"
            f"（{seg_id} 為城市應變觸發路段，門檻：A≥0.95 / B≥0.85）"
        ),
        actions=actions,
        cascade_checks=cascade,
        severity=_map_severity(level),
        primary_route=None,
        secondary_routes=[],
        excluded_routes=[],
        ete_minutes=None,
        cms_text=None,
        timestamp=incident.get("timestamp"),
    )


# ------------------------------------------------------------------
# SOP-2 事故與路障應變
# ------------------------------------------------------------------
def is_sop2_triggered(incident: dict) -> bool:
    return (
        incident.get("status") in SOP2_STATUS
        and incident.get("severity") in SOP2_SEVERITY
        and str(incident.get("affected_segment", "")).startswith("RD_")
    )


def build_sop2_decision(incident: dict, snapshot: dict) -> TriggerDecision:
    seg_id: str = incident["affected_segment"]
    segment = snapshot["road_segments"].get(seg_id, {})
    seg_name = segment.get("name", seg_id)

    plan = plan_accident_response(incident, snapshot)
    primary = plan["primary_evacuation"]
    primary_seg_id = primary["segment_id"] if primary else None

    ete_result = calculate_ete(incident, primary_seg_id, snapshot)
    ete_minutes = ete_result["ete_minutes"]

    cms_text = generate_cms_text(incident, primary, ete_minutes)

    # 建構 basis
    basis_parts = [
        f"事件符合 SOP 第2條三項條件："
        f"status={incident.get('status')}, "
        f"severity={incident.get('severity')}, "
        f"affected_segment 以 RD_ 開頭。",
    ]
    if primary:
        basis_parts.append(
            f"主疏散路徑：{primary['name']} ({primary['segment_id']})，"
            f"飽和度 {primary.get('saturation', 'N/A'):.2f}，"
            f"容量 {primary.get('capacity_vph', 'N/A')} vph，位於上游。"
        )
        if plan["primary_congested_warning"]:
            basis_parts.append(
                "⚠️ 主疏散路段已壅塞（飽和度≥0.85），仍依 SOP 規定維持選擇，"
                "建議同時啟動長綠燈時制並引導搭乘大眾運輸。"
            )
    if plan["conservative_mode"]:
        basis_parts.append("上下游判定失敗，採保守模式（將所有相交路口視為上游）。")

    secondary_ids = [c["segment_id"] for c in plan["secondary_evacuation"]]
    if secondary_ids:
        secondary_names = [
            f"{c['name']} ({c['segment_id']})"
            for c in plan["secondary_evacuation"]
        ]
        basis_parts.append(f"次要疏散路徑（下游）：{', '.join(secondary_names)}。")

    if plan["excluded_candidates"]:
        exc_summaries = [
            f"{c['name']} ({c['segment_id']}): {c['excluded_reason']}"
            for c in plan["excluded_candidates"]
        ]
        basis_parts.append(f"排除候選：{'; '.join(exc_summaries)}。")

    basis_parts.append(
        f"ETE = {ete_minutes} 分鐘"
        f"（base={ete_result['base_clearance']} 分鐘 + "
        f"壅塞加罰={ete_result['congestion_penalty']} 分鐘，"
        f"平均飽和度={ete_result['avg_saturation']:.2f}）。"
    )
    basis = " ".join(basis_parts)

    cascade = []
    if seg_id in TRIGGER_SEGMENTS:
        cascade.append(
            f"同一路段已同步觸發 SOP-1 壅塞分級判定，見對應 TriggerDecision"
        )

    excluded_for_schema = [
        {"segment_id": c["segment_id"], "reason": c["excluded_reason"]}
        for c in plan["excluded_candidates"]
    ]

    # 草稿 decision → LLM 產生引導文字
    draft_decision = TriggerDecision(
        triggered=True,
        sop_clause="SOP-2",
        clause_name="事故與路障應變",
        entity_id=seg_id,
        entity_name=seg_name,
        basis=basis,
        actions=[],
        cascade_checks=cascade,
        severity=_map_severity(incident.get("severity", "Medium")),
        primary_route=primary_seg_id,
        secondary_routes=secondary_ids,
        excluded_routes=excluded_for_schema,
        ete_minutes=ete_minutes,
        cms_text=cms_text,
        timestamp=incident.get("timestamp"),
    )

    llm_result = generate_guidance(draft_decision)
    guidance_text = llm_result.get("guidance_text", "")
    guidance_source = llm_result.get("_source", "mock")

    actions = [
        f"重新導引車流：主疏散路徑 {primary_seg_id or '無'}",
        f"CMS 電子看板更新：{cms_text}",
    ]

    return TriggerDecision(
        triggered=True,
        sop_clause="SOP-2",
        clause_name="事故與路障應變",
        entity_id=seg_id,
        entity_name=seg_name,
        basis=basis,
        actions=actions,
        cascade_checks=cascade,
        severity=_map_severity(incident.get("severity", "Medium")),
        primary_route=primary_seg_id,
        secondary_routes=secondary_ids,
        excluded_routes=excluded_for_schema,
        ete_minutes=ete_minutes,
        cms_text=cms_text,
        guidance_text=guidance_text,
        guidance_source=guidance_source,
        timestamp=incident.get("timestamp"),
    )


# ------------------------------------------------------------------
# SOP-5 號誌故障應變
# ------------------------------------------------------------------
def is_sop5_triggered(incident: dict) -> bool:
    if incident.get("type") == "Power_Failure":
        return True
    desc = incident.get("description", "")
    return ("號誌失效" in desc) or ("號誌故障" in desc)


def build_sop5_decision(incident: dict, snapshot: dict) -> TriggerDecision:
    seg_id = incident.get("affected_segment", "")
    segment = snapshot["road_segments"].get(seg_id)
    seg_name = segment["name"] if segment else seg_id

    intersection_count = len(segment.get("intersections", [])) if segment else 1
    police_needed = intersection_count * 2

    ete_result = calculate_ete(incident, None, snapshot)
    ete_minutes = ete_result["ete_minutes"]

    cms_text = f"{seg_name}號誌故障，請依現場指揮通行，預計延誤 {ete_minutes:.0f} 分鐘"

    basis = (
        f"事件 type={incident.get('type')!r} 或描述含「號誌故障/失效」，"
        f"觸發 SOP 第5條人工指揮派遣。"
        f"受影響路口數={intersection_count}，所需警力={police_needed} 人。"
        f"ETE = {ete_minutes} 分鐘"
        f"（base={ete_result['base_clearance']} 分鐘 + "
        f"壅塞加罰={ete_result['congestion_penalty']} 分鐘）。"
    )

    draft_decision = TriggerDecision(
        triggered=True,
        sop_clause="SOP-5",
        clause_name="號誌故障應變",
        entity_id=seg_id,
        entity_name=seg_name,
        basis=basis,
        actions=[],
        cascade_checks=[],
        severity=_map_severity(incident.get("severity", "Medium")),
        primary_route=None,
        secondary_routes=[],
        excluded_routes=[],
        ete_minutes=ete_minutes,
        cms_text=cms_text,
        timestamp=incident.get("timestamp"),
    )

    llm_result = generate_guidance(draft_decision)
    guidance_text = llm_result.get("guidance_text", "")
    guidance_source = llm_result.get("_source", "mock")

    actions = [
        f"人工指揮派遣：{seg_name} 派遣 {police_needed} 名警力接管交通指揮",
        f"CMS 更新：{cms_text}",
    ]

    return TriggerDecision(
        triggered=True,
        sop_clause="SOP-5",
        clause_name="號誌故障應變",
        entity_id=seg_id,
        entity_name=seg_name,
        basis=basis,
        actions=actions,
        cascade_checks=[],
        severity=_map_severity(incident.get("severity", "Medium")),
        primary_route=None,
        secondary_routes=[],
        excluded_routes=[],
        ete_minutes=ete_minutes,
        cms_text=cms_text,
        guidance_text=guidance_text,
        guidance_source=guidance_source,
        timestamp=incident.get("timestamp"),
    )


# ------------------------------------------------------------------
# 主流程
# ------------------------------------------------------------------
def process_incident(incident: dict, snapshot: dict) -> List[TriggerDecision]:
    """
    對一筆注入事件執行全部模組2負責的 SOP 規則，
    回傳 0 到多筆 TriggerDecision。
    """
    decisions: List[TriggerDecision] = []

    sop1 = build_sop1_decision(incident, snapshot)
    if sop1:
        decisions.append(sop1)

    if is_sop2_triggered(incident):
        decisions.append(build_sop2_decision(incident, snapshot))

    if is_sop5_triggered(incident):
        decisions.append(build_sop5_decision(incident, snapshot))

    if not decisions:
        cascade: List[str] = []
        if ENABLE_SECONDARY_ROAD_NOTE and str(
            incident.get("affected_road", "")
        ).startswith("RD_"):
            cascade.append(
                f"事件間接影響 {incident['affected_road']}（車道容量下降），"
                f"未觸發完整路網重規劃，建議留意該路段是否需要人工調度"
            )
        cascade.append(
            "此事件不符合模組2（SOP 第1/2/5條）之程式化觸發條件；"
            "若涉及 BS_ 人流站點，建議轉交模組3（SOP-3 捷運分流）"
            "/模組4（SOP-4 散場）處理"
        )
        decisions.append(
            TriggerDecision(
                triggered=False,
                sop_clause=None,
                clause_name="無觸發條款",
                entity_id=incident.get("affected_segment") or incident.get("event_id"),
                entity_name=incident.get("location", ""),
                basis="不符合 SOP 第2條三項條件，亦非 Power_Failure / 號誌故障描述",
                actions=[],
                cascade_checks=cascade,
                severity=_map_severity(incident.get("severity", "Medium")),
                primary_route=None,
                secondary_routes=[],
                excluded_routes=[],
                ete_minutes=None,
                cms_text=None,
                timestamp=incident.get("timestamp"),
            )
        )

    return decisions
