/**
 * IncidentInjectorPanel — 事件注入面板
 *
 * 分兩個 Tab：
 *   Tab 1：情境事件（從 /api/incidents/samples 載入，一鍵注入）
 *   Tab 2：自訂事件（表單填寫）
 *
 * Props:
 *   onInject(incident) — 父層處理注入邏輯
 *   loading: boolean
 */

import React, { useCallback, useEffect, useReducer, useState } from 'react'
import { getSamples } from '../api/client'

// ─── 初始表單狀態 ─────────────────────────────────────────────────
const INITIAL_FORM = {
  event_id: '',
  type: '',
  location: '',
  affected_segment: 'RD_TPE_001',
  affected_road: '',
  status: 'Closed',
  severity: 'High',
  description: '',
  timestamp: '2026-05-20 22:10',
}

const STATUS_OPTIONS = ['Closed', 'Blocked', 'Restricted', 'Caution', 'Open']
const SEVERITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical']

const severityColor = (sev) => {
  if (sev === 'Critical') return { bg: 'rgba(255,71,87,0.12)', color: '#ff4757', border: 'rgba(255,71,87,0.3)' }
  if (sev === 'High')     return { bg: 'rgba(255,107,129,0.12)', color: '#ff6b81', border: 'rgba(255,107,129,0.3)' }
  if (sev === 'Medium')   return { bg: 'rgba(255,211,42,0.12)', color: '#ffd32a', border: 'rgba(255,211,42,0.3)' }
  return { bg: 'rgba(74,158,255,0.10)', color: '#4a9eff', border: 'rgba(74,158,255,0.25)' }
}

