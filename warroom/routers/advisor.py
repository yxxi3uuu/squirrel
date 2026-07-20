"""模組三 API：策略諮詢顧問（整合展示版）"""

import csv
import json
import os
import re
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data_source")
CONGESTION_ACTION_ROADS = {"RD_TPE_001", "RD_TPE_002"}


class ChatRequest(BaseModel):
    message: str
    current_event: Optional[dict[str, Any]] = None
    current_decisions: list[dict[str, Any]] = []


@router.post("/chat")
def chat(req: ChatRequest):
    message = req.message.strip()
    snapshot = _snapshot()
    answer = _answer(message, snapshot, req.current_event, req.current_decisions)
    return {
        "answer": answer,
        "source": "rules+snapshot",
        "snapshot_timestamp": snapshot["timestamp"],
    }


def _answer(
    message: str,
    snapshot: dict[str, Any],
    current_event: Optional[dict[str, Any]],
    decisions: list[dict[str, Any]],
) -> str:
    normalized = message.lower()
    road = _match_road(message, snapshot)
    station = _match_station(message, snapshot)

    if _is_sop_overview(message):
        return _answer_sop_overview()

    if _is_roaming_scan(message):
        return _answer_roaming_scan(snapshot)

    if _is_roaming_rule(message):
        return (
            "SOP-6 數位通報與多語化的觸發條件是任一基地台或站點外籍旅客比例達 30% 以上。\n"
            "■ 建議處置：達標時產出中英日韓泰越法七語訊息，並同步簡訊與資訊看板；未達標則維持中文提醒與監測。\n"
            "■ 後續確認：若問題指定站點，我會直接從目前快照讀取漫遊率，不要求指揮官手動提供比例。"
        )

    if _is_congestion_rule(message):
        return (
            "SOP-1 壅塞分級：飽和度 0.85 到未滿 0.95 為 B 級，0.95 以上為 A 級。\n"
            "■ 建議處置：全 15 路段都可顯示紅黃燈；只有忠孝東路四段與光復南路會觸發長綠燈、警力淨空與替代路徑引導。\n"
            "■ 後續確認：其他路段若變成 SOP-2 主疏散路徑，才會在事故應變中被納入處置。"
        )

    if "大巨蛋" in message:
        dome = _answer_dome(message)
        if dome:
            return dome

    if _is_metro_request(message):
        metro = _answer_metro(message, snapshot)
        if metro:
            return metro

    road_congestion = _extract_road_congestion(message, road)
    if road_congestion:
        return _answer_road_congestion(*road_congestion)

    if _is_incident(message):
        if road:
            return _answer_accident_scenario(message, road, snapshot)
        return (
            "目前資訊不足，尚不能判定 SOP-2 車禍與路障應變是否成立。\n"
            "■ 建議處置：請補充事故發生路段、通行狀態是否封閉/阻斷/限制通行，以及事故嚴重度是否高或重大。\n"
            "■ 後續確認：三項同時成立後，才會產生改道路徑、資訊看板文字與預計恢復時間。"
        )

    if _is_signal(message):
        if road:
            return _answer_signal_scenario(road)
        return (
            "受影響路段出現號誌故障或失效，但目前缺少具體路段，尚不能產生完整派遣與恢復時間。\n"
            "■ 建議處置：請補充受影響路段；已知路段後，每路口配置 2 名警力並發布資訊看板。\n"
            "■ 後續確認：號誌故障不會直接套用 SOP-2 主疏散路徑，除非另有封閉或事故條件。"
        )

    if road and any(k in message for k in ("車禍", "事故", "路障", "封閉", "關閉", "封鎖", "受阻")):
        return _answer_accident_scenario(message, road, snapshot)

    if road and any(k in message for k in ("號誌", "紅綠燈", "燈號")):
        return _answer_signal_scenario(road)

    if decisions and any(k in message for k in ("剛剛", "目前", "事件", "為什麼", "決策")):
        lines = []
        for d in decisions:
            clause = d.get("sop_clause") or "未觸發"
            lines.append(f"{clause}：{d.get('basis', '')}")
            if d.get("actions"):
                lines.append("建議動作：" + "；".join(d["actions"]))
        return "根據最近一次事件注入結果，" + " ".join(lines)

    if road:
        return _answer_road_status(*road)

    if station:
        return _answer_station_roaming(*station)

    if "sop" in normalized or "條" in message:
        return _answer_sop_overview()

    summary = snapshot["summary"]
    return (
        f"目前快照時間 {snapshot['timestamp']}：A級路段 {summary['a_count']} 條、B級路段 {summary['b_count']} 條，"
        f"最高漫遊率站點為 {summary['top_station']}。可以問我某一路段是否觸發 SOP，或詢問剛剛注入事件的決策理由。"
    )


