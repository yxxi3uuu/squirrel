"""
戰情室前端 Server（整合所有模組 API）
啟動：cd squirrel && uvicorn warroom.server:app --reload --port 8000
瀏覽器開 http://localhost:8000
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os, sys
from typing import Optional
from dotenv import load_dotenv

# 確保 squirrel 根目錄在 path（讓 warroom.xxx 可以 import）
_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _root)
load_dotenv(os.path.join(_root, ".env"))

from warroom.module5.backend.routers import notify, signal
from warroom.routers import advisor, incidents, module1, traffic
from warroom.module2.backend.routers import incidents as _m2_incidents_module  # noqa: F401 — req 4.1 visibility
from warroom.module2.backend.routers.incidents import router as m2_incidents_router  # noqa: F401 — req 4.1
from warroom.routers import advisor, incidents, traffic
from warroom.routers import reasoning

app = FastAPI(title="Squirrel War Room")

# ── API Routers ───────────────────────────────────────────────────────────
app.include_router(signal.router,    prefix="/api/signal",    tags=["Signal (M5)"])
app.include_router(notify.router,    prefix="/api/notify",    tags=["Notify (M5)"])
app.include_router(traffic.router,   prefix="/api/traffic",   tags=["Traffic (M1)"])
app.include_router(incidents.router, prefix="/api/incidents",  tags=["Incidents (M2)"])
app.include_router(advisor.router,   prefix="/api/advisor",   tags=["Advisor (M3)"])
app.include_router(reasoning.router, prefix="/api/reasoning", tags=["Reasoning (M4)"])
# module-1-dynamicTS 動態時序儀表板：路徑沿用原本 module1_dashboard/frontend
# 的呼叫慣例（/api/timestamps、/api/snapshot、/api/history、/api/dashboard），
# 不掛在 /api/traffic 下，避免與既有 M1 前端呼叫的 /api/traffic/* 衝突。
app.include_router(module1.router,   prefix="/api",           tags=["Module1 (Dynamic Dashboard)"])

# ── 路徑 ──────────────────────────────────────────────────────────────────
_warroom = os.path.dirname(__file__)
_m5_frontend = os.path.join(_warroom, "module5", "frontend")


def _no_cache_file(path: str, media_type: Optional[str] = None):
    response = FileResponse(path, media_type=media_type)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response

# /static/ → module5 前端的 CSS/JS（iframe 裡的 /static/style.css 等）
app.mount("/static", StaticFiles(directory=_m5_frontend), name="m5-static")

# /m5/ → module5 前端 index.html
@app.get("/m5/")
@app.get("/m5")
def m5_index():
    return FileResponse(os.path.join(_m5_frontend, "index.html"))

# ── 戰情室主頁 ─────────────────────────────────────────────────────────────
@app.get("/")
def index():
    return _no_cache_file(os.path.join(_warroom, "index.html"))

@app.get("/style.css")
def warroom_css():
    return _no_cache_file(os.path.join(_warroom, "style.css"), media_type="text/css")

@app.get("/app.js")
def warroom_js():
    return _no_cache_file(os.path.join(_warroom, "app.js"), media_type="application/javascript")

@app.get("/health")
def health():
    return {"status": "ok", "modules": [1, 2, 3, 5]}
