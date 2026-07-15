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

const styles = {
  panel: {
    background: '#1a1d27',
    borderRadius: '12px',
    border: '1px solid #2e3141',
    overflow: 'hidden',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #2e3141',
  },
  tab: (active) => ({
    padding: '11px 20px',
    fontSize: '13px',
    fontWeight: active ? 700 : 400,
    color: active ? '#a29bfe' : '#8b90a7',
    background: active ? '#a29bfe12' : 'transparent',
    borderBottom: active ? '2px solid #a29bfe' : '2px solid transparent',
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.15s',
    flex: 1,
    textAlign: 'center',
  }),
  body: { padding: '18px' },
  sampleCard: (selected) => ({
    border: `1px solid ${selected ? '#a29bfe88' : '#2e3141'}`,
    borderRadius: '8px',
    padding: '12px 14px',
    marginBottom: '10px',
    cursor: 'pointer',
    background: selected ? '#a29bfe12' : '#ffffff05',
    transition: 'all 0.15s',
  }),
  sampleHeader: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '5px' },
  sampleId: { fontFamily: 'monospace', fontSize: '11px', color: '#a29bfe' },
  sampleType: {
    background: '#ffffff10',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '11px',
    color: '#8b90a7',
  },
  severityBadge: (sev) => ({
    background: sev === 'Critical' ? '#ff475722' : sev === 'High' ? '#ff6b8122' : '#ffd32a22',
    color: sev === 'Critical' ? '#ff4757' : sev === 'High' ? '#ff6b81' : '#ffd32a',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '11px',
    fontWeight: 700,
  }),
  sampleDesc: { fontSize: '12px', color: '#8b90a7', lineHeight: 1.4 },
  formRow: { marginBottom: '12px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  actions: { display: 'flex', gap: '10px', marginTop: '16px' },
  btnPrimary: { background: '#a29bfe', color: '#fff', flex: 1 },
  btnSecondary: { background: '#2e3141', color: '#e8eaf6', flex: 1 },
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

  if (error) return <div style={{ color: '#ff4757', padding: '16px' }}>載入失敗：{error}</div>

  return (
    <div>
      {samples.map(s => (
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
            <span style={styles.severityBadge(s.severity)}>{s.severity}</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#8b90a7' }}>
              {s.affected_segment}
            </span>
          </div>
          <div style={styles.sampleDesc}>{s.location}</div>
        </div>
      ))}
      <div style={styles.actions}>
        <button
          style={{ ...styles.btnPrimary, opacity: (!selected || loading) ? 0.4 : 1 }}
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