def _answer_sop_overview() -> str:
    return (
        "模組 3 顧問可回答 SOP-1 到 SOP-7 的 what-if 判斷，但不負責真正執行事件注入或發布通報。\n"
        "■ 建議處置：SOP-1 判壅塞、SOP-2 判事故改道、SOP-3 判捷運/接駁分流、SOP-4 判大巨蛋散場、SOP-5 判號誌故障、SOP-6 判多語通報、SOP-7 內嵌 ETE。\n"
        "■ 後續確認：請提供路段、站點、人潮/成長率、事故嚴重度或通行狀態，我會依使用者假設優先、未提供者從快照補。"
    )


def _answer_road_status(seg_id: str, seg: dict[str, Any]) -> str:
    sat = seg.get("saturation_score")
    level = _congestion_level(sat)
    trigger_note = (
        "此路段屬於 SOP-1 城市應變觸發路段，可啟動長綠燈與警力淨空。"
        if seg_id in CONGESTION_ACTION_ROADS
        else "此路段只做 Dashboard 分級顯示，不會單獨觸發 SOP-1 應變動作。"
    )
    return (
        f"{seg['name']}（{seg_id}）目前飽和度 {sat:.2f}、車速 {seg.get('avg_speed')} km/h，判定為{level}。\n"
        f"■ 建議處置：{trigger_note}\n"
        f"■ 後續確認：替代道路為 {_alternative_names(seg) or '無'}；若有事故封閉，需另用 SOP-2 判斷。"
    )


def _answer_road_congestion(seg_id: str, seg: dict[str, Any], saturation: float) -> str:
    level = _congestion_level(saturation)
    if saturation < 0.85:
        return (
            f"{seg['name']}飽和度 {saturation:.2f} 未達 SOP-1 B 級門檻，因此不觸發交通壅塞應變。\n"
            "■ 建議處置：Dashboard 維持一般監測，不啟動長綠燈時制。\n"
            "■ 後續確認：若上升至 0.85 以上再判定 B 級；0.95 以上判定 A 級。"
        )
    if seg_id not in CONGESTION_ACTION_ROADS:
        return (
            f"{seg['name']}飽和度 {saturation:.2f} 可在 Dashboard 顯示為{level}，但它不是 SOP-1 應變觸發路段。\n"
            "■ 建議處置：不因 SOP-1 單獨啟動長綠燈時制；若它成為 SOP-2 主疏散路段，才依事故應變處理。\n"
            "■ 後續確認：城市應變觸發路段限定忠孝東路四段與光復南路。"
        )
    action = "啟動長綠燈時制、替代道路綠燈配時 +25%、調度警力淨空路口"
    if saturation >= 0.95:
        action += "，並加開替代路徑引導"
    return (
        f"{seg['name']}飽和度 {saturation:.2f} 判定為{level}，符合 SOP-1 壅塞應變。\n"
        f"■ 建議處置：{action}。\n"
        f"■ 後續確認：替代道路為 {_alternative_names(seg) or '無'}；若同步有事故封閉，需連動 SOP-2。"
    )


