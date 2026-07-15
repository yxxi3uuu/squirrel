import React from 'react'
import { STATIONS, getCrowdStateAt, getActiveIncidents, TIME_STEPS } from '../data/trafficData'

const s = {
  wrap: {
    background: 'rgba(14, 21, 37, 0.65)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(74, 158, 255, 0.15)',
    borderRadius: '10px',
    padding: '14px 16px',
  },
  title: {
    fontSize: '11px', color: '#7a85a3', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' },
  card: {
    background: 'rgba(8, 12, 24, 0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: '8px',
    padding: '10px 12px',
    border: '1px solid rgba(74, 158, 255, 0.1)',
  },
  cardName: { fontSize: '11px', color: '#7a85a3', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardCount: { fontSize: '18px', fontWeight: 700, color: '#e2e8f8' },
  cardGrowth: (g) => ({
    fontSize: '11px', fontWeight: 700,
    color: g > 0.3 ? '#ff4757' : g > 0 ? '#ffa502' : '#2ed573',
  }),
  incidentSection: { marginTop: '14px' },
  incidentTitle: { fontSize: '11px', color: '#7a85a3', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
  incidentCard: (severity) => ({
    background: severity === 'Critical' ? 'rgba(255,71,87,0.07)' : severity === 'High' ? 'rgba(255,127,80,0.07)' : 'rgba(255,165,2,0.07)',
    border: `1px solid ${severity === 'Critical' ? 'rgba(255,71,87,0.3)' : severity === 'High' ? 'rgba(255,127,80,0.3)' : 'rgba(255,165,2,0.3)'}`,
    borderRadius: '8px', padding: '10px 12px', marginBottom: '6px',
  }),
  incidentType: (severity) => ({
    fontSize: '11px', fontWeight: 700,
    color: severity === 'Critical' ? '#ff4757' : severity === 'High' ? '#ff7f50' : '#ffa502',
    textTransform: 'uppercase', letterSpacing: '0.5px',
  }),
  incidentLoc: { fontSize: '12px', color: '#c8cde8', marginTop: '3px' },
  incidentDesc: { fontSize: '11px', color: '#666f87', marginTop: '4px', lineHeight: '1.4' },
  noData: { fontSize: '12px', color: '#555c7a', textAlign: 'center', padding: '12px 0' },
}

export default function CrowdPanel({ stepIndex }) {
  const currentTs = TIME_STEPS[stepIndex]
  const crowdState = getCrowdStateAt(currentTs)
  const activeIncidents = getActiveIncidents(currentTs)

  const stationsWithData = STATIONS.filter(st => crowdState[st.id])

  return (
    <div style={s.wrap}>
      <div style={s.title}>人流密度</div>

      {stationsWithData.length === 0 ? (
        <div style={s.noData}>此時間點無人流資料</div>
      ) : (
        <div style={s.grid}>
          {stationsWithData.map(st => {
            const cd = crowdState[st.id]
            const growthStr = cd.growth > 0
              ? `▲ ${(cd.growth * 100).toFixed(0)}%`
              : `▼ ${Math.abs(cd.growth * 100).toFixed(0)}%`
            return (
              <div key={st.id} style={s.card}>
                <div style={s.cardName}>{st.name}</div>
                <div style={s.cardCount}>{cd.count.toLocaleString()}</div>
                <div style={s.cardGrowth(cd.growth)}>{growthStr}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* 事件區塊 */}
      <div style={s.incidentSection}>
        <div style={s.incidentTitle}>
          目前事件 {activeIncidents.length > 0 && `(${activeIncidents.length})`}
        </div>
        {activeIncidents.length === 0 ? (
          <div style={s.noData}>此時間點無事件</div>
        ) : (
          activeIncidents.map(inc => (
            <div key={inc.event_id} style={s.incidentCard(inc.severity)}>
              <div style={s.incidentType(inc.severity)}>{inc.type.replace(/_/g, ' ')}</div>
              <div style={s.incidentLoc}>{inc.location}</div>
              <div style={s.incidentDesc}>{inc.description}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
