"""
戰情室前端 Server（整合 Module 5 API）
啟動：uvicorn warroom.server:app --reload --port 8000
瀏覽器開 http://localhost:8000
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os, sys

# 確保專案根目錄在 path 上（讓 module5 可以 import）
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from module5.backend.routers import notify, signal

app = FastAPI(title="Squirrel War Room")

# ── 掛載 Module 5 API ─────────────────────────────────────────────────────
app.include_router(signal.router, prefix="/api/signal", tags=["Signal"])
app.include_router(notify.router, prefix="/api/notify", tags=["Notify"])

# ── 靜態檔案 ───────────────────────────────────────────────────────────────
_dir = os.path.dirname(__file__)
_module5_frontend = os.path.join(_dir, "..", "module5", "frontend")

# Module 5 前端 serve 在 /module5/ 路徑下
app.mount("/module5", StaticFiles(directory=_module5_frontend, html=True), name="module5")

# 戰情室主頁
app.mount("/static", StaticFiles(directory=_dir), name="warroom-static")

@app.get("/")
def index():
    return FileResponse(os.path.join(_dir, "index.html"))

@app.get("/style.css")
def css():
    return FileResponse(os.path.join(_dir, "style.css"), media_type="text/css")

@app.get("/app.js")
def js():
    return FileResponse(os.path.join(_dir, "app.js"), media_type="application/javascript")

@app.get("/health")
def health():
    return {"status": "ok", "modules": [5]}