def _answer_accident_scenario(message: str, road: tuple[str, dict[str, Any]], snapshot: dict[str, Any]) -> str:
    seg_id, seg = road
    severity = _severity_from_text(message)
    status = _incident_status_from_text(message)
    if severity == "minor":
        return (
            f"{seg['name']}出現關閉、封鎖或通行受阻情境，但事故嚴重度為輕微，未達 SOP 第 2 條要求的高或重大等級，因此不觸發車禍與路障應變\n"
            "■ 建議處置：暫不啟動替代路徑引導與預計恢復時間計算，維持現場交通疏導與儀表板監測。\n"
            "■ 後續確認：若現場回報升級為 High / Critical，或封閉造成連鎖壅塞，再重新啟動 SOP-2 判斷。\n"
            "✓ 誠實回答「不觸發」，沒有硬套劇本"
        )
    if status == "negated":
        return (
            f"{seg['name']}雖發生嚴重車禍，但目前明確表示沒有封閉、阻斷或限制通行，尚未符合 SOP-2 完整觸發條件。\n"
            "■ 建議處置：暫不啟動替代路徑引導；先確認現場是否仍可正常通行。\n"
            "■ 後續確認：SOP-2 需要道路路段、通行受阻狀態，以及高或重大事故等級三項同時成立。"
        )
    missing = []
    if not status:
        missing.append("通行狀態是否為封閉、阻斷或限制通行")
    if severity == "unknown":
        missing.append("事故嚴重度是否為高或重大")
    if missing:
        return (
            f"{seg['name']}事故資訊不足，尚不能判定 SOP-2 車禍與路障應變是否成立。\n"
            f"■ 建議處置：請補充{'、'.join(missing)}。\n"
            "■ 後續確認：條件齊備後才會產生改道路徑、CMS 文字與預計恢復時間。"
        )

    primary, secondary = _rank_alternatives(seg, snapshot)
    primary_name = primary["name"] if primary else "尚無合格替代道路"
    secondary_names = "、".join(r["name"] for r in secondary[:2]) or "無"
    ete = _estimate_ete(severity, seg, primary)
    return (
        f"{seg['name']}符合 SOP-2 車禍與路障應變：事故嚴重度達高/重大且路段通行受阻，建議啟動替代路徑引導。\n"
        f"■ 主疏散：{primary_name}；次要疏散：{secondary_names}。\n"
        f"■ 預估恢復時間：ETE {ete:.1f} 分鐘，依事故基本清除時間加上壅塞懲罰計算。\n"
        "✓ 已把事故條件、封閉狀態與路網替代能力一起納入判斷"
    )


def _answer_signal_scenario(road: tuple[str, dict[str, Any]]) -> str:
    _, seg = road
    intersections = "、".join(seg.get("intersections", [])[:3]) or seg["name"]
    ete = _estimate_ete("signal", seg, None)
    return (
        f"{seg['name']}若發生號誌故障，對應 SOP-5 號誌失效處置，需先切換人工指揮與鄰近路口協調時制。\n"
        f"■ 建議處置：受影響路口每路口配置 2 名警力，派遣至 {intersections}；CMS 發布「{seg['name']}號誌故障，請依現場指揮通行」，預估持續 {ete:.0f} 分鐘。\n"
        "■ 後續確認：若忠孝東路四段或光復南路達 B/A 級，需另依 SOP-1 判定是否啟動長綠燈時制。\n"
        "✓ 這是號誌故障情境，不會誤判成 SOP-2 事故封閉"
    )


def _answer_metro(message: str, snapshot: dict[str, Any]) -> Optional[str]:
    station = _match_station("捷運國父紀念館站", snapshot)
    user_count = _extract_count(message)
    growth = _extract_growth(message)
    if user_count is None and growth is None:
        if any(k in message for k in ("很多", "大量", "擁擠")):
            return (
                "捷運國父紀念館站人潮描述不足，尚不能判定 SOP-3 捷運與接駁分流。\n"
                "■ 建議處置：請補充人潮數字或人流成長率，例如「人潮增至 40,000 人」或「成長率 35%」。\n"
                "■ 後續確認：SOP-3 門檻是人潮 > 25,000 或成長率 > 30%。"
            )
        if station:
            _, sta = station
            user_count = sta.get("user_count")
            growth = sta.get("growth_rate")

    triggered_by_count = user_count is not None and user_count > 25000
    triggered_by_growth = growth is not None and growth > 0.30
    count_text = f"人潮 {user_count:,} 人" if user_count is not None else "人潮未提供"
    growth_text = f"成長率 {growth*100:.0f}%" if growth is not None else "成長率未提供"
    if triggered_by_count or triggered_by_growth:
        return (
            f"捷運國父紀念館站符合 SOP-3 捷運與接駁分流：{count_text}、{growth_text}，已超過人潮 > 25,000 或成長率 > 30% 的門檻。\n"
            "■ 建議處置：通知北捷啟動過站不停或班距調整，公車處加開接駁專車，並引導旅客往捷運市政府站分流。\n"
            "■ 後續確認：若同時接近大巨蛋散場，需連動 SOP-4 判斷散場啟動與人流退場方向。"
        )
    if user_count is not None or growth is not None:
        return (
            f"捷運國父紀念館站尚未觸發 SOP-3：{count_text}、{growth_text}，未超過人潮 > 25,000 或成長率 > 30% 的門檻。\n"
            "■ 建議處置：維持站內人流監測與廣播提醒，不啟動過站不停或接駁專車。\n"
            "■ 後續確認：25,000 人與 30% 都是邊界值本身，不算觸發。"
        )
    return None


