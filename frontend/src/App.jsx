/**
 * App — Module 2: Live Incident Response
 *
 * 主頁面佈局：
 *   左欄 (380px)  — 事件注入面板 + SLA 計時器
 *   右欄 (flex)   — 決策卡片 (上) + 路段狀態表 (下)
 */

import React, { useCallback, useState } from 'react'
import { injectIncident } from './api/client'
import DecisionCard from './components/DecisionCard'
import IncidentInjectorPanel from './components/IncidentInjectorPanel'
import SegmentStatusTable from './components/SegmentStatusTable'
import SLATimer from './components/SLATimer'
import TrafficDashboard from './components/TrafficDashboard'

// ─── SVG Icons ───────────────────────────────────────────────────
const IconAlert = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

const IconMap = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" y1="3" x2="9" y2="18"/>
    <line x1="15" y1="6" x2="15" y2="21"/>
  </svg>
)

const TABS = [
  { id: 'incident', label: '事件處置', Icon: IconAlert },
  { id: 'traffic',  label: '交通地圖', Icon: IconMap },
]

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
  },
  tabBar: {
    display: 'flex',
    gap: '8px',
    padding: '12px 24px',
    borderBottom: '1px solid rgba(74, 158, 255, 0.15)',
    background: 'rgba(8, 12, 24, 0.72)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    alignItems: 'center',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '7px 20px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
    borderRadius: '999px',
    background: 'transparent',
    color: '#7a85a3',
    transition: 'all 0.18s',
    letterSpacing: '0.2px',
  },
  tabActive: {
    color: '#e2e8f8',
    background: 'rgba(74, 158, 255, 0.15)',
    border: '1px solid rgba(74, 158, 255, 0.45)',
    boxShadow: '0 0 14px rgba(74, 158, 255, 0.15)',
  },
  header: {
    padding: '14px 24px',
    borderBottom: '1px solid rgba(74, 158, 255, 0.12)',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    background: 'rgba(8, 12, 24, 0.80)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  },
  headerIcon: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'rgba(74, 158, 255, 0.15)',
    border: '1px solid rgba(74, 158, 255, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4a9eff',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e2e8f8',
  },
  headerSub: {
    fontSize: '12px',
    color: '#7a85a3',
    marginTop: '1px',
  },
  badge: {
    background: 'rgba(74, 158, 255, 0.12)',
    color: '#4a9eff',
    border: '1px solid rgba(74, 158, 255, 0.3)',
    borderRadius: '6px',
    padding: '3px 9px',
    fontSize: '11px',
    fontWeight: 700,
  },
  main: {
    flex: 1,
    display: 'flex',
    gap: '20px',
    padding: '20px 24px',
    alignItems: 'flex-start',
  },
  leftCol: {
    width: '380px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#7a85a3',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    marginBottom: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  errorBox: {
    background: 'rgba(255, 71, 87, 0.1)',
    border: '1px solid rgba(255, 71, 87, 0.3)',
    borderRadius: '8px',
    padding: '12px 16px',
    color: '#ff8fa3',
    fontSize: '13px',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
}

const IconSiren = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
    <line x1="12" y1="2" x2="12" y2="12"/>
  </svg>
)

export default function App() {
  const [activeTab, setActiveTab] = useState('incident')
  const [loading, setLoading] = useState(false)
  const [decisions, setDecisions] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [currentIncident, setCurrentIncident] = useState(null)
  const [error, setError] = useState(null)
  const [startTime, setStartTime] = useState(null)
  const [processingMs, setProcessingMs] = useState(null)

  const handleInject = useCallback(async (incident) => {
    setLoading(true)
    setError(null)
    setDecisions(null)
    setSnapshot(null)
    setCurrentIncident(null)
    setProcessingMs(null)
    setStartTime(Date.now())

    try {
      const result = await injectIncident(incident)
      setDecisions(result.decisions)
      setProcessingMs(result.processing_time_ms)
      setCurrentIncident(incident)
      setSnapshot(result.snapshot ?? null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const tabContent = activeTab === 'traffic'
    ? (
      <main style={{ flex: 1, padding: '20px 24px' }}>
        <TrafficDashboard />
      </main>
    )
    : (
      <main style={styles.main}>
        {/* Left: injection panel + timer */}
        <aside style={styles.leftCol} aria-label="事件注入控制面板">
          <div style={styles.sectionTitle}>事件注入</div>
          <IncidentInjectorPanel onInject={handleInject} loading={loading} />
          <SLATimer startTime={startTime} done={!loading && decisions !== null} processingMs={processingMs} />
          {error && (
            <div style={styles.errorBox} role="alert">
              <strong>注入失敗：</strong>{error}
            </div>
          )}
        </aside>

        {/* Right: decisions + segment table */}
        <div style={styles.rightCol}>
          <section aria-labelledby="decisions-title">
            <div style={styles.sectionTitle} id="decisions-title">
              SOP 決策結果
              {decisions && ` (${decisions.length} 筆)`}
            </div>
            <DecisionCard decisions={decisions} />
          </section>

          <section aria-labelledby="segments-title">
            <div style={styles.sectionTitle} id="segments-title">路段狀態總覽</div>
            <SegmentStatusTable
              segments={snapshot?.road_segments}
              decisions={decisions}
              incidentSegmentId={currentIncident?.affected_segment}
            />
          </section>
        </div>
      </main>
    )

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerIcon} aria-hidden="true">
          <IconSiren />
        </div>
        <div style={{ flex: 1 }}>
          <div style={styles.headerTitle}>模組2 突發事件注入與處置</div>
          <div style={styles.headerSub}>Live Incident Response — SOP 規則引擎</div>
        </div>
        <span style={styles.badge}>v2.0</span>
        {decisions && (
          <span
            style={{
              ...styles.badge,
              background: 'rgba(46, 213, 115, 0.12)',
              color: '#2ed573',
              borderColor: 'rgba(46, 213, 115, 0.3)',
              marginLeft: '8px',
            }}
          >
            {decisions.length} 筆決策
          </span>
        )}
      </header>

      {/* Tab bar — capsule buttons */}
      <div style={styles.tabBar} role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            style={{ ...styles.tab, ...(activeTab === id ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>

      {tabContent}
    </div>
  )
}
