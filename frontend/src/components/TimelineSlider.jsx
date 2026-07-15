import React, { useEffect, useRef } from 'react'
import { TIME_STEPS } from '../data/trafficData'

const s = {
  wrap: {
    background: '#1a1d2e',
    border: '1px solid #2e3141',
    borderRadius: '10px',
    padding: '14px 20px',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' },
  label: { fontSize: '12px', color: '#8b90a7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' },
  time: { fontSize: '18px', fontWeight: 700, color: '#a29bfe', fontFamily: 'monospace' },
  controls: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
  btn: {
    background: '#2e3141', border: '1px solid #3a3f5c', borderRadius: '6px',
    color: '#e8eaf6', fontSize: '13px', padding: '5px 12px', cursor: 'pointer',
  },
  btnActive: {
    background: '#a29bfe33', border: '1px solid #a29bfe66',
    color: '#a29bfe',
  },
  slider: { width: '100%', accentColor: '#a29bfe', cursor: 'pointer' },
  ticks: {
    display: 'flex', justifyContent: 'space-between',
    marginTop: '4px',
  },
  tick: { fontSize: '10px', color: '#555c7a' },
  incidentDot: {
    display: 'inline-block', width: '8px', height: '8px',
    borderRadius: '50%', background: '#ff4757', marginLeft: '6px',
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
          {hasIncident && <span style={s.incidentDot} title="此時有事件發生" />}
        </span>
      </div>

      <div style={s.controls}>
        <button
          style={{ ...s.btn, ...(playing ? s.btnActive : {}) }}
          onClick={onPlayToggle}
          aria-label={playing ? '暫停' : '播放'}
        >
          {playing ? '⏸ 暫停' : '▶ 播放'}
        </button>
        <button
          style={s.btn}
          onClick={() => onStepChange(0)}
          aria-label="重置到開始"
        >
          ⏮ 重置
        </button>
        <button
          style={s.btn}
          onClick={() => onStepChange(prev => Math.max(0, prev - 1))}
          aria-label="上一步"
        >
          ◀
        </button>
        <button
          style={s.btn}
          onClick={() => onStepChange(prev => Math.min(TIME_STEPS.length - 1, prev + 1))}
          aria-label="下一步"
        >
          ▶
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
