import React, { useEffect, useRef } from 'react'
import { TIME_STEPS } from '../data/trafficData'

// ─── Icons ────────────────────────────────────────────────────────
const IconPlay = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
)
const IconPause = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
  </svg>
)
const IconSkipBack = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)
const IconChevronLeft = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
)
const IconChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)

const s = {
  wrap: {
    background: 'rgba(14, 21, 37, 0.65)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: '1px solid rgba(74, 158, 255, 0.15)',
    borderRadius: '10px',
    padding: '14px 20px',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' },
  label: { fontSize: '12px', color: '#7a85a3', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' },
  time: {
    fontSize: '18px', fontWeight: 700, color: '#4a9eff',
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    display: 'flex', alignItems: 'center', gap: '6px',
  },
  controls: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' },
  btn: {
    background: 'rgba(30, 45, 74, 0.8)',
    border: '1px solid rgba(74,158,255,0.2)',
    borderRadius: '6px',
    color: '#c2cfe0',
    fontSize: '13px',
    padding: '5px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  btnActive: {
    background: 'rgba(74,158,255,0.15)',
    border: '1px solid rgba(74,158,255,0.45)',
    color: '#4a9eff',
  },
  slider: { width: '100%', accentColor: '#4a9eff', cursor: 'pointer' },
  ticks: {
    display: 'flex', justifyContent: 'space-between',
    marginTop: '4px',
  },
  tick: { fontSize: '10px', color: '#555c7a' },
  incidentDot: {
    display: 'inline-block', width: '7px', height: '7px',
    borderRadius: '50%', background: '#ff4757',
    boxShadow: '0 0 5px #ff4757',
    verticalAlign: 'middle',
  },
}

// 已知事件時間
const INCIDENT_TIMES = ['2026-05-20 22:10', '2026-05-20 22:20', '2026-05-20 22:30']

export default function TimelineSlider({ stepIndex, onStepChange, playing, onPlayToggle }) {
  const intervalRef = useRef(null)

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        onStepChange(prev => {
          if (prev >= TIME_STEPS.length - 1) {
            onPlayToggle()
            return prev
          }
          return prev + 1
        })
      }, 800)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [playing, onStepChange, onPlayToggle])

  const currentTs = TIME_STEPS[stepIndex]
  const hasIncident = INCIDENT_TIMES.includes(currentTs)

  // 展示用 tick 標籤（每隔幾個顯示一個）
  const tickEvery = Math.floor(TIME_STEPS.length / 6)
  const ticks = TIME_STEPS.filter((_, i) => i % tickEvery === 0 || i === TIME_STEPS.length - 1)

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.label}>時間軸回放</span>
        <span style={s.time}>
          {currentTs ? currentTs.split(' ')[1] : '--:--'}
          {hasIncident && (
            <span style={s.incidentDot} title="此時有事件發生" aria-label="有事件發生" />
          )}
        </span>
      </div>

      <div style={s.controls}>
        <button
          style={{ ...s.btn, ...(playing ? s.btnActive : {}) }}
          onClick={onPlayToggle}
          aria-label={playing ? '暫停' : '播放'}
        >
          {playing ? <IconPause /> : <IconPlay />}
          {playing ? '暫停' : '播放'}
        </button>
        <button
          style={s.btn}
          onClick={() => onStepChange(0)}
          aria-label="重置到開始"
        >
          <IconSkipBack />
          重置
        </button>
        <button
          style={s.btn}
          onClick={() => onStepChange(prev => Math.max(0, prev - 1))}
          aria-label="上一步"
        >
          <IconChevronLeft />
        </button>
        <button
          style={s.btn}
          onClick={() => onStepChange(prev => Math.min(TIME_STEPS.length - 1, prev + 1))}
          aria-label="下一步"
        >
          <IconChevronRight />
        </button>
        <span style={{ fontSize: '11px', color: '#555c7a', marginLeft: '4px' }}>
          {stepIndex + 1} / {TIME_STEPS.length}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={TIME_STEPS.length - 1}
        value={stepIndex}
        onChange={e => onStepChange(Number(e.target.value))}
        style={s.slider}
        aria-label="時間軸"
      />

      <div style={s.ticks}>
        {ticks.map(t => (
          <span key={t} style={s.tick}>{t.split(' ')[1]}</span>
        ))}
      </div>
    </div>
  )
}
