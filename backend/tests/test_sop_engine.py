"""
規格書第10節的三個測試案例驗證腳本。

執行方式：
  cd d:\\REPOs\\squirrel
  python -m backend.tests.test_sop_engine

預期結果：
  案例A：陣列長度 2（SOP-1 + SOP-2）；ETE≈83.4
  案例B：陣列長度 1（SOP-5）；police_needed=6；ETE≈41
  案例C：陣列長度 1（非觸發，triggered=False）
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from data.snapshot import get_snapshot, available_timestamps
from backend.services.sop_engine import process_incident


def _nearest_snapshot_ts(target_ts: str) -> str:
    available = available_timestamps()
    candidates = [ts for ts in available if ts <= target_ts]
    if not candidates:
        return available[0]
    return candidates[-1]


def _load_incidents():
    path = Path(__file__).resolve().parents[2] / "data_source" / "live_incidents.json"
    with path.open("r", encoding="utf-8") as fh:
        return {inc["event_id"]: inc for inc in json.load(fh)}


def run_case_a(incidents: dict):
    print("\n" + "=" * 60)
    print("案例A：路面塌陷事故 TPE_2026_ACC_001")
    print("=" * 60)
    incident = incidents["TPE_2026_ACC_001"]
    snapshot = get_snapshot(_nearest_snapshot_ts(incident["timestamp"]))
    decisions = process_incident(incident, snapshot)

    print(f"回傳陣列長度：{len(decisions)}（預期：2）")
    for d in decisions:
        print(f"\n  sop_clause = {d.sop_clause}")
        print(f"  triggered  = {d.triggered}")
        print(f"  entity_id  = {d.entity_id}")
        print(f"  severity   = {d.severity}")
        print(f"  ete_minutes= {d.ete_minutes}")
        if d.primary_route:
            print(f"  primary_route = {d.primary_route}")
        if d.secondary_routes:
            print(f"  secondary_routes = {d.secondary_routes}")
        print(f"  actions ({len(d.actions)}):")
        for a in d.actions:
            print(f"    - {a}")
        print(f"  cascade_checks: {d.cascade_checks}")

    assert len(decisions) == 2, f"❌ 預期陣列長度2，實際為{len(decisions)}"

    sop1 = next((d for d in decisions if d.sop_clause == "SOP-1"), None)
    assert sop1 is not None, "❌ 缺少 SOP-1 決策"
    assert sop1.entity_id == "RD_TPE_002", f"❌ SOP-1 entity_id 預期 RD_TPE_002，實際 {sop1.entity_id}"
    assert sop1.severity == "critical", f"❌ SOP-1 severity 預期 critical，實際 {sop1.severity}"

    sop2 = next((d for d in decisions if d.sop_clause == "SOP-2"), None)
    assert sop2 is not None, "❌ 缺少 SOP-2 決策"
    assert sop2.primary_route == "RD_TPE_004", (
        f"❌ 主疏散路徑預期 RD_TPE_004（市民大道四段），實際 {sop2.primary_route}"
    )
    assert sop2.ete_minutes is not None, "❌ ETE 不得為 None"
    assert abs(sop2.ete_minutes - 83.4) < 2.0, (
        f"❌ ETE 預期約83.4，實際 {sop2.ete_minutes}"
    )

    print("\n✅ 案例A 通過")


def run_case_b(incidents: dict):
    print("\n" + "=" * 60)
    print("案例B：號誌故障 TPE_2026_EVT_003")
    print("=" * 60)
    incident = incidents["TPE_2026_EVT_003"]
    snapshot = get_snapshot(_nearest_snapshot_ts(incident["timestamp"]))
    decisions = process_incident(incident, snapshot)

    print(f"回傳陣列長度：{len(decisions)}（預期：1）")
    for d in decisions:
        print(f"\n  sop_clause = {d.sop_clause}")
        print(f"  triggered  = {d.triggered}")
        print(f"  entity_id  = {d.entity_id}")
        print(f"  ete_minutes= {d.ete_minutes}")
        print(f"  actions:")
        for a in d.actions:
            print(f"    - {a}")
        print(f"  basis: {d.basis}")

    assert len(decisions) == 1, f"❌ 預期陣列長度1，實際為{len(decisions)}"
    sop5 = decisions[0]
    assert sop5.sop_clause == "SOP-5", f"❌ 預期 SOP-5，實際 {sop5.sop_clause}"
    assert sop5.entity_id == "RD_TPE_007", f"❌ entity_id 預期 RD_TPE_007，實際 {sop5.entity_id}"
    assert "6" in sop5.actions[0], (
        f"❌ 警力人數預期6人，actions: {sop5.actions}"
    )
    assert sop5.ete_minutes is not None and 20 <= sop5.ete_minutes <= 60, (
        f"❌ ETE 預期約41，實際 {sop5.ete_minutes}"
    )

    print("\n✅ 案例B 通過")


def run_case_c(incidents: dict):
    print("\n" + "=" * 60)
    print("案例C：捷運人群推擠 TPE_2026_EVT_002（模糊案例）")
    print("=" * 60)
    incident = incidents["TPE_2026_EVT_002"]
    snapshot = get_snapshot(_nearest_snapshot_ts(incident["timestamp"]))
    decisions = process_incident(incident, snapshot)

    print(f"回傳陣列長度：{len(decisions)}（預期：1）")
    for d in decisions:
        print(f"\n  sop_clause = {d.sop_clause}")
        print(f"  triggered  = {d.triggered}")
        print(f"  entity_id  = {d.entity_id}")
        print(f"  cascade_checks:")
        for cc in d.cascade_checks:
            print(f"    - {cc}")

    assert len(decisions) == 1, f"❌ 預期陣列長度1，實際為{len(decisions)}"
    non_trigger = decisions[0]
    assert non_trigger.triggered is False, "❌ triggered 應為 False"
    assert non_trigger.sop_clause is None, f"❌ sop_clause 應為 None，實際 {non_trigger.sop_clause}"

    has_rd_note = any("RD_TPE_001" in cc for cc in non_trigger.cascade_checks)
    assert has_rd_note, f"❌ cascade_checks 應含 RD_TPE_001 備註：{non_trigger.cascade_checks}"

    print("\n✅ 案例C 通過")


if __name__ == "__main__":
    incidents = _load_incidents()
    errors = []

    for runner in (run_case_a, run_case_b, run_case_c):
        try:
            runner(incidents)
        except AssertionError as e:
            print(str(e))
            errors.append(str(e))
        except Exception as e:
            msg = f"❌ 例外錯誤：{e}"
            print(msg)
            errors.append(msg)

    print("\n" + "=" * 60)
    if errors:
        print(f"❌ 共 {len(errors)} 項失敗")
        sys.exit(1)
    else:
        print("✅ 全部測試案例通過")