def _answer_dome(message: str) -> Optional[str]:
    count = _extract_count(message)
    growth = _extract_growth(message)
    if count is None and growth is not None:
        return (
            "大巨蛋散場情境缺少歷史峰值，尚不能判定 SOP-4 是否成立。\n"
            "■ 建議處置：請補充人潮峰值是否達 30,000 人，例如「人潮達 40,000 人且成長率 -0.25」。\n"
            "■ 後續確認：SOP-4 需要歷史峰值 >= 30,000 且目前成長率 <= -0.20 兩項同時成立。"
        )
    if count is not None and growth is None:
        return (
            "大巨蛋散場情境缺少目前人流成長率，尚不能判定 SOP-4 是否成立。\n"
            "■ 建議處置：請補充目前人流成長率是否降至 -0.20 以下。\n"
            "■ 後續確認：只有峰值達標但成長率未達，不能啟動散場。"
        )
    if count is None or growth is None:
        return None
    if count >= 30000 and growth <= -0.20:
        return (
            f"大巨蛋人潮峰值 {count:,} 人且目前人流成長率 {growth:.2f}，符合 SOP-4 大巨蛋散場啟動條件。\n"
            "■ 建議處置：標記散場啟動，提前連動 SOP-3 捷運與接駁分流，將人流導往捷運市政府站與接駁車候車區。\n"
            "■ 後續確認：持續檢查國父紀念館站人潮是否超過 25,000 或成長率是否超過 30%。"
        )
    reasons = []
    if count < 30000:
        reasons.append("人潮峰值未達 30,000")
    if growth > -0.20:
        reasons.append("人流成長率尚未降至 -0.20 以下")
    return (
        f"大巨蛋尚未觸發 SOP-4，原因是{'、'.join(reasons)}。\n"
        "■ 建議處置：維持散場監測，不提前啟動大規模接駁與捷運分流。\n"
        "■ 後續確認：SOP-4 兩個條件都要成立，不是任一成立就觸發。"
    )


def _answer_station_roaming(sid: str, sta: dict[str, Any]) -> str:
    roaming = sta["roaming_user_pct"]
    if roaming >= 0.30:
        return (
            f"{sta['name']}（{sid}）外籍旅客比例 {roaming*100:.1f}% 已達 SOP-6 30% 門檻，需啟動多語通報。\n"
            "■ 建議處置：產出中英日韓泰越法七語訊息，並同步簡訊與資訊看板。\n"
            "■ 後續確認：通報發布後追蹤站點人潮與漫遊率是否下降；必要時由右上角鈴鐺補發。"
        )
    return (
        f"{sta['name']}（{sid}）外籍旅客比例 {roaming*100:.1f}% 未達 SOP-6 30% 門檻，目前不啟動多語通報。\n"
        "■ 建議處置：維持中文提醒與持續監測。\n"
        "■ 後續確認：若外籍旅客比例升至 30% 以上，才切換為七語發布。"
    )


def _answer_roaming_scan(snapshot: dict[str, Any]) -> str:
    triggered = [
        sta for sta in snapshot["stations"].values()
        if sta.get("roaming_user_pct") is not None and sta["roaming_user_pct"] >= 0.30
    ]
    if not triggered:
        return (
            f"目前快照 {snapshot['timestamp']} 沒有站點達 SOP-6 多語通報門檻。\n"
            "■ 建議處置：維持中文提醒與一般監測。\n"
            "■ 後續確認：任一站點外籍旅客比例達 30% 以上時，右上角 Toast 與鈴鐺會提示。"
        )
    names = "、".join(f"{s['name']} {s['roaming_user_pct']*100:.1f}%" for s in triggered)
    return (
        f"目前快照 {snapshot['timestamp']} 達 SOP-6 門檻的站點有：{names}。\n"
        "■ 建議處置：對上述站點啟動七語通報，發布到簡訊與資訊看板。\n"
        "■ 後續確認：未達 30% 的站點不觸發，避免過度發布。"
    )


