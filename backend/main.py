"""
FastAPI application entry point — Module 2: Live Incident Response

啟動方式：
  uvicorn backend.main:app --reload --port 8002

API 文件（Swagger UI）：
  http://localhost:8002/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers.incidents import router as incidents_router

app = FastAPI(
    title="Module 2 — Live Incident Response",
    description=(
        "SOP 規則引擎 API：注入突發事件，60 秒內完成路網重規劃，"
        "輸出 List[TriggerDecision] 供各模組消費。"
    ),
    version="2.0.0",
)

# CORS：允許前端 dev server (Vite 預設 5173) 跨域存取
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(incidents_router)


@app.get("/health")
def health_check():
    return {"status": "ok", "module": "module2-incident-response"}
