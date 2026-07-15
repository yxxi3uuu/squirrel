/**
 * SLATimer — 注入後計時，顯示「XX 秒完成路網重規劃」
 *
 * Props:
 *   startTime: number | null   — Date.now() when injection started; null = idle
 *   done: boolean              — true when API response received
 *   processingMs: number | null — backend processing time from API response
 */

import React, { useEffect, useState } from 'react'

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 14px',
    background: 'rgba(14, 21, 37, 0.65)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderRadius: '8px',
    border: '1px solid rgba(74, 158, 255, 0.15)',
    fontSize: '13px',
  },
  dot: (done) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: done ? '#2ed573' : '#ffd32a',
    boxShadow: done ? '0 0 6px #2ed573' : '0 0 6px #ffd32a',
    flexShrink: 0,
  }),
  label: { color: '#8b90a7', marginRight: '4px' },
  time: (done, overSla) => ({
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    color: done ? '#2ed573' : overSla ? '#ff4757' : '#e8eaf6',
  }),
  badge: {
    marginLeft: '8px',
    background: '#2ed57322',
    color: '#2ed573',
    border: '1px solid #2ed57344',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '11px',
    fontWeight: 700,
  },
}

export default function SLATimer({ startTime, done, processingMs }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime || done) return
    const id = setInterval(() => {
      setElapsed(Date.now() - startTime)
    }, 100)
    return () => clearInterval(id)
  }, [startTime, done])

  if (!startTime) return null

  const displayMs = done && processingMs != null
    ? processingMs
    : elapsed

  const displaySec = (displayMs / 1000).toFixed(1)
  const overSla = displayMs > 60_000

  return (
    <div style={styles.wrapper} role="status" aria-live="polite">
      <div style={styles.dot(done)} aria-hidden="true" />
      <span style={styles.label}>路網重規劃</span>
      <span style={styles.time(done, overSla)}>
        {done ? `後端運算 ${processingMs?.toFixed(1)} ms` : `已耗時 ${displaySec} 秒`}
      </span>
      {done && !overSla && <span style={styles.badge}>✓ SLA 達標</span>}
      {done && overSla && (
        <span style={{ ...styles.badge, background: '#ff475722', color: '#ff4757', borderColor: '#ff475744' }}>
          ⚠ 超過 60 秒 SLA
        </span>
      )}
    </div>
  )
}