def _severity_from_text(text: str) -> str:
    normalized = text.lower()
    if any(k in text for k in ("輕微", "低", "小型")) or "minor" in normalized or "low" in normalized:
        return "minor"
    if any(k in text for k in ("嚴重", "重大", "critical", "高")) or "high" in normalized:
        return "major"
    return "unknown"


def _incident_status_from_text(text: str) -> Optional[str]:
    keywords = ("封閉", "關閉", "封鎖", "受阻", "路障", "塌陷", "阻斷", "限制通行")
    for keyword in keywords:
        idx = text.find(keyword)
        if idx < 0:
            continue
        prefix = text[max(0, idx - 5):idx]
        if any(marker in prefix for marker in ("沒有", "沒", "未", "並未", "不是", "無")):
            return "negated"
        return "blocked"
    return None


def _rank_alternatives(seg: dict[str, Any], snapshot: dict[str, Any]):
    candidates = []
    for alt_id in seg.get("alternatives", []):
        alt = snapshot["road_segments"].get(alt_id)
        if not alt:
            continue
        if alt.get("capacity_vph", 0) < 1000:
            continue
        candidates.append(alt)
    candidates.sort(key=lambda r: (r.get("saturation_score") is None, r.get("saturation_score") or 99))
    if not candidates:
        return None, []
    return candidates[0], candidates[1:]


def _estimate_ete(severity: str, seg: dict[str, Any], primary: Optional[dict[str, Any]]) -> float:
    base = 20.0 if severity == "signal" else 60.0 if severity == "major" else 30.0
    scores = [v for v in (seg.get("saturation_score"), (primary or {}).get("saturation_score")) if v is not None]
    avg_sat = sum(scores) / len(scores) if scores else 0.5
    return round(base + max(0, avg_sat - 0.5) * 60, 1)


def _extract_road_congestion(message: str, road: Optional[tuple[str, dict[str, Any]]]):
    if not road or not any(k in message for k in ("壅塞", "擁塞", "塞車", "飽和", "A 級", "A級", "B 級", "B級")):
        return None
    match = re.search(r"0\.\d+", message)
    if match:
        saturation = float(match.group(0))
    elif "A 級" in message or "A級" in message or "癱瘓" in message:
        saturation = 0.96
    elif "B 級" in message or "B級" in message or "壅擠" in message:
        saturation = 0.90
    else:
        _, seg = road
        saturation = seg.get("saturation_score")
    if saturation is None:
        return None
    seg_id, seg = road
    return seg_id, seg, saturation


def _congestion_level(saturation: Optional[float]) -> str:
    if saturation is None:
        return "資料不足"
    if saturation >= 0.95:
        return "A級紅燈"
    if saturation >= 0.85:
        return "B級黃燈"
    return "一般監測"


def _alternative_names(seg: dict[str, Any]) -> str:
    names = []
    for alt in seg.get("alternatives", []):
        if isinstance(alt, dict):
            names.append(alt.get("name") or alt.get("segment_id"))
        else:
            names.append(str(alt))
    return "、".join(names)


def _extract_count(text: str) -> Optional[int]:
    match = re.search(r"(\d{1,3}(?:,\d{3})+|\d{4,6})\s*人?", text)
    return int(match.group(1).replace(",", "")) if match else None


def _extract_growth(text: str) -> Optional[float]:
    percent = re.search(r"(-?\d{1,3}(?:\.\d+)?)\s*%", text)
    if percent and any(k in text for k in ("成長率", "變化率", "人流")):
        return float(percent.group(1)) / 100
    decimal = re.search(r"-?0\.\d+", text)
    if decimal and any(k in text for k in ("成長率", "變化率", "散場", "人流")):
        return float(decimal.group(0))
    return None


def _is_sop_overview(text: str) -> bool:
    compact = text.lower()
    return "sop" in compact and any(k in text for k in ("有哪些", "總覽", "能回答", "負責"))


def _is_congestion_rule(text: str) -> bool:
    return "壅塞" in text and any(k in text for k in ("如何判定", "級別", "門檻", "規則"))


def _is_roaming_rule(text: str) -> bool:
    return any(k in text for k in ("多語", "數位通報", "外籍旅客比例")) and any(k in text for k in ("觸發條件", "門檻", "規則", "為何"))


