import React, { useState, useCallback } from 'react'
import TrafficMap from './TrafficMap'
import TimelineSlider from './TimelineSlider'
import CrowdPanel from './CrowdPanel'
import {
  TIME_STEPS, ROAD_SEGMENTS,
  getSegmentStateAt, STATUS_COLOR, STATUS_LABEL,
} from '../data/trafficData'

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '16px' },
  topRow: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  statCard: {
    flex: '1 1 120px',
    background: '#1a1d2e', border: '1px solid #2e3141',
    borderRadius: '10px', padding: '12px 16px',
  },
  statLabel: { fontSize: '11px', color: '#8b90a7', marginBottom: '4px' },
  statValue: { fontSize: '22px', fontWeight: 700, color: '#e8eaf6' },
  statSub: { fontSize: '11px', color: '#555c7a', marginTop: '2px' },
  mapRow: { display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' },
  mapCol: { flex: '1 1 500px', minWidth: 0 },
  sideCol: { width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' },
  segTable: {
    background: '#1a1d2e', border: '1px solid #2e3141',
    borderRadius: '10px', padding: '12px 16px', maxHeight: '440px', overflowY: 'auto',
  },
  segTitle: { fontSize: '11px', color: '#8b90a7', fontWeight: 700, textTransform: 'uppercase', marginBottom: '10px' },
  segRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '5px 0', borderBottom: '1px solid #1e2135',
    fontSize: '12px',
  },
  segDot: (color) => ({ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }),
  segName: { flex: 1, color: '#c8cde8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  segSpeed: { color: '#8b90a7', fontSize: '11px', width: '54px', textAlign: 'right' },
  segSat: (sat) => ({
    width: '40px', textAlign: 'right', fontSize: '11px',
    color: sat >= 0.95 ? '#ff4757' : sat >= 0.80 ? '#ffa502' : '#2ed573',
    fontWeight: 700,
  }),
}

export default function TrafficDashboard() {
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lang, setLang] = useState('zh')

  const togglePlay = useCallback(() => setPlaying(p => !p), [])
  const handleStep = useCallback((valOrFn) => setStepIndex(valOrFn), [])

  const currentTs = TIME_STEPS[stepIndex]
  const segState = getSegmentStateAt(currentTs)

  // 統計數字
  const allStates = Object.values(segState)
  const criticalCount = allStates.filter(s => ['Critical','Gridlock','Blocked'].includes(s.status)).length
  const congestedCount = allStates.filter(s => s.status === 'Congested').length
  const avgSpeed = allStates.length
    ? Math.round(allStates.reduce((a, b) => a + b.speed, 0) / allStates.length)
    : 0
  const maxSat = allStates.length
    ? Math.max(...allStates.map(s => s.sat))
    : 0

  return (
    <div style={s.wrap}>
      {/* 語言切換 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
        {['zh', 'en'].map(l => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              background: lang === l ? '#a29bfe33' : '#1a1d2e',
              border: `1px solid ${lang === l ? '#a29bfe66' : '#2e3141'}`,
              color: lang === l ? '#a29bfe' : '#8b90a7',
              borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
            }}
          >
            {l === 'zh' ? '中文' : 'EN'}
          </button>
        ))}
      </div>

      {/* 統計卡片 */}
      <div style={s.topRow}>
        <div style={s.statCard}>
          <div style={s.statLabel}>{lang === 'zh' ? '嚴重壅塞路段' : 'Critical Segments'}</div>
          <div style={{ ...s.statValue, color: criticalCount > 0 ? '#ff4757' : '#2ed573' }}>{criticalCount}</div>
          <div style={s.statSub}>{lang === 'zh' ? '路段' : 'segments'}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>{lang === 'zh' ? '壅塞路段' : 'Congested'}</div>
          <div style={{ ...s.statValue, color: congestedCount > 0 ? '#ffa502' : '#2ed573' }}>{congestedCount}</div>
          <div style={s.statSub}>{lang === 'zh' ? '路段' : 'segments'}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>{lang === 'zh' ? '平均車速' : 'Avg Speed'}</div>
          <div style={s.statValue}>{avgSpeed}</div>
          <div style={s.statSub}>km/h</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>{lang === 'zh' ? '最高飽和度' : 'Max Saturation'}</div>
          <div style={{ ...s.statValue, color: maxSat >= 0.95 ? '#ff4757' : maxSat >= 0.80 ? '#ffa502' : '#2ed573' }}>
            {Math.round(maxSat * 100)}%
          </div>
          <div style={s.statSub}>{lang === 'zh' ? '路段容量' : 'road capacity'}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>{lang === 'zh' ? '監測路段' : 'Monitored'}</div>
          <div style={s.statValue}>{allStates.length}</div>
          <div style={s.statSub}>{lang === 'zh' ? `共 ${ROAD_SEGMENTS.length} 段` : `of ${ROAD_SEGMENTS.length}`}</div>
        </div>
      </div>

      {/* 時間軸 */}
      <TimelineSlider
        stepIndex={stepIndex}
        onStepChange={handleStep}
        playing={playing}
        onPlayToggle={togglePlay}
      />

      {/* 地圖 + 側欄 */}
      <div style={s.mapRow}>
        <div style={s.mapCol}>
          <TrafficMap stepIndex={stepIndex} lang={lang} />
        </div>

        <div style={s.sideCol}>
          {/* 路段狀態列表 */}
          <div style={s.segTable}>
            <div style={s.segTitle}>{lang === 'zh' ? '路段即時狀態' : 'Segment Status'}</div>
            {ROAD_SEGMENTS.map(seg => {
              const st = segState[seg.segment_id]
              const color = st ? (STATUS_COLOR[st.status] || '#4a5175') : '#4a5175'
              return (
                <div key={seg.segment_id} style={s.segRow}>
                  <span style={s.segDot(color)} />
                  <span style={s.segName} title={seg.name}>{seg.name}</span>
                  <span style={s.segSpeed}>{st ? `${st.speed} km/h` : '—'}</span>
                  <span style={s.segSat(st?.sat ?? 0)}>
                    {st ? `${Math.round(st.sat * 100)}%` : '—'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 人流 + 事件 */}
          <CrowdPanel stepIndex={stepIndex} />
        </div>
      </div>
    </div>
  )
}