const styles = {
  panel: {
    background: 'rgba(14, 21, 37, 0.65)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    borderRadius: '12px',
    border: '1px solid rgba(74, 158, 255, 0.15)',
    overflow: 'hidden',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(74, 158, 255, 0.12)',
  },
  tab: (active) => ({
    padding: '11px 20px',
    fontSize: '13px',
    fontWeight: active ? 700 : 400,
    color: active ? '#4a9eff' : '#7a85a3',
    background: active ? 'rgba(74, 158, 255, 0.08)' : 'transparent',
    borderBottom: active ? '2px solid #4a9eff' : '2px solid transparent',
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.15s',
    flex: 1,
    textAlign: 'center',
  }),
  body: { padding: '18px' },
  sampleCard: (selected) => ({
    border: `1px solid ${selected ? 'rgba(74,158,255,0.5)' : 'rgba(74,158,255,0.1)'}`,
    borderRadius: '10px',
    padding: '12px 14px',
    marginBottom: '10px',
    cursor: 'pointer',
    background: selected ? 'rgba(74, 158, 255, 0.1)' : 'rgba(255,255,255,0.03)',
    transition: 'all 0.15s',
    boxShadow: selected ? '0 0 12px rgba(74,158,255,0.12)' : 'none',
  }),
  sampleHeader: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '6px',
    flexWrap: 'wrap',
  },
  sampleId: {
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    fontSize: '11px',
    color: '#4a9eff',
    background: 'rgba(74,158,255,0.1)',
    padding: '1px 6px',
    borderRadius: '4px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  sampleType: {
    background: 'rgba(255,255,255,0.07)',
    borderRadius: '4px',
    padding: '2px 7px',
    fontSize: '11px',
    color: '#9aa5bf',
    maxWidth: '160px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sampleSegment: {
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    fontSize: '11px',
    color: '#7a85a3',
    background: 'rgba(255,255,255,0.05)',
    padding: '1px 6px',
    borderRadius: '4px',
    marginLeft: 'auto',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  sampleDesc: {
    fontSize: '12px',
    color: '#9aa5bf',
    lineHeight: 1.5,
    marginTop: '2px',
  },
  formRow: { marginBottom: '12px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  actions: { display: 'flex', gap: '10px', marginTop: '16px' },
  btnPrimary: {
    background: 'linear-gradient(135deg, #2979ff, #1565c0)',
    color: '#fff',
    flex: 1,
    border: '1px solid rgba(74,158,255,0.4)',
    boxShadow: '0 2px 12px rgba(41,121,255,0.25)',
    fontWeight: 600,
  },
  btnSecondary: {
    background: 'rgba(30, 45, 74, 0.8)',
    color: '#c2cfe0',
    flex: 1,
    border: '1px solid rgba(74,158,255,0.15)',
  },
}

// ─── Sample Tab ───────────────────────────────────────────────────
function SamplesTab({ onInject, loading }) {
  const [samples, setSamples] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getSamples()
      .then(setSamples)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <div style={{ color: '#ff4757', padding: '16px', fontSize: '13px' }}>載入失敗：{error}</div>

  const sc = selected ? severityColor(selected.severity) : null

  return (
    <div>
      {samples.map(s => {
        const sv = severityColor(s.severity)
        return (
          <div
            key={s.event_id}
            style={styles.sampleCard(selected?.event_id === s.event_id)}
            onClick={() => setSelected(s)}
            role="button"
            tabIndex={0}
            aria-pressed={selected?.event_id === s.event_id}
            onKeyDown={e => e.key === 'Enter' && setSelected(s)}
          >
            <div style={styles.sampleHeader}>
              <span style={styles.sampleId}>{s.event_id}</span>
              <span style={styles.sampleType}>{s.type}</span>
              {/* Severity badge */}
              <span style={{
                background: sv.bg,
                color: sv.color,
                border: `1px solid ${sv.border}`,
                borderRadius: '4px',
                padding: '1px 7px',
                fontSize: '11px',
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {s.severity}
              </span>
              {/* Segment ID — pushed to right, monospace, never overflows */}
              <span style={styles.sampleSegment}>{s.affected_segment}</span>
            </div>
            <div style={styles.sampleDesc}>{s.location}</div>
          </div>
        )
      })}
      <div style={styles.actions}>
        <button
          style={{ ...styles.btnPrimary, opacity: (!selected || loading) ? 0.45 : 1 }}
          disabled={!selected || loading}
          onClick={() => selected && onInject(selected)}
          aria-busy={loading}
        >
          {loading ? '注入中...' : '注入選取事件'}
        </button>
      </div>
    </div>
  )
}

// ─── Custom Form Tab ──────────────────────────────────────────────
function CustomFormTab({ onInject, loading }) {
  const [form, setForm] = useReducer(
    (state, patch) => ({ ...state, ...patch }),
    INITIAL_FORM
  )

  const handleChange = useCallback(e => {
    setForm({ [e.target.name]: e.target.value })
  }, [])

  const handleSubmit = e => {
    e.preventDefault()
    const incident = { ...form }
    if (!incident.affected_road) delete incident.affected_road
    onInject(incident)
  }

  const handleReset = () => setForm(INITIAL_FORM)

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={styles.formGrid}>
        <div style={styles.formRow}>
          <label htmlFor="event_id">事件 ID</label>
          <input
            id="event_id"
            name="event_id"
            required
            placeholder="TPE_2026_CUSTOM_001"
            value={form.event_id}
            onChange={handleChange}
          />
        </div>
        <div style={styles.formRow}>
          <label htmlFor="type">事件類型</label>
          <input
            id="type"
            name="type"
            required
            placeholder="Road_Collapse_Accident"
            value={form.type}
            onChange={handleChange}
          />
        </div>
      </div>

      <div style={styles.formRow}>
        <label htmlFor="location">地點描述</label>
        <input
          id="location"
          name="location"
          required
          placeholder="光復南路與忠孝東路口南側"
          value={form.location}
          onChange={handleChange}
        />
      </div>

      <div style={styles.formGrid}>
        <div style={styles.formRow}>
          <label htmlFor="affected_segment">affected_segment</label>
          <input
            id="affected_segment"
            name="affected_segment"
            required
            placeholder="RD_TPE_002"
            value={form.affected_segment}
            onChange={handleChange}
            style={{ fontFamily: "'Cascadia Code', 'Consolas', monospace" }}
          />
        </div>
        <div style={styles.formRow}>
          <label htmlFor="affected_road">affected_road（可選）</label>
          <input
            id="affected_road"
            name="affected_road"
            placeholder="RD_TPE_001"
            value={form.affected_road}
            onChange={handleChange}
            style={{ fontFamily: "'Cascadia Code', 'Consolas', monospace" }}
          />
        </div>
      </div>

      <div style={styles.formGrid}>
        <div style={styles.formRow}>
          <label htmlFor="status">status</label>
          <select id="status" name="status" value={form.status} onChange={handleChange}>
            {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div style={styles.formRow}>
          <label htmlFor="severity">severity</label>
          <select id="severity" name="severity" value={form.severity} onChange={handleChange}>
            {SEVERITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div style={styles.formRow}>
        <label htmlFor="timestamp">timestamp（YYYY-MM-DD HH:MM）</label>
        <input
          id="timestamp"
          name="timestamp"
          required
          placeholder="2026-05-20 22:10"
          value={form.timestamp}
          onChange={handleChange}
        />
      </div>

      <div style={styles.formRow}>
        <label htmlFor="description">事件描述</label>
        <textarea
          id="description"
          name="description"
          rows={3}
          required
          placeholder="描述事件詳情..."
          value={form.description}
          onChange={handleChange}
          style={{ resize: 'vertical' }}
        />
      </div>

      <div style={styles.actions}>
        <button type="submit" style={styles.btnPrimary} disabled={loading} aria-busy={loading}>
          {loading ? '注入中...' : '送出自訂事件'}
        </button>
        <button type="button" style={styles.btnSecondary} onClick={handleReset}>
          重置表單
        </button>
      </div>
    </form>
  )
}

// ─── Main export ─────────────────────────────────────────────────
export default function IncidentInjectorPanel({ onInject, loading }) {
  const [tab, setTab] = useState('samples')

  return (
    <div style={styles.panel}>
      <div style={styles.tabs} role="tablist" aria-label="事件注入方式">
        <button
          style={styles.tab(tab === 'samples')}
          onClick={() => setTab('samples')}
          role="tab"
          aria-selected={tab === 'samples'}
          id="tab-samples"
          aria-controls="panel-samples"
        >
          情境事件
        </button>
        <button
          style={styles.tab(tab === 'custom')}
          onClick={() => setTab('custom')}
          role="tab"
          aria-selected={tab === 'custom'}
          id="tab-custom"
          aria-controls="panel-custom"
        >
          自訂事件
        </button>
      </div>

      <div
        style={styles.body}
        role="tabpanel"
        id={tab === 'samples' ? 'panel-samples' : 'panel-custom'}
        aria-labelledby={tab === 'samples' ? 'tab-samples' : 'tab-custom'}
      >
        {tab === 'samples'
          ? <SamplesTab onInject={onInject} loading={loading} />
          : <CustomFormTab onInject={onInject} loading={loading} />
        }
      </div>
    </div>
  )
}
