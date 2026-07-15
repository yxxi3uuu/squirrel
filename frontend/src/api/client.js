/**
 * API client for Module 2 — Live Incident Response
 * All requests go to /api/incidents/* (proxied to FastAPI at :8002)
 */

const BASE = '/api/incidents'

/**
 * 注入一筆事件，回傳 { decisions: TriggerDecision[], processing_time_ms: number }
 */
export async function injectIncident(incident) {
  const res = await fetch(`${BASE}/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(incident),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * 取得 live_incidents.json 內建情境事件清單
 */
export async function getSamples() {
  const res = await fetch(`${BASE}/samples`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 取得目前已注入、尚未 resolve 的事件清單
 */
export async function getActiveIncidents() {
  const res = await fetch(`${BASE}/active`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 清除（resolve）一筆已處理事件
 */
export async function resolveIncident(eventId) {
  const res = await fetch(`${BASE}/${eventId}/resolve`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
