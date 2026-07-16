"""
模組 5 — 多語化全通路通報  FastAPI Backend
啟動：uvicorn module5.backend.main:app --reload --port 8005
Swagger：http://localhost:8005/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from module5.backend.routers import notify, signal

app = FastAPI(title="模組5 多語化通報 API", version="1.0.0")

# ── CORS（允許前端 localhost 呼叫）────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 掛載前端靜態檔案 ──────────────────────────────────────────────────────────
_frontend = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=_frontend), name="static")

@app.get("/", include_in_schema=False)
def serve_index():
    return FileResponse(os.path.join(_frontend, "index.html"))

# ── 掛載 Router ───────────────────────────────────────────────────────────────
app.include_router(signal.router,  prefix="/api/signal",  tags=["Signal"])
app.include_router(notify.router,  prefix="/api/notify",  tags=["Notify"])

@app.get("/health")
def health():
    return {"status": "ok", "module": "5"}
