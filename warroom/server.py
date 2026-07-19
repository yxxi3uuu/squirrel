"""
戰情室前端 Server（整合所有模組 API）
啟動：cd squirrel && uvicorn warroom.server:app --reload --port 8000
瀏覽器開 http://localhost:8000
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os, sys

# 確保 squirrel 根目錄在 path（讓 warroom.xxx 可以 import）
_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _root)

from warroom.module5.backend.routers import notify, signal
from warroom.routers import traffic, incidents

app = FastAPI(title="Squirrel War Room")

# ── API Routers ───────────────────────────────────────────────────────────
app.include_router(signal.router,    prefix="/api/signal",    tags=["Signal (M5)"])
app.include_router(notify.router,    prefix="/api/notify",    tags=["Notify (M5)"])
app.include_router(traffic.router,   prefix="/api/traffic",   tags=["Traffic (M1)"])
app.include_router(incidents.router, prefix="/api/incidents",  tags=["Incidents (M2)"])

# ── 路徑 ──────────────────────────────────────────────────────────────────
_warroom = os.path.dirname(__file__)
_m5_frontend = os.path.join(_warroom, "module5", "frontend")

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
    return FileResponse(os.path.join(_warroom, "index.html"))

@app.get("/style.css")
def warroom_css():
    return FileResponse(os.path.join(_warroom, "style.css"), media_type="text/css")

@app.get("/app.js")
def warroom_js():
    return FileResponse(os.path.join(_warroom, "app.js"), media_type="application/javascript")

@app.get("/health")
def health():
    return {"status": "ok", "modules": [1, 2, 5]}
