/**
 * SegmentStatusTable — 顯示所有路段目前飽和度 + 本次事件標記
 *
 * Props:
 *   snapshot: TrafficSnapshot dict (from /api 或直接傳入)
 *   decisions: TriggerDecision[]
 *   incidentSegmentId: string | null
 */

import React from 'react'

const LEVEL_STYLE = {
  Gridlock:       { bg: '#ff4757', text: '#fff',    label: '格狀堵塞' },
  Critical:       { bg: '#ff475799', text: '#fff',  label: '嚴重壅塞' },
  Accident_Impact:{ bg: '#ff6b81', text: '#fff',    label: '事故影響' },
  Congested:      { bg: '#ffd32a', text: '#000',    label: '壅塞'     },
  Blocked:        { bg: '#a29bfe', text: '#fff',    label: '封閉'     },
  Partial_Open:   { bg: '#fdcb6e', text: '#000',    label: '部分開放' },
  Normal:         { bg: '#2ed573', text: '#000',    label: '正常'     },
}

function satColor(sat) {
  if (sat == null) return '#636e72'
  if (sat >= 0.95) return '#ff4757'
  if (sat >= 0.85) return '#ffd32a'
  return '#2ed573'
}

function roleLabel(segId, incidentSegId, decisions) {
  if (!decisions || !incidentSegId) return null
  if (segId === incidentSegId) return { label: '事故路段', color: '#ff4757' }

  const sop2 = decisions.find(d => d.sop_clause === 'SOP-2')
  if (sop2) {
    if (segId === sop2.primary_route) return { label: '主疏散', color: '#2ed573' }
    if (sop2.secondary_routes?.includes(segId)) return { label: '次要疏散', color: '#70a1ff' }
    if (sop2.excluded_routes?.some(r => r.segment_id === segId)) {
      return { label: '已排除', color: '#636e72' }
    }
  }
  return null
}

const styles = {
  wrapper: {
    overflowX: 'auto',
    borderRadius: '10px',
    border: '1px solid rgba(74, 158, 255, 0.12)',
    background: 'rgba(14, 21, 37, 0.65)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  th: {
    background: 'rgba(8, 12, 24, 0.7)',
    color: '#7a85a3',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '9px 12px',
    textAlign: 'left',
    borderBottom: '1px solid rgba(74, 158, 255, 0.1)',
    whiteSpace: 'nowrap',
    fontSize: '11px',
  },
  td: (highlighted) => ({
    padding: '8px 12px',
    borderBottom: '1px solid rgba(14, 21, 37, 0.8)',
    background: highlighted ? 'rgba(74,158,255,0.05)' : 'transparent',
    verticalAlign: 'middle',
  }),
  satBar: (sat) => ({
    display: 'inline-block',
    width: `${Math.round((sat || 0) * 60)}px`,
    height: '6px',
    borderRadius: '3px',
    background: satColor(sat),
    marginRight: '6px',
    verticalAlign: 'middle',
  }),
  satText: (sat) => ({
    color: satColor(sat),
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  }),
}

export default function SegmentStatusTable({ segments, decisions, incidentSegmentId }) {
  if (!segments) {
    return (
      <div style={{ color: '#636e72', padding: '24px', textAlign: 'center' }}>
        尚無快照資料
      </div>
    )
  }

  const entries = Object.entries(segments)

  return (
    <div style={styles.wrapper}>
      <table style={styles.table} role="table" aria-label="路段狀態總覽">
        <thead>
          <tr>
            <th style={styles.th}>路段 ID</th>
            <th style={styles.th}>名稱</th>
            <th style={styles.th}>飽和度</th>
            <th style={styles.th}>車速 (km/h)</th>
            <th style={styles.th}>車輛數</th>
            <th style={styles.th}>車道狀態</th>
            <th style={styles.th}>本次事件角色</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([segId, seg]) => {
            const role = roleLabel(segId, incidentSegmentId, decisions)
            const highlighted = !!role
            const laneStyle = LEVEL_STYLE[seg.lane_status] || {}
            const sat = seg.saturation_score

            return (
              <tr key={segId}>
                <td style={styles.td(highlighted)}>
                  <code style={{ color: '#4a9eff', fontSize: '11px', fontFamily: "'Cascadia Code', 'Consolas', monospace" }}>{segId}</code>
                </td>
                <td style={styles.td(highlighted)}>{seg.name}</td>
                <td style={styles.td(highlighted)}>
                  <span style={styles.satBar(sat)} aria-hidden="true" />
                  <span style={styles.satText(sat)}>
                    {sat != null ? sat.toFixed(2) : '—'}
                  </span>
                </td>
                <td style={styles.td(highlighted)}>
                  {seg.avg_speed != null ? seg.avg_speed : '—'}
                </td>
                <td style={styles.td(highlighted)}>
                  {seg.vehicle_count != null ? seg.vehicle_count.toLocaleString() : '—'}
                </td>
                <td style={styles.td(highlighted)}>
                  {seg.lane_status ? (
                    <span
                      style={{
                        background: laneStyle.bg || '#2e3141',
                        color: laneStyle.text || '#8b90a7',
                        borderRadius: '4px',
                        padding: '2px 7px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {laneStyle.label || seg.lane_status}
                    </span>
                  ) : '—'}
                </td>
                <td style={styles.td(highlighted)}>
                  {role ? (
                    <span
                      style={{
                        color: role.color,
                        fontWeight: 700,
                        fontSize: '11px',
                        background: `${role.color}18`,
                        borderRadius: '4px',
                        padding: '2px 7px',
                      }}
                    >
                      {role.label}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
