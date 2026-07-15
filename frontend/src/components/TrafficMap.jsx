import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ROAD_SEGMENTS, STATIONS, TIME_STEPS,
  getSegmentStateAt, getCrowdStateAt, getActiveIncidents,
  STATUS_COLOR, STATUS_LABEL,
} from '../data/trafficData'

// ── 地圖中心（信義區）
const CENTER = [25.0390, 121.5640]
const ZOOM = 15

// ── 底圖 tile URL
const TILE_LAYERS = {
  schematic: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OSM</a>',
    label: '示意圖',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    label: '衛星圖',
  },
}

// ── 捷運站圖示
const mrtIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#00cec9;border:2px solid #fff;
    box-shadow:0 0 6px #00cec9aa;
  "></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
})

const venueIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:12px;height:12px;border-radius:3px;
    background:#fd79a8;border:2px solid #fff;
    box-shadow:0 0 5px #fd79a8aa;
  "></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6],
})

const busIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:12px;height:12px;border-radius:50%;
    background:#fdcb6e;border:2px solid #fff;
    box-shadow:0 0 5px #fdcb6eaa;
  "></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6],
})

const incidentIcon = (severity) => L.divIcon({
  className: '',
  html: `<div style="
    width:20px;height:20px;border-radius:50%;
    background:${severity === 'Critical' ? '#ff4757' : severity === 'High' ? '#ff7f50' : '#ffa502'};
    border:2px solid #fff;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;line-height:20px;text-align:center;
    box-shadow:0 0 10px ${severity === 'Critical' ? '#ff4757' : '#ffa502'}88;
    animation: pulse 1.5s infinite;
  ">⚠</div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
})

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '12px' },
  mapContainer: {
    position: 'relative',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #2e3141',
    height: '480px',
  },
  mapEl: { width: '100%', height: '100%' },
  toggleGroup: {
    position: 'absolute', top: '12px', right: '12px', zIndex: 1000,
    display: 'flex', gap: '4px',
  },
  toggleBtn: {
    padding: '5px 12px', fontSize: '12px', fontWeight: 700,
    border: '1px solid #2e3141', borderRadius: '6px',
    cursor: 'pointer', transition: 'all 0.2s',
    background: '#141720cc', color: '#8b90a7',
    backdropFilter: 'blur(4px)',
  },
  toggleBtnActive: {
    background: '#a29bfedd', color: '#fff', borderColor: '#a29bfe',
  },
  legend: {
    background: '#1a1d2e', border: '1px solid #2e3141', borderRadius: '10px',
    padding: '12px 16px',
  },
  legendTitle: { fontSize: '11px', color: '#8b90a7', fontWeight: 700, textTransform: 'uppercase', marginBottom: '10px' },
  legendGrid: { display: 'flex', flexWrap: 'wrap', gap: '8px 20px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#c8cde8' },
  legendDot: (color) => ({
    width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0,
  }),
  legendLine: (color) => ({
    width: '24px', height: '4px', borderRadius: '2px', background: color, flexShrink: 0,
  }),
}

export default function TrafficMap({ stepIndex, lang = 'zh' }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const tileLayerRef = useRef(null)
  const segmentLayersRef = useRef({})
  const stationLayersRef = useRef({})
  const incidentLayersRef = useRef([])
  const popupRef = useRef(null)
  const mapReadyRef = useRef(false)   // true 只在初始化完成後
  const [mapMode, setMapMode] = useState('schematic')

  const currentTs = TIME_STEPS[stepIndex]
  const segState = getSegmentStateAt(currentTs)
  const crowdState = getCrowdStateAt(currentTs)
  const activeIncidents = getActiveIncidents(currentTs)

  // ── 初始化地圖（只跑一次）
  useEffect(() => {
    if (mapInstanceRef.current) return
    const map = L.map(mapRef.current, {
      center: CENTER, zoom: ZOOM,
      zoomControl: true,
      attributionControl: true,
    })

    // 預設底圖
    const tile = L.tileLayer(TILE_LAYERS.schematic.url, {
      attribution: TILE_LAYERS.schematic.attribution,
      maxZoom: 19,
    }).addTo(map)
    tileLayerRef.current = tile

    // ── 路段 polyline
    ROAD_SEGMENTS.forEach(seg => {
      const line = L.polyline(seg.coords, {
        color: '#4a5175', weight: 5, opacity: 0.7,
      }).addTo(map)
      line.bindPopup('', { maxWidth: 280 })
      segmentLayersRef.current[seg.segment_id] = line
    })

    // ── 站點 marker
    STATIONS.forEach(st => {
      const icon = st.type === 'mrt' ? mrtIcon : st.type === 'bus' ? busIcon : venueIcon
      const marker = L.marker(st.coords, { icon }).addTo(map)
      marker.bindPopup(`<div style="font-family:sans-serif;min-width:140px">
        <b style="font-size:13px">${st.name}</b>
        <div style="font-size:11px;color:#888;margin-top:4px">
          ${st.type === 'mrt' ? '🚇 捷運站' : st.type === 'bus' ? '🚌 公車轉運站' : '🏢 地標'}
        </div>
      </div>`)
      stationLayersRef.current[st.id] = marker
    })

    mapInstanceRef.current = map
    mapReadyRef.current = true
    return () => { map.remove(); mapInstanceRef.current = null; mapReadyRef.current = false }
  }, [])

  // ── 切換底圖
  useEffect(() => {
    if (!mapReadyRef.current || !mapInstanceRef.current || !tileLayerRef.current) return
    const map = mapInstanceRef.current
    map.removeLayer(tileLayerRef.current)
    const cfg = TILE_LAYERS[mapMode]
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution, maxZoom: 19,
    }).addTo(map)
    tileLayerRef.current.setZIndex(0)
    // polyline 有 bringToFront；marker 用 setZIndexOffset
    Object.values(segmentLayersRef.current).forEach(l => {
      if (typeof l.bringToFront === 'function') l.bringToFront()
    })
    Object.values(stationLayersRef.current).forEach(l => {
      if (typeof l.setZIndexOffset === 'function') l.setZIndexOffset(200)
    })
  }, [mapMode])

  // ── 更新路段顏色與 popup
  useEffect(() => {
    if (!mapInstanceRef.current) return
    ROAD_SEGMENTS.forEach(seg => {
      const line = segmentLayersRef.current[seg.segment_id]
      if (!line) return
      const state = segState[seg.segment_id]
      const color = state ? (STATUS_COLOR[state.status] || '#4a5175') : '#4a5175'
      const weight = state ? (state.sat >= 0.95 ? 8 : state.sat >= 0.80 ? 6 : 5) : 5
      line.setStyle({ color, weight, opacity: 0.9 })

      const satPct = state ? Math.round(state.sat * 100) : '—'
      const statusZh = state ? (STATUS_LABEL[state.status] || state.status) : '無資料'
      const altList = seg.alternatives.join('、') || '—'
      line.setPopupContent(`
        <div style="font-family:sans-serif;min-width:200px">
          <b style="font-size:14px">${seg.name}</b>
          <div style="margin:6px 0;padding:4px 8px;border-radius:4px;background:${color}22;border-left:3px solid ${color}">
            <span style="color:${color};font-weight:700">${statusZh}</span>
          </div>
          <table style="font-size:12px;width:100%;border-collapse:collapse">
            <tr><td style="color:#888;padding:2px 0">飽和度</td><td style="text-align:right;font-weight:700">${satPct}%</td></tr>
            <tr><td style="color:#888;padding:2px 0">平均速度</td><td style="text-align:right">${state?.speed ?? '—'} km/h</td></tr>
            <tr><td style="color:#888;padding:2px 0">車輛數</td><td style="text-align:right">${state?.count?.toLocaleString() ?? '—'}</td></tr>
            <tr><td style="color:#888;padding:2px 0">容量</td><td style="text-align:right">${seg.capacity_vph.toLocaleString()} vph</td></tr>
            <tr><td style="color:#888;padding:2px 0">方向</td><td style="text-align:right">${seg.flow_direction}</td></tr>
          </table>
          ${seg.alternatives.length ? `<div style="font-size:11px;color:#aaa;margin-top:6px">替代路段：${altList}</div>` : ''}
        </div>
      `)
    })
  }, [segState, currentTs])

  // ── 更新人流 popup
  useEffect(() => {
    if (!mapInstanceRef.current) return
    STATIONS.forEach(st => {
      const marker = stationLayersRef.current[st.id]
      if (!marker) return
      const cd = crowdState[st.id]
      if (!cd) return
      const growthStr = cd.growth > 0 ? `+${(cd.growth * 100).toFixed(0)}%` : `${(cd.growth * 100).toFixed(0)}%`
      const growthColor = cd.growth > 0.3 ? '#ff4757' : cd.growth > 0 ? '#ffa502' : '#2ed573'
      marker.setPopupContent(`
        <div style="font-family:sans-serif;min-width:160px">
          <b style="font-size:13px">${st.name}</b>
          <table style="font-size:12px;width:100%;border-collapse:collapse;margin-top:6px">
            <tr><td style="color:#888">人數</td><td style="text-align:right;font-weight:700">${cd.count.toLocaleString()}</td></tr>
            <tr><td style="color:#888">成長率</td><td style="text-align:right;color:${growthColor}">${growthStr}</td></tr>
          </table>
        </div>
      `)
    })
  }, [crowdState])

  // ── 更新事件標記
  useEffect(() => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current
    // 清除舊的
    incidentLayersRef.current.forEach(m => map.removeLayer(m))
    incidentLayersRef.current = []
    // 加新的
    activeIncidents.forEach(inc => {
      if (!inc.coords) return
      const marker = L.marker(inc.coords, { icon: incidentIcon(inc.severity), zIndexOffset: 1000 }).addTo(map)
      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:220px">
          <div style="font-size:11px;color:#ff4757;font-weight:700;text-transform:uppercase;margin-bottom:4px">${inc.type.replace(/_/g,' ')}</div>
          <b style="font-size:13px">${inc.location}</b>
          <div style="font-size:11px;color:#aaa;margin-top:6px">${inc.description}</div>
          <div style="margin-top:6px;font-size:11px">
            <span style="background:#ff475722;color:#ff4757;padding:2px 6px;border-radius:4px;border:1px solid #ff475744">${inc.severity}</span>
            <span style="background:#2f354222;color:#aaa;padding:2px 6px;border-radius:4px;border:1px solid #2f354244;margin-left:4px">${inc.status}</span>
          </div>
        </div>
      `, { maxWidth: 260 })
      incidentLayersRef.current.push(marker)
    })
  }, [activeIncidents])

  return (
    <div style={s.wrap}>
      {/* 地圖容器 */}
      <div style={s.mapContainer}>
        <div ref={mapRef} style={s.mapEl} />
        {/* 底圖切換按鈕 */}
        <div style={s.toggleGroup}>
          {Object.entries(TILE_LAYERS).map(([key, cfg]) => (
            <button
              key={key}
              style={{ ...s.toggleBtn, ...(mapMode === key ? s.toggleBtnActive : {}) }}
              onClick={() => setMapMode(key)}
            >
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {/* 圖例 */}
      <div style={s.legend}>
        <div style={s.legendTitle}>圖例</div>
        <div style={s.legendGrid}>
          {Object.entries(STATUS_COLOR).map(([status, color]) => (
            <div key={status} style={s.legendItem}>
              <span style={s.legendLine(color)} />
              <span>{STATUS_LABEL[status] || status}</span>
            </div>
          ))}
          <div style={s.legendItem}>
            <span style={{ ...s.legendDot('#00cec9') }} />
            <span>捷運站</span>
          </div>
          <div style={s.legendItem}>
            <span style={{ ...s.legendDot('#fd79a8') }} />
            <span>地標/商圈</span>
          </div>
          <div style={s.legendItem}>
            <span style={{ ...s.legendDot('#fdcb6e') }} />
            <span>公車轉運</span>
          </div>
          <div style={s.legendItem}>
            <span style={{ ...s.legendDot('#ff4757'), boxShadow: '0 0 6px #ff4757' }} />
            <span>事件</span>
          </div>
        </div>
      </div>
    </div>
  )
}
