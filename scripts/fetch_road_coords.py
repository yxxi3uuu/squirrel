"""維護工具：從 OpenStreetMap（Overpass API）抓路段的真實道路座標，
補進 warroom/data_source/road_coords.json，給地圖畫路線／站點標記用。

比賽資料量之後如果變多（新增路段/站點），流程是：
  1. 把新路段加進 warroom/data_source/road_network_geometry.json（segment_id + name）
  2. 執行本腳本：python scripts/fetch_road_coords.py
     -> 會自動找出 road_coords.json 裡「還沒有座標」的路段，
        照 name 去查 Overpass API，抓到座標後補進檔案（不會動到已經有的路段）。
  3. 新增的站點沒辦法用這個腳本自動抓（站點是我們自訂的基地台位置，不是 OSM 上
     有名字的實體），腳本只會列出目前缺座標的站點 ID，需要手動去
     road_coords.json 的 "stations" 補上概略經緯度（可以用 Google Maps 右鍵
     「這是哪裡」複製座標）。

用法：
  python scripts/fetch_road_coords.py                # 用預設的信義/大安區範圍
  python scripts/fetch_road_coords.py --bbox 25.00,121.53,25.07,121.60
  python scripts/fetch_road_coords.py --points 14    # 每條路抽稀成幾個節點（預設 11）
"""

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
GEOMETRY_PATH = ROOT_DIR / "warroom" / "data_source" / "road_network_geometry.json"
COORDS_PATH = ROOT_DIR / "warroom" / "data_source" / "road_coords.json"

DEFAULT_BBOX = "25.005,121.535,25.065,121.595"  # 信義/大安區，涵蓋目前 15 條路段範圍
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def overpass_query(road_name: str, bbox: str, timeout: int = 40) -> list:
    """查單一路名在 bbox 內的所有 way 幾何，回傳合併後的 [lat, lon] 清單（未排序/未抽稀）。"""
    query = f'[out:json][timeout:{timeout}];way["name"="{road_name}"]({bbox});out geom;'
    url = OVERPASS_URL + "?data=" + urllib.parse.quote(query)
    request = urllib.request.Request(url, headers={"User-Agent": "squirrel-warroom-coord-fetcher"})
    with urllib.request.urlopen(request, timeout=timeout + 10) as response:
        data = json.loads(response.read())

    points = []
    seen = set()
    for way in data.get("elements", []):
        for pt in way.get("geometry", []):
            key = (round(pt["lat"], 7), round(pt["lon"], 7))
            if key not in seen:
                seen.add(key)
                points.append([pt["lat"], pt["lon"]])
    return points


def downsample(points: list, target: int) -> list:
    """依緯度或經度（取變化範圍較大的那一軸）排序後等距抽稀，避免鋸齒狀折線。"""
    if len(points) <= target:
        return points
    lat_range = max(p[0] for p in points) - min(p[0] for p in points)
    lon_range = max(p[1] for p in points) - min(p[1] for p in points)
    axis = 0 if lat_range >= lon_range else 1
    points = sorted(points, key=lambda p: p[axis])
    step = (len(points) - 1) / (target - 1)
    idx = sorted({round(i * step) for i in range(target)})
    return [points[i] for i in idx]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bbox", default=DEFAULT_BBOX, help="south,west,north,east（預設信義/大安區）")
    parser.add_argument("--points", type=int, default=11, help="每條路折線抽稀成幾個節點（預設 11）")
    parser.add_argument("--force", action="store_true", help="連已經有座標的路段也重新查一次")
    args = parser.parse_args()

    geometry = json.loads(GEOMETRY_PATH.read_text(encoding="utf-8"))
    coords = json.loads(COORDS_PATH.read_text(encoding="utf-8")) if COORDS_PATH.exists() else {"stations": {}, "segments": {}}

    todo = [
        seg for seg in geometry
        if args.force or seg["segment_id"] not in coords["segments"]
    ]
    if not todo:
        print("所有路段都已經有座標了，沒有需要抓的（加 --force 可強制全部重抓）。")
        return
    for seg in todo:
        segment_id, name = seg["segment_id"], seg["name"]
        print(f"查詢 {segment_id}（{name}）...", end=" ", flush=True)
        try:
            raw_points = overpass_query(name, args.bbox)
        except Exception as exc:
            print(f"失敗：{exc}（可能是 Overpass 逾時/限流，稍後再跑一次即可，不影響已抓到的路段）")
            continue
        if not raw_points:
            print(f"查無資料 — OpenStreetMap 上可能沒有叫「{name}」的路，或不在指定 bbox 內，需要手動補座標。")
            continue
        coords["segments"][segment_id] = downsample(raw_points, args.points)
        print(f"OK（{len(raw_points)} 個原始節點 -> 抽稀成 {len(coords['segments'][segment_id])} 個）")
        time.sleep(1)  # 對公用 Overpass API 客氣一點，避免被限流

    missing_stations = [
        seg_name for seg in geometry
        for seg_name in seg.get("nearby_stations", [])
        if seg_name not in coords["stations"]
    ]
    if missing_stations:
        print(f"\n注意：以下站點沒有座標，OSM 查不到（不是真實地標），需要手動補到 "
              f"road_coords.json 的 \"stations\"：{sorted(set(missing_stations))}")

    COORDS_PATH.write_text(json.dumps(coords, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n已寫回 {COORDS_PATH.relative_to(ROOT_DIR)}")


if __name__ == "__main__":
    main()
