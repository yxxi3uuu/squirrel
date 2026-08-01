"""Server smoke tests：確保 server 能啟動、關鍵頁面/API 有回應、彈窗預設是收合狀態。

執行方式（於 repo 根目錄）：
    pytest warroom/tests/test_smoke.py -v

這不是完整的功能測試，只確保「這次改動沒有讓整個 server 掛掉」的最低限度保護網，
主要是為了在下次 merge 衝突解決後，能自動抓到像 style.css/app.js 開關機制對不起來
（`.hidden` vs `.open` 混用）這種曾經發生過、會讓整個畫面點不了的回歸問題。
"""

import pytest
from fastapi.testclient import TestClient

from warroom.server import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_index_page_serves():
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]


@pytest.mark.parametrize("elem_id", ["drawer", "drawer-backdrop"])
def test_modals_are_closed_by_default(elem_id):
    """回歸測試：drawer/drawer-backdrop 預設一定要帶 hidden class，
    不然背景遮罩會蓋滿整個畫面、擋住所有點擊（這次真的發生過一次）。"""
    html = client.get("/").text
    idx = html.index(f'id="{elem_id}"')
    tag_snippet = html[idx: idx + 200]
    assert 'class="' in tag_snippet
    class_attr = tag_snippet.split('class="', 1)[1].split('"', 1)[0]
    assert "hidden" in class_attr.split(), f'#{elem_id} 預設沒有 hidden class：{class_attr!r}'


def test_static_assets_serve():
    css = client.get("/style.css")
    js = client.get("/app.js")
    assert css.status_code == 200
    assert js.status_code == 200
    assert len(css.text) > 0
    assert len(js.text) > 0


def test_module1_timestamps_and_dashboard():
    ts_res = client.get("/api/timestamps")
    assert ts_res.status_code == 200
    timestamps = ts_res.json()
    assert len(timestamps) > 0

    dash_res = client.get("/api/dashboard", params={"timestamp": timestamps[-1]})
    assert dash_res.status_code == 200
    body = dash_res.json()
    for key in ["timestamp", "snapshot", "triggers", "newly_triggered"]:
        assert key in body


def test_traffic_segments_and_coords():
    seg_res = client.get("/api/traffic/segments")
    assert seg_res.status_code == 200
    assert seg_res.json()["summary"]["total"] == 15

    coords_res = client.get("/api/traffic/coords")
    assert coords_res.status_code == 200
    coords = coords_res.json()
    assert len(coords["stations"]) == 9
    assert len(coords["segments"]) == 15


def test_signal_stations_and_triggered():
    stations_res = client.get("/api/signal/stations")
    assert stations_res.status_code == 200
    assert "stations" in stations_res.json()

    triggered_res = client.get("/api/signal/triggered")
    assert triggered_res.status_code == 200
    assert "triggered" in triggered_res.json()


def test_advisor_status():
    res = client.get("/api/advisor/status")
    assert res.status_code == 200
