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

const TABS = [
  { id: 'incident', label: '🚨 事件處置' },
  { id: 'traffic',  label: '🗺️ 交通地圖' },
]

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: '0 24px',
    borderBottom: '1px solid #2e3141',
    background: '#141720',
  },
  tab: {
    padding: '10px 18px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: '#8b90a7',
    borderBottom: '2px solid transparent',
    transition: 'all 0.15s',
  },
  tabActive: {
    color: '#a29bfe',
    borderBottom: '2px solid #a29bfe',
  },
  header: {
    padding: '14px 24px',
    borderBottom: '1px solid #2e3141',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    background: '#141720',
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e8eaf6',
  },
  headerSub: {
    fontSize: '12px',
    color: '#8b90a7',
  },
  badge: {
    background: '#a29bfe22',
    color: '#a29bfe',
    border: '1px solid #a29bfe44',
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
    fontSize: '13px',
    fontWeight: 700,
    color: '#8b90a7',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    marginBottom: '10px',
  },
  errorBox: {
    background: '#ff475718',
    border: '1px solid #ff475744',
    borderRadius: '8px',
    padding: '12px 16px',
    color: '#ff8fa3',
    fontSize: '13px',
  },
}

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
      // Snapshot is not returned by the API; we store the incident for segment highlight
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
        <div>
          <div style={styles.headerTitle}>🚨 模組2 突發事件注入與處置</div>
          <div style={styles.headerSub}>Live Incident Response — SOP 規則引擎</div>
        </div>
        <span style={styles.badge}>v2.0</span>
        {decisions && (
          <span
            style={{
              ...styles.badge,
              background: '#2ed57322',
              color: '#2ed573',
              borderColor: '#2ed57344',
              marginLeft: '8px',
            }}
          >
            {decisions.length} 筆決策
          </span>
        )}
      </header>

      {/* Tab bar */}
      <div style={styles.tabBar} role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            style={{ ...styles.tab, ...(activeTab === tab.id ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabContent}
    </div>
  )
}