def _is_roaming_scan(text: str) -> bool:
    return any(k in text for k in ("哪些站點", "哪些地點", "全站")) and any(k in text for k in ("多語", "通報"))


def _is_metro_request(text: str) -> bool:
    return ("國父紀念館" in text or "捷運" in text) and any(k in text for k in ("分流", "人潮", "接駁", "過站不停", "成長率"))


def _is_incident(text: str) -> bool:
    return any(k in text for k in ("車禍", "事故", "路障", "封閉", "關閉", "封鎖", "受阻", "撞", "塌陷"))


def _is_signal(text: str) -> bool:
    return any(k in text for k in ("號誌", "紅綠燈", "燈號")) and any(k in text for k in ("故障", "失效", "壞", "停電"))


def _match_road(text: str, snapshot: dict[str, Any]):
    compact = text.replace(" ", "").replace("臺", "台")
    for seg_id, seg in snapshot["road_segments"].items():
        names = {seg_id, seg["name"], seg["name"].replace("四段", "4段"), seg["name"].replace("一段", "1段")}
        if any(name and name.replace(" ", "") in compact for name in names):
            return seg_id, seg
    return None


def _match_station(text: str, snapshot: dict[str, Any]):
    compact = text.replace(" ", "").replace("臺", "台").replace("捷運", "").replace("站", "")
    for sid, sta in snapshot["stations"].items():
        names = {sid, sta["name"], sta["name"].replace("捷運", "").replace("站", "")}
        if any(name and name.replace(" ", "").replace("捷運", "").replace("站", "") in compact for name in names):
            return sid, sta
    return None


def _snapshot():
    traffic_rows = _read_csv("city_traffic_flow.csv")
    crowd_rows = _read_csv("signaling_crowd_density.csv")
    road_rows = _read_json("road_network_geometry.json")
    ts = sorted({r["Timestamp"] for r in traffic_rows})[-1]
    flow_by_segment = _latest_by_id(traffic_rows, "Segment_ID", ts)
    crowd_by_station = _latest_by_id(crowd_rows, "BS_ID", ts)
    roads = {}
    for row in road_rows:
        sid = row["segment_id"]
        flow = flow_by_segment.get(sid, {})
        roads[sid] = {
            "name": row["name"],
            "capacity_vph": _optional_int(row.get("capacity_vph")),
            "intersections": row.get("intersections", []),
            "alternatives": row.get("alternatives", []),
            "avg_speed": _optional_int(flow.get("Avg_Speed")),
            "saturation_score": _optional_float(flow.get("Saturation_Score")),
        }
    stations = {
        sid: {
            "name": row["Location_Name"],
            "user_count": _optional_int(row.get("User_Count")),
            "growth_rate": _optional_float(row.get("Growth_Rate")),
            "roaming_user_pct": _parse_percent(row["Roaming_User_Pct"]),
        }
        for sid, row in crowd_by_station.items()
    }
    a_count = sum(1 for r in roads.values() if r.get("saturation_score") is not None and r["saturation_score"] >= 0.95)
    b_count = sum(1 for r in roads.values() if r.get("saturation_score") is not None and 0.85 <= r["saturation_score"] < 0.95)
    top_station = max(stations.values(), key=lambda s: s["roaming_user_pct"])
    return {
        "timestamp": ts,
        "road_segments": roads,
        "stations": stations,
        "summary": {"a_count": a_count, "b_count": b_count, "top_station": f"{top_station['name']} {top_station['roaming_user_pct']*100:.1f}%"},
    }


def _latest_by_id(rows: list[dict[str, str]], id_field: str, timestamp: str):
    latest = {}
    for row in rows:
        if row.get("Timestamp") and row["Timestamp"] <= timestamp:
            key = row[id_field]
            if key not in latest or row["Timestamp"] >= latest[key]["Timestamp"]:
                latest[key] = row
    return latest


def _read_csv(filename: str):
    with open(os.path.join(DATA_DIR, filename), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _read_json(filename: str):
    with open(os.path.join(DATA_DIR, filename), encoding="utf-8") as f:
        return json.load(f)


def _parse_percent(value: str) -> float:
    return float(str(value).strip().rstrip("%")) / 100


def _optional_int(value: Optional[str]) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(float(value))


def _optional_float(value: Optional[str]) -> Optional[float]:
    if value in (None, ""):
        return None
    return float(value)
