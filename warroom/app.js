/* ── Leaflet Map Init ──────────────────────────────────────────────────────── */
let mapInstance = null;
let roadPolylines = {};
let stationMarkers = {};
let latestDecisions = [];
let latestSnapshot = null;
let latestIncident = null;
let latestDashboardTriggers = []; // Module 1 即時警報門檻觸發（SOP-1/3/4）
let injectedTimelineData = {}; // { timestamp: { event, decisions, snapshot } }
let currentM4Request = {};
let crowdReasoningTrendTarget = null;

// 路段／站點經緯度座標改由後端 /api/traffic/coords 載入（見 warroom/data_source/road_coords.json），
// 不再寫死在前端，方便其他模組重用同一份資料、也不用改程式碼就能更新座標。
let STATION_COORDS = {};
let ROAD_COORDS = {};

async function loadRoadCoords() {
  try {
    const res = await fetch('/api/traffic/coords');
    const data = await res.json();
    STATION_COORDS = data.stations || {};
    ROAD_COORDS = data.segments || {};
  } catch (e) { console.error('路網座標載入失敗', e); }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadRoadCoords();
  mapInstance = L.map('leaflet-map', { zoomControl: false }).setView([25.0370, 121.5625], 14.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(mapInstance);
  L.control.zoom({ position: 'topleft' }).addTo(mapInstance);
  // L.circleMarker（站點）預設跟 L.polyline（路段）共用 overlayPane，疊放順序只看
  // DOM 加入先後，而路段/站點是兩支獨立 API 非同步載入，順序不固定，導致站點有時
  // 會被路段線蓋住點不到。開一個獨立、z-index 更高的 pane 讓站點永遠疊在路段上面。
  mapInstance.createPane('stationPane');
  mapInstance.getPane('stationPane').style.zIndex = 420;
  // 事件標記 pane：z-index 高於站點，確保事件 popup 不會被遮住
  mapInstance.createPane('incidentPane');
  mapInstance.getPane('incidentPane').style.zIndex = 650;
  // 確保 popup pane 永遠在最上層（解決站點標記蓋住 popup 的問題）
  mapInstance.getPane('popupPane').style.zIndex = 900;
  // 事件 ID tooltip 氣泡在所有圖層最上層（使用獨立 pane）
  mapInstance.createPane('incidentTooltipPane');
  mapInstance.getPane('incidentTooltipPane').style.zIndex = 9999;
  mapInstance.getPane('incidentTooltipPane').style.pointerEvents = 'none';
  mapInstance.getPane('tooltipPane').style.zIndex = 950;
  // 確保站點標記不會擋住 popup 的滑鼠事件
  mapInstance.getPane('stationPane').style.pointerEvents = 'auto';
  // 地圖高度改用 flex:1 撐滿面板剩餘空間（見 style.css .map-wrap），視窗尺寸變動時
  // 容器實際像素高度會跟著變，Leaflet 需要重新量測才不會顯示錯位/留白。
  window.addEventListener('resize', () => mapInstance.invalidateSize());

  // 模組 5 狀態載入（供 SOP-6 卡片與多語化按鈕使用）
  loadModule5Status().then(() => {
    loadTrafficData();
    loadIncidentData();
  });
  loadTimeline();
  loadBaseStationPanel();
  showAdvisorScenarioSet('incident');

  // 點路段／站點清單可切換該實體自己的歷史時序（/api/history?entity_id=）
  document.getElementById('segstat-list').addEventListener('click', e => {
    const row = e.target.closest('.segstat-row');
    if (row) showEntityHistory(row.dataset.entityId, row.dataset.entityName);
  });
  document.getElementById('station-status-list').addEventListener('click', e => {
    const row = e.target.closest('.station-row');
    if (row) showEntityHistory(row.dataset.entityId, row.dataset.entityName);
  });
  checkAdvisorStatus();
  loadAdvisorAlerts();
});

/* ── 模組一：車流資料 ─────────────────────────────────────────────────────── */
async function loadTrafficData() {
  try {
    const [segRes, dashRes] = await Promise.all([
      fetch('/api/traffic/segments'),
      fetch('/api/dashboard'),
    ]);
    const data = await segRes.json();
    const dashboard = await dashRes.json().catch(() => null);
    if (dashboard?.triggers) latestDashboardTriggers = dashboard.triggers;
    renderTrafficKPI(computeTrafficSummary(data.segments));
    renderTrafficAlerts(data.segments, dashboard);
    renderTrafficMap(data.segments);
    renderSegmentStatusList(data.segments);
  } catch (e) { console.error('車流資料載入失敗', e); }
}

/* ── 模組一：基地台狀態（左側常駐面板，資料來源與模組5共用 /api/signal/stations）── */
let _stationSeq = 0;
async function loadBaseStationPanel(timestamp) {
  const seq = ++_stationSeq;
  try {
    const url = timestamp ? `/api/signal/stations?timestamp=${encodeURIComponent(timestamp)}` : '/api/signal/stations';
    const res = await fetch(url);
    if (seq !== _stationSeq) return;
    const data = await res.json();
    renderBaseStationPanel(data.stations || []);
    renderStationMarkers(data.stations || []);
  } catch (e) {
    if (seq !== _stationSeq) return;
    console.error('基地台狀態載入失敗', e);
    const el = document.getElementById('station-status-list');
    if (el) el.innerHTML = '<div class="station-row">基地台狀態載入失敗</div>';
  }
}

/* ── 模組一：地圖站點標記（整合站點分類＋即時數據 tooltip）───────────────────
   站點類型依 station_id 判斷：BS_MRT_ = 捷運、BS_BUS_ = 公車、其餘 = 地標/場館。
   顏色邏輯：若外籍旅客比例 ≥ 30%（SOP-6 觸發）則紅色，否則依類型顯示。 */
const STATION_TYPE_STYLE = {
  mrt:   { color: '#00cec9', radius: 8 },
  bus:   { color: '#fdcb6e', radius: 7 },
  venue: { color: '#fd79a8', radius: 7 },
};
function getStationType(stationId) {
  if (stationId.startsWith('BS_MRT_')) return 'mrt';
  if (stationId.startsWith('BS_BUS_')) return 'bus';
  return 'venue';
}

function renderStationMarkers(stations) {
  stations.forEach(s => {
    const coords = STATION_COORDS[s.station_id];
    if (!coords) {
      console.warn(`[地圖] 站點 ${s.station_id}（${s.station_name}）沒有座標資料，不會顯示在地圖上。` +
        '請在 warroom/data_source/road_coords.json 的 "stations" 補上，或執行 scripts/fetch_road_coords.py。');
      return;
    }
    const growthPct = ((s.growth_rate || 0) * 100).toFixed(0);
    const growthSign = s.growth_rate > 0 ? '+' : '';
    const roamingPct = ((s.roaming_rate || 0) * 100).toFixed(1);
    const type = getStationType(s.station_id);
    const typeLabel = type === 'mrt' ? '[捷運]' : type === 'bus' ? '[公車]' : '[地標]';
    const tooltipHtml = `
      <b>${s.station_name}</b> <span style="opacity:.6">${typeLabel}</span><br>
      人流 ${s.user_count.toLocaleString()} 人 · 成長率 ${growthSign}${growthPct}%<br>
      外籍旅客比例 ${roamingPct}%${s.roaming_rate >= 0.30 ? '（已達門檻）' : ''}`;

    const style = STATION_TYPE_STYLE[type];
    const fillColor = s.roaming_rate >= 0.30 ? '#f27a84' : style.color;
    // 站點半徑依人流數動態縮放（5k以下=5px, 40k以上=14px）
    const dynamicRadius = Math.max(5, Math.min(14, 5 + (s.user_count / 40000) * 9));

    if (stationMarkers[s.station_id]) {
      stationMarkers[s.station_id].setTooltipContent(tooltipHtml);
      stationMarkers[s.station_id].setStyle({ fillColor, radius: dynamicRadius });
    } else {
      const marker = L.circleMarker(coords, {
        pane: 'stationPane',
        radius: dynamicRadius, color: '#fff', weight: 1.5,
        fillColor,
        fillOpacity: 0.9,
      }).addTo(mapInstance);
      marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -6], className: 'map-tooltip', opacity: 1 });
      marker.on('mouseover', () => marker.setRadius(dynamicRadius + 4));
      marker.on('mouseout', () => marker.setRadius(dynamicRadius));
      stationMarkers[s.station_id] = marker;
    }
  });
}

function renderBaseStationPanel(stations) {
  const container = document.getElementById('station-status-list');
  if (!container) return;
  const rows = [...stations].sort((a, b) => b.roaming_rate - a.roaming_rate);
  container.innerHTML = rows.map(s => {
    const trig = s.roaming_rate >= 0.30;
    const pct = Math.min(100, s.roaming_rate * 200);
    return `
      <div class="station-row ${trig ? 'trigger' : ''}" data-entity-id="${s.station_id}" data-entity-name="${s.station_name}">
        <div>${s.station_name}</div>
        <div class="sr-sub mono">${s.station_id} · ${s.user_count.toLocaleString()} 人</div>
        <div class="sr-roam mono">${(s.roaming_rate * 100).toFixed(1)}%</div>
        <div class="sr-bar-track"><div class="sr-bar-fill" style="width:${pct}%;background:${trig ? 'var(--critical)' : 'var(--accent)'}"></div></div>
      </div>`;
  }).join('');
}

/* ── 模組一：動態時序（時間軸）─────────────────────────────────────────────
   資料來源：/api/timestamps + /api/snapshot?timestamp=（data/snapshot.py
   共用資料層）。時間軸樣式比照戰情室原型設計稿（滑桿＋倍速
   播放），切換時間點時沿用既有的 renderTrafficKPI / renderTrafficAlerts /
   renderTrafficMap，不用另開頁面。 */
let timelineTimestamps = [];
let timelineIndex = -1;
let timelinePlayTimer = null;
let timelineSpeed = 1;

async function loadTimeline() {
  try {
    const res = await fetch('/api/timestamps');
    timelineTimestamps = await res.json();
    if (!timelineTimestamps.length) return;
    const slider = document.getElementById('timeline-slider');
    slider.max = timelineTimestamps.length - 1;
    timelineIndex = timelineTimestamps.length - 1;
    slider.value = timelineIndex;
    document.getElementById('timeline-range').textContent =
      `${shortTime(timelineTimestamps[0])} ─ ${shortTime(timelineTimestamps[timelineTimestamps.length - 1])}`;
    updateTimelineDisplay();
  } catch (e) { console.error('時間軸載入失敗', e); }
}

function shortTime(ts) {
  return ts ? ts.slice(11, 16) : '--:--';
}

function updateTimelineDisplay() {
  document.getElementById('timeline-time').textContent = shortTime(timelineTimestamps[timelineIndex]);
  const pct = timelineTimestamps.length > 1 ? (timelineIndex / (timelineTimestamps.length - 1)) * 100 : 0;
  document.getElementById('timeline-slider').style.setProperty('--pct', pct + '%');
  if (networkChartOpen) {
    if (chartPopupMode === 'entity') renderEntityChart();
    else renderNetworkChart();
  }
}

/* ── 模組一：飽和度／車速時序圖（地圖左下角彈出，資料來源 /api/network-history，
   也兼作單一路段／站點歷史趨勢彈窗，資料來源 /api/history?entity_id=）───────── */
let networkHistory = null;
let networkChartOpen = false;
let chartPopupMode = 'network'; // 'network'（全市總覽）｜'entity'（單一路段/站點）
let entityHistoryData = null;

async function toggleNetworkChart(force) {
  const popup = document.getElementById('chart-popup');
  const btn = document.getElementById('chart-toggle-btn');
  const open = force !== undefined ? force : popup.classList.contains('hidden');
  if (open && !networkHistory) {
    try {
      const res = await fetch('/api/network-history');
      networkHistory = await res.json();
    } catch (e) { console.error('時序圖資料載入失敗', e); return; }
  }
  chartPopupMode = 'network';
  setChartPopupHeader('飽和度／車速 時序監測', '全市飽和度', '均速 km/h', true);
  popup.classList.toggle('hidden', !open);
  btn.classList.toggle('active', open);
  networkChartOpen = open;
  if (open) renderNetworkChart();
}

function closeChartPopup() {
  document.getElementById('chart-popup').classList.add('hidden');
  document.getElementById('chart-toggle-btn').classList.remove('active');
  networkChartOpen = false;
}

function setChartPopupHeader(title, satLabel, spdLabel, showSpeedReadout) {
  document.getElementById('chart-popup-title').textContent = title;
  document.getElementById('chart-sat-label').textContent = satLabel;
  document.getElementById('chart-spd-label').textContent = spdLabel;
  document.getElementById('chart-readout-spd').classList.toggle('hidden', !showSpeedReadout);
}

/* ── 模組一：單一路段／站點歷史趨勢（點路段即時狀態／基地台狀態清單觸發）
   路段同時顯示飽和度＋車速雙線；站點同時顯示人流數＋成長率雙線。──────────── */
async function showEntityHistory(entityId, label) {
  try {
    const res = await fetch(`/api/history?entity_id=${encodeURIComponent(entityId)}`);
    if (!res.ok) throw new Error(`entity_id ${entityId} not found`);
    entityHistoryData = await res.json();
  } catch (e) { console.error('歷史資料載入失敗', e); return; }

  chartPopupMode = 'entity';
  if (entityHistoryData.entity_type === 'road_segment') {
    setChartPopupHeader(`${label} 歷史趨勢`, '飽和度', '車速 km/h', true);
  } else {
    setChartPopupHeader(`${label} 歷史趨勢`, '人流數', '成長率', true);
  }
  document.getElementById('chart-popup').classList.remove('hidden');
  document.getElementById('chart-toggle-btn').classList.remove('active');
  networkChartOpen = true;
  renderEntityChart();
}

function openTrendAndReasoning(entityId, label, reasoningType) {
  crowdReasoningTrendTarget = { entityId, label };
  closeChartPopup();
  openDrawer(reasoningType);
}

function renderEntityChart() {
  if (!entityHistoryData) return;
  const { entity_type, points } = entityHistoryData;
  const W = 1000, H = 100;
  const idx = Math.min(Math.max(timelineIndex, 0), points.length - 1);
  const playX = points.length > 1 ? (idx / (points.length - 1)) * W : 0;
  const svg = document.getElementById('network-chart-svg');

  if (entity_type === 'road_segment') {
    const satValues = points.map(p => p.saturation_score);
    const spdValues = points.map(p => p.avg_speed);
    const satPath = pathFromSeries(satValues, W, H, 0.35, 1.0);
    const spdMaxVal = Math.max(...spdValues.filter(v => v != null), 10) * 1.15;
    const spdPath = pathFromSeries(spdValues, W, H, 0, spdMaxVal);
    const areaPath = `${satPath} L${W},${H} L0,${H} Z`;
    svg.innerHTML = `
      <defs>
        <linearGradient id="satFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#eab85c" stop-opacity=".3"/>
          <stop offset="100%" stop-color="#eab85c" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#satFill)"/>
      <path d="${satPath}" fill="none" stroke="#eab85c" stroke-width="2" opacity=".9"/>
      <path d="${spdPath}" fill="none" stroke="#85d99a" stroke-width="2"/>
      <line x1="${playX}" y1="0" x2="${playX}" y2="${H}" stroke="#f2f5f9" stroke-width="1" opacity=".3"/>
    `;
    document.getElementById('chart-sat-value').textContent = satValues[idx] != null ? Math.round(satValues[idx] * 100) + '%' : '--';
    document.getElementById('chart-spd-value').textContent = spdValues[idx] != null ? Math.round(spdValues[idx]) : '--';
  } else {
    const userValues = points.map(p => p.user_count);
    const growthValues = points.map(p => p.growth_rate);
    const userMaxVal = Math.max(...userValues.filter(v => v != null), 1) * 1.15;
    const userPath = pathFromSeries(userValues, W, H, 0, userMaxVal);
    const growthAbsMax = Math.max(...growthValues.filter(v => v != null).map(Math.abs), 0.1) * 1.15;
    const growthPath = pathFromSeries(growthValues, W, H, -growthAbsMax, growthAbsMax);
    svg.innerHTML = `
      <path d="${userPath}" fill="none" stroke="#5bd4ff" stroke-width="2.2"/>
      <path d="${growthPath}" fill="none" stroke="#eba4c4" stroke-width="2"/>
      <line x1="${playX}" y1="0" x2="${playX}" y2="${H}" stroke="#f2f5f9" stroke-width="1" opacity=".3"/>
    `;
    document.getElementById('chart-sat-value').textContent = userValues[idx] != null ? userValues[idx].toLocaleString() : '--';
    document.getElementById('chart-spd-value').textContent = growthValues[idx] != null ? (growthValues[idx] >= 0 ? '+' : '') + Math.round(growthValues[idx] * 100) + '%' : '--';
  }
}

function renderNetworkChart() {
  if (!networkHistory) return;
  const { avg_saturation, avg_speed } = networkHistory;
  const W = 1000, H = 100;
  const satMin = 0.35, satMax = 1.0;
  const validSpeeds = avg_speed.filter(v => v != null);
  const spdMax = Math.max(...validSpeeds, 10) * 1.15;

  const satPath = pathFromSeries(avg_saturation, W, H, satMin, satMax);
  const spdPath = pathFromSeries(avg_speed, W, H, 0, spdMax);
  const areaPath = `${satPath} L${W},${H} L0,${H} Z`;

  const idx = Math.min(Math.max(timelineIndex, 0), avg_saturation.length - 1);
  const playX = avg_saturation.length > 1 ? (idx / (avg_saturation.length - 1)) * W : 0;

  const svg = document.getElementById('network-chart-svg');
  svg.innerHTML = `
    <defs>
      <linearGradient id="satFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#eab85c" stop-opacity=".3"/>
        <stop offset="100%" stop-color="#eab85c" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#satFill)"/>
    <path d="${satPath}" fill="none" stroke="#eab85c" stroke-width="2" opacity=".9"/>
    <path d="${spdPath}" fill="none" stroke="#85d99a" stroke-width="2"/>
    <line x1="${playX}" y1="0" x2="${playX}" y2="${H}" stroke="#f2f5f9" stroke-width="1" opacity=".3"/>
  `;
  updateChartReadouts(idx);
}

function pathFromSeries(arr, W, H, yMin, yMax) {
  return arr.map((v, i) => {
    const x = arr.length > 1 ? (i / (arr.length - 1)) * W : 0;
    const val = v == null ? yMin : v;
    const y = H - ((val - yMin) / (yMax - yMin)) * H;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
}

function updateChartReadouts(idx) {
  const sat = networkHistory.avg_saturation[idx];
  const spd = networkHistory.avg_speed[idx];
  document.getElementById('chart-sat-value').textContent = sat != null ? Math.round(sat * 100) + '%' : '--';
  document.getElementById('chart-spd-value').textContent = spd != null ? Math.round(spd) : '--';
}

function onTimelineSlide(value) {
  timelineIndex = Number(value);
  updateTimelineDisplay();
  loadSnapshotAt(timelineTimestamps[timelineIndex]);
}

/* ── 時間軸上一格／下一格按鈕 ─────────────────────────────────────────────── */
function timelineStepPrev() {
  if (timelineIndex <= 0) return;
  timelineIndex--;
  document.getElementById('timeline-slider').value = timelineIndex;
  updateTimelineDisplay();
  loadSnapshotAt(timelineTimestamps[timelineIndex]);
}

function timelineStepNext() {
  if (timelineIndex >= timelineTimestamps.length - 1) return;
  timelineIndex++;
  document.getElementById('timeline-slider').value = timelineIndex;
  updateTimelineDisplay();
  loadSnapshotAt(timelineTimestamps[timelineIndex]);
}

function setTimelineSpeed(mult) {
  timelineSpeed = mult;
  document.querySelectorAll('.tl-speed-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.speed) === mult);
  });
  if (timelinePlayTimer) {
    clearInterval(timelinePlayTimer);
    startTimelinePlayLoop();
  }
}

function toggleTimelinePlay() {
  const btn = document.getElementById('timeline-play');
  if (timelinePlayTimer) {
    clearInterval(timelinePlayTimer);
    timelinePlayTimer = null;
    btn.classList.remove('playing');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '▶';
    return;
  }
  btn.classList.add('playing');
  btn.setAttribute('aria-pressed', 'true');
  btn.textContent = '⏸';
  startTimelinePlayLoop();
}

function startTimelinePlayLoop() {
  timelinePlayTimer = setInterval(() => {
    if (timelineIndex >= timelineTimestamps.length - 1) {
      toggleTimelinePlay();
      return;
    }
    timelineIndex += 1;
    document.getElementById('timeline-slider').value = timelineIndex;
    updateTimelineDisplay();
    loadSnapshotAt(timelineTimestamps[timelineIndex]);
  }, 1500 / timelineSpeed);
}

/* ── 時間軸快照載入（含 race condition 防護）───────────────────────────────
   每次 loadSnapshotAt 呼叫時遞增 _snapshotSeq，回應回來後比對序號，
   若有更新的請求已送出，就丟棄這次過期的回應，避免畫面閃爍不同步。 */
let _snapshotSeq = 0;

async function loadSnapshotAt(timestamp) {
  const seq = ++_snapshotSeq;
  try {
    // 先清除地圖上的事件標記（只在非事件時間點清除）
    clearIncidentMapMarkers();

    // 如果該 timestamp 是注入事件的時間點（後端可能沒有此精確時間），用最近的可用時間
    let queryTs = timestamp;
    let dashRes = await fetch(`/api/dashboard?timestamp=${encodeURIComponent(queryTs)}`);
    if (!dashRes.ok && injectedTimelineData[timestamp]) {
      const candidates = timelineTimestamps.filter(t => t <= timestamp && !injectedTimelineData[t]);
      const fallbackTs = candidates.length ? candidates[candidates.length - 1] : timelineTimestamps.find(t => !injectedTimelineData[t]) || timelineTimestamps[0];
      dashRes = await fetch(`/api/dashboard?timestamp=${encodeURIComponent(fallbackTs)}`);
    }

    const [dashboard] = await Promise.all([
      dashRes.json(),
      loadModule5Status(timestamp),
      loadBaseStationPanel(timestamp),
    ]);

    // 回應回來時若已有更新的請求，丟棄本次結果
    if (seq !== _snapshotSeq) return;

    // 同步更新 Module 1 門檻觸發結果（SOP-1/3/4），供交通建議書使用
    if (dashboard?.triggers) latestDashboardTriggers = dashboard.triggers;

    const segments = snapshotToSegments(dashboard.snapshot);
    renderTrafficKPI(computeTrafficSummary(segments));
    renderTrafficAlerts(segments, dashboard);
    renderTrafficMap(segments);
    renderSegmentStatusList(segments);

    // 如果該時間點有注入事件，重新顯示事件標記和警報卡片
    const injected = injectedTimelineData[timestamp];
    if (injected) {
      latestIncident = injected.event;
      latestDecisions = injected.decisions || [];
      latestSnapshot = injected.snapshot || null;
      renderIncidentDecisionsOnDashboard(injected.event, injected.decisions);
      addIncidentMapMarkers(injected.event, injected.decisions, injected.snapshot);
    }
  } catch (e) { if (seq === _snapshotSeq) console.error('快照載入失敗', e); }
}

function snapshotToSegments(snapshot) {
  return Object.entries(snapshot.road_segments || {}).map(([id, seg]) => ({
    Segment_ID: id,
    Road_Name: seg.name,
    Avg_Speed: seg.avg_speed,
    Saturation_Score: seg.saturation_score,
    Vehicle_Count: seg.vehicle_count,
    Timestamp: snapshot.timestamp,
    level: classifySaturation(seg.saturation_score),
  }));
}

function classifySaturation(score) {
  if (score == null) return 'OK';
  if (score >= 0.95) return 'A';
  if (score >= 0.85) return 'B';
  return 'OK';
}

function computeTrafficSummary(segments) {
  const a_count = segments.filter(s => s.level === 'A').length;
  const b_count = segments.filter(s => s.level === 'B').length;
  const speeds = segments.map(s => s.Avg_Speed).filter(v => v != null);
  const avg_speed = speeds.length
    ? Math.round((speeds.reduce((sum, v) => sum + v, 0) / speeds.length) * 10) / 10
    : 0;
  const saturations = segments.map(s => s.Saturation_Score).filter(v => v != null);
  const avg_saturation = saturations.length
    ? saturations.reduce((sum, v) => sum + v, 0) / saturations.length
    : 0;
  const impacted = segments
    .filter(s => s.level !== 'OK')
    .reduce((sum, s) => sum + (s.Vehicle_Count || 0), 0);
  return { a_count, b_count, avg_speed, avg_saturation, impacted, total: segments.length };
}

/* ── KPI 數字動畫：數值變化時做 countup 過場 ────────────────────────────────── */
function animateValue(el, newValue, duration = 350, decimals = 0) {
  const start = parseFloat(el.textContent) || 0;
  const end = parseFloat(newValue);
  if (isNaN(end) || start === end) { el.textContent = newValue; return; }
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (end - start) * eased;
    el.textContent = decimals > 0 ? current.toFixed(decimals) : Math.round(current);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = newValue; // 確保最後顯示精確值
  }
  requestAnimationFrame(tick);
}

function renderTrafficKPI(summary) {
  animateValue(document.getElementById('ks-speed-value'), summary.avg_speed);
  const speedDelta = document.getElementById('ks-speed-delta');
  speedDelta.textContent = summary.avg_speed < 25 ? '▲ 壅塞' : '▼ 順暢';
  speedDelta.className = 'ks-delta ' + (summary.avg_speed < 25 ? 'up' : 'down');

  animateValue(document.getElementById('ks-sat-value'), Math.round(summary.avg_saturation * 100));
  const satDelta = document.getElementById('ks-sat-delta');
  satDelta.textContent = summary.avg_saturation >= 0.85 ? '超過門檻' : '低於門檻';
  satDelta.className = 'ks-delta ' + (summary.avg_saturation >= 0.85 ? 'up' : 'down');

  const segCount = summary.a_count + summary.b_count;
  animateValue(document.getElementById('ks-seg-value'), segCount);
  document.getElementById('ks-seg-total').textContent = `/ ${summary.total}`;
  const segDelta = document.getElementById('ks-seg-delta');
  segDelta.textContent = segCount > 0 ? '需留意' : '全線正常';
  segDelta.className = 'ks-delta ' + (segCount > 0 ? 'up' : 'down');

  animateValue(document.getElementById('ks-impact-value'), (summary.impacted / 1000).toFixed(1), 350, 1);
}

function renderTrafficAlerts(segments, dashboard) {
  const container = document.querySelector('#panel-dashboard .dash-alerts');
  const alerts = segments.filter(s => s.level === 'A' || s.level === 'B')
                         .sort((a, b) => b.Saturation_Score - a.Saturation_Score);

  let html = '<h3>即時警報</h3><div class="alert-scroll">';
  html += renderSop3Card(dashboard);
  html += renderSop4Card(dashboard);
  alerts.forEach(s => {
    const isA = s.level === 'A';
    const tagClass = isA ? '' : 'caution-bg';
    const textClass = isA ? 'critical-text' : 'caution-text';
    const label = isA ? 'A級癱瘓' : 'B級壅擠';
    html += `
      <div class="alert-card sop1">
        <div class="alert-hdr">
          <span class="alert-tag ${tagClass}">SOP-1 ${label}</span>
          <span class="mono">${s.Timestamp ? s.Timestamp.slice(11, 16) : ''}</span>
        </div>
        <div class="alert-body">
          <b>${s.Road_Name} (${s.Segment_ID})</b><br>
          飽和度 <span class="mono ${textClass}">${s.Saturation_Score.toFixed(2)}</span>
          &nbsp;車速 <span class="mono">${s.Avg_Speed} km/h</span>
        </div>
        <button class="btn-explain" onclick="openDrawer('${s.Segment_ID}')">查看判斷依據</button>
      </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
}

/* ── 模組一：SOP-3 捷運分流門檻卡（BS_MRT_BL17 Growth_Rate>0.30 或 User_Count>25000）── */
function renderSop3Card(dashboard) {
  const sop3 = (dashboard?.triggers || []).find(t => t.sop_clause === '第 3 條');
  const sop4 = (dashboard?.triggers || []).find(t => t.sop_clause === '第 4 條');
  const cascadeFromSop4 = sop4 && (sop4.cascade_checks || []).some(c => c.includes('第 3 條'));

  if (sop3) {
    return `
      <div class="alert-card sop3 ${cascadeFromSop4 ? 'cascade-active' : ''}">
        <div class="alert-hdr"><span class="alert-tag safe-bg">SOP-3 捷運分流</span><span class="mono">${(sop3.timestamp || '').slice(11, 16)}</span></div>
        <div class="alert-body">
          <b>${sop3.entity_name}</b><br>
          ${sop3.basis}
          ${cascadeFromSop4 ? '<div class="cascade-hint">由 SOP-4 散場連動啟動</div>' : ''}
        </div>
        <button class="btn-explain" onclick="openTrendAndReasoning('${sop3.entity_id}', '${sop3.entity_name}', 'sop3')">趨勢與判斷依據</button>
      </div>`;
  }
  if (cascadeFromSop4) {
    return `
      <div class="alert-card sop3 cascade-active">
        <div class="alert-hdr"><span class="alert-tag caution-bg">SOP-3 捷運分流</span></div>
        <div class="alert-body">
          <div class="cascade-hint">由 SOP-4 散場連動啟動</div>
          捷運國父紀念館站尚未達自身門檻，但大巨蛋散場已觸發，提前連動接駁分流機制
        </div>
        <button class="btn-explain" onclick="openTrendAndReasoning('BS_MRT_BL17', '捷運國父紀念館站', 'sop3')">趨勢與判斷依據</button>
      </div>`;
  }
  return `
    <div class="alert-card sop3">
      <div class="alert-hdr"><span class="alert-tag muted-bg">SOP-3 捷運分流</span></div>
      <div class="alert-body">目前 BS_MRT_BL17（捷運國父紀念館站）未達分流門檻</div>
    </div>`;
}

/* ── 模組一：SOP-4 大巨蛋散場卡（BS_TPE_DOME peak>=30000 且 Growth_Rate<=-0.20）── */
function renderSop4Card(dashboard) {
  const sop4 = (dashboard?.triggers || []).find(t => t.sop_clause === '第 4 條');
  if (sop4) {
    const cascade = (sop4.cascade_checks || []).join('、');
    return `
      <div class="alert-card sop4">
        <div class="alert-hdr"><span class="alert-tag caution-bg">SOP-4 散場</span><span class="mono">${(sop4.timestamp || '').slice(11, 16)}</span></div>
        <div class="alert-body">
          <b>${sop4.entity_name}</b> (${sop4.entity_id})<br>
          ${sop4.basis}
          ${cascade ? `<br><span class="mono caution-text">${cascade}</span>` : ''}
        </div>
        <button class="btn-explain" onclick="openTrendAndReasoning('${sop4.entity_id}', '${sop4.entity_name}', 'sop4')">趨勢與判斷依據</button>
      </div>`;
  }
  return `
    <div class="alert-card sop4">
      <div class="alert-hdr"><span class="alert-tag muted-bg">SOP-4 散場</span></div>
      <div class="alert-body">目前大巨蛋（BS_TPE_DOME）未達散場啟動條件</div>
    </div>`;
}

/* ── 模組五：多語通報卡片（真實資料，不是寫死文字）─────────────────────────── */
function renderTrafficMap(segments) {
  const colorMap = { A: '#f27a84', B: '#eab85c', OK: '#85d99a' };
  segments.forEach(s => {
    const pts = ROAD_COORDS[s.Segment_ID];
    if (!pts) {
      console.warn(`[地圖] 路段 ${s.Segment_ID}（${s.Road_Name}）沒有座標資料，不會顯示在地圖上。` +
        '請在 warroom/data_source/road_coords.json 的 "segments" 補上，或執行 scripts/fetch_road_coords.py。');
      return;
    }
    const color = colorMap[s.level] || '#85d99a';
    if (roadPolylines[s.Segment_ID]) {
      roadPolylines[s.Segment_ID].setStyle({ color });
    } else {
      const line = L.polyline(pts, { color, weight: 5, opacity: 0.9 }).addTo(mapInstance);
      line.bindTooltip(`${s.Road_Name} (${s.Segment_ID})<br>飽和: ${s.Saturation_Score.toFixed(2)}`, { className: 'map-tooltip', opacity: 1 });
      // Hover 加粗效果
      line.on('mouseover', () => line.setStyle({ weight: 9, opacity: 1 }));
      line.on('mouseout', () => line.setStyle({ weight: 5, opacity: 0.9 }));
      roadPolylines[s.Segment_ID] = line;
    }
  });
}

/* ── 模組一：路段即時狀態清單（15 路段速覽，色點＋速度＋飽和度）───────────── */
function renderSegmentStatusList(segments) {
  const container = document.getElementById('segstat-list');
  if (!container) return;
  const levelColor = { A: 'var(--critical)', B: 'var(--caution)', OK: 'var(--safe)' };
  container.innerHTML = segments.map(s => {
    const pct = s.Saturation_Score != null ? Math.round(s.Saturation_Score * 100) : null;
    const color = s.Avg_Speed === 0 ? 'var(--text-dim)' : (levelColor[s.level] || 'var(--safe)');
    return `
      <div class="segstat-row" data-entity-id="${s.Segment_ID}" data-entity-name="${s.Road_Name}">
        <span class="segstat-dot" style="background:${color}"></span>
        <span class="segstat-name">${s.Road_Name}</span>
        <span class="segstat-speed">${s.Avg_Speed ?? '--'} km/h</span>
        <span class="segstat-pct" style="background:${color}">${pct != null ? pct + '%' : '--'}</span>
      </div>`;
  }).join('');
}

/* ── 模組二：事件資料 ─────────────────────────────────────────────────────── */
async function loadIncidentData() {
  try {
    const res = await fetch('/api/incidents/list');
    const data = await res.json();
    renderIncidentList(data.incidents);
    updateEventCountKPI(data.count ?? data.incidents.length);
  } catch (e) { console.error('事件資料載入失敗', e); }
}

function updateEventCountKPI(count) {
  const el = document.getElementById('ks-alert-value');
  if (el) el.textContent = count;
}

function renderIncidentList(incidents) {
  const container = document.querySelector('.scenario-list');
  if (!container) return;
  // 用 event_id 去重，確保每個事件只顯示一次
  const seen = new Set();
  const unique = incidents.filter(inc => {
    if (seen.has(inc.event_id)) return false;
    seen.add(inc.event_id);
    return true;
  });
  // 預設情境事件（JSON 檔案中的 3 筆）
  const scenarios = unique.filter(inc => !inc.event_id.startsWith('CUSTOM'));
  // 自訂注入的事件
  const customs = unique.filter(inc => inc.event_id.startsWith('CUSTOM'));
  let html = scenarios.map(inc => `
    <div class="scenario-item has-tooltip" onclick="injectIncident('${inc.event_id}')">
      <b>${inc.event_id}</b> — ${inc.type}<br>
      <span class="mono">${inc.affected_segment} · ${inc.severity} · ${inc.status}</span>
      <div class="incident-tooltip">${buildIncidentTooltipContent(inc)}</div>
    </div>
  `).join('');
  if (customs.length) {
    html += `<div class="inject-section-divider">自訂事件紀錄</div>`;
    html += customs.map(inc => `
      <div class="scenario-item scenario-custom has-tooltip" onclick="injectIncident('${inc.event_id}')">
        <b>${inc.event_id}</b> — ${inc.type}<br>
        <span class="mono">${inc.affected_segment} · ${inc.severity} · ${inc.status}</span>
        <div class="incident-tooltip">${buildIncidentTooltipContent(inc)}</div>
      </div>
    `).join('');
  }
  container.innerHTML = html;
}

/* ── 輔助：解析實體中文名稱（支援 RD_ 路段 + BS_ 站點）────────────────── */
function resolveEntityName(entityId, snapshot) {
  if (!entityId) return '';
  if (snapshot?.road_segments?.[entityId]?.name) return snapshot.road_segments[entityId].name;
  if (snapshot?.stations?.[entityId]?.name) return snapshot.stations[entityId].name;
  return '';
}

function buildIncidentTooltipContent(inc) {
  return Object.entries(inc)
    .filter(([_, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, value]) => `<div class="tooltip-row"><span class="tooltip-key">${escapeHtml(key)}</span><span class="tooltip-val">${escapeHtml(String(value))}</span></div>`)
    .join('');
}

function switchInjectPanel(panel) {
  document.querySelectorAll('.inject-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.injectPanel === panel);
  });
  document.getElementById('scenario-list').classList.toggle('hidden', panel !== 'scenario');
  document.getElementById('custom-incident-form').classList.toggle('hidden', panel !== 'custom');
  document.getElementById('import-json-panel').classList.toggle('hidden', panel !== 'import');
}

/* ── JSON 匯入功能 ─────────────────────────────────────────────────────────── */
let importJsonData = null;

(function initImportDropzone() {
  document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleImportFile(file);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleImportFile(fileInput.files[0]);
      fileInput.value = '';
    });
  });
})();

function handleImportFile(file) {
  if (!file.name.endsWith('.json')) {
    alert('請選擇 .json 檔案');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      // 移除 BOM 及前後空白，避免 UTF-8 BOM 導致 JSON.parse 失敗
      const raw = e.target.result.replace(/^\uFEFF/, '').trim();
      if (!raw) { alert('JSON 檔案內容為空'); return; }
      let parsed = JSON.parse(raw);
      // 支援單一物件或陣列
      if (!Array.isArray(parsed)) parsed = [parsed];
      if (!parsed.length) { alert('JSON 檔案內容為空'); return; }
      importJsonData = parsed;
      renderImportPreview(parsed);
    } catch (err) {
      // JSON 格式錯誤：彈出提醒並取消上傳
      alert('JSON 解析失敗，已取消上傳：\n' + err.message);
      importJsonData = null;
      const preview = document.getElementById('import-preview');
      if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
      const btn = document.getElementById('import-submit-btn');
      if (btn) btn.disabled = true;
      const result = document.getElementById('import-result');
      if (result) result.classList.add('hidden');
    }
  };
  reader.readAsText(file);
}

function renderImportPreview(events) {
  const preview = document.getElementById('import-preview');
  const btn = document.getElementById('import-submit-btn');
  preview.classList.remove('hidden');
  btn.disabled = false;
  document.getElementById('import-result').classList.add('hidden');

  const rows = events.map((ev, i) => `
    <div class="import-preview-row">
      <span class="import-idx">${i + 1}</span>
      <b>${escapeHtml(ev.event_id || '(無 ID)')}</b> — ${escapeHtml(ev.type || '(無類型)')}<br>
      <span class="mono">${escapeHtml(ev.affected_segment || '')} · ${escapeHtml(ev.severity || '')} · ${escapeHtml(ev.status || '')}</span>
    </div>`).join('');
  preview.innerHTML = `<div class="import-preview-title">預覽：共 ${events.length} 筆事件</div>${rows}`;
}

async function submitImportJson() {
  if (!importJsonData || !importJsonData.length) return;
  const btn = document.getElementById('import-submit-btn');
  btn.disabled = true;
  btn.textContent = '匯入中…';

  try {
    const res = await fetch('/api/incidents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importJsonData),
    });
    const data = await res.json();
    if (data.success) {
      closeIncidentModal();
      showInjectResultNotification(true, null, {
        event: { event_id: `批次匯入 ${data.imported_count} 筆`, affected_segment: '—', severity: '—', status: '—' },
        decisions: [],
        processing_time_ms: 0,
      });
      loadIncidentData();
    } else {
      showInjectResultNotification(false, JSON.stringify(data));
    }
  } catch (e) {
    showInjectResultNotification(false, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '匯入事件';
    importJsonData = null;
  }
}

/* ── Tab Switching ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
  });
});

/* ── Brand Home：點擊標題回到主儀表板 ─────────────────────────────────────── */
document.getElementById('brand-home').addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab[data-tab="dashboard"]').classList.add('active');
  document.getElementById('panel-dashboard').classList.add('active');
});
document.getElementById('brand-home').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    document.getElementById('brand-home').click();
  }
});

/* ── Drawer (Module 4) ────────────────────────────────────────────────────────
   SOP-1 直接查 /api/traffic；SOP-2/SOP-5 則讀最近一次事件注入後的真實 decisions。 */
function openDrawer(type) {
  document.getElementById('drawer').classList.remove('hidden');
  document.getElementById('drawer-backdrop').classList.remove('hidden');
  renderDrawerContent(type);
}
function closeDrawer() {
  document.getElementById('drawer').classList.add('hidden');
  document.getElementById('drawer-backdrop').classList.add('hidden');
  crowdReasoningTrendTarget = null;
}

async function renderDrawerContent(type) {
  const titleEl = document.getElementById('drawer-title');
  const bodyEl = document.getElementById('drawer-body-content');

  // 統一走模組四解釋鏈
  titleEl.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:1rem;padding:8px 0 4px;';
  titleEl.innerHTML = '<span style="width:3.5px;height:16px;border-radius:2px;background:var(--accent);flex:none"></span>決策推理與解釋';
  bodyEl.innerHTML = `<div class="spinner">載入決策分析…</div>`;

  const currentTs = timelineTimestamps[timelineIndex] || '2026-05-20 22:15';

  if (type === 'sop3' || type === 'sop4') {
    const trigger = getCrowdSopTrigger(type);
    const trend = await loadCrowdReasoningTrend(trigger);
    bodyEl.innerHTML = renderCrowdSopReasoning(trigger, type, currentTs, trend);
    return;
  }

  // 根據 type 決定要查詢的 event_id 和 timestamp
  let eventId = null;
  let queryTs = currentTs;
  if (type === 'sop2') {
    eventId = latestIncident?.event_id || 'TPE_2026_ACC_001';
    // 使用事件發生時間（或最近的有效時間點）
    if (latestIncident?.timestamp) queryTs = latestIncident.timestamp;
    else if (timelineTimestamps.length) queryTs = timelineTimestamps[Math.max(timelineIndex, Math.min(timelineTimestamps.length - 1, timelineIndex + 1))];
  } else if (type === 'sop5') {
    eventId = latestIncident?.event_id || 'TPE_2026_EVT_003';
    queryTs = latestIncident?.timestamp || '2026-05-20 22:30'; // SOP-5 事件在 22:30
  } else if (type.startsWith('decision:')) {
    eventId = latestIncident?.event_id;
    if (latestIncident?.timestamp) queryTs = latestIncident.timestamp;
  }

  try {
    const explainPayload = { timestamp: queryTs, event_id: eventId || null };
    const injectedContext = latestIncident && latestSnapshot &&
      (type === 'sop2' || type === 'sop5' || type.startsWith('decision:'));
    if (injectedContext) {
      explainPayload.event = latestIncident;
      explainPayload.snapshot = latestSnapshot;
    }
    currentM4Request = explainPayload;
    const res = await fetch(`/api/reasoning/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(explainPayload),
    });
    if (!res.ok) throw new Error(await res.text());
    const record = await res.json();
    bodyEl.innerHTML = renderM4Inline(record);
    setTimeout(runM4CF, 0);
    loadAiSummary(queryTs, eventId);
  } catch (e) {
    // Fallback: 如果模組四失敗，嘗試顯示隊友的簡化版或錯誤訊息
    if (type === 'sop2' || type === 'sop5' || type.startsWith('decision:')) {
      const clause = type === 'sop2' ? 'SOP-2' : type === 'sop5' ? 'SOP-5' : '該決策';
      const decision = type === 'sop2' ? latestDecisions.find(d => d.sop_clause === 'SOP-2')
        : type === 'sop5' ? latestDecisions.find(d => d.sop_clause === 'SOP-5')
        : latestDecisions[Number(type.split(':')[1])];
      if (decision) {
        bodyEl.innerHTML = renderDecisionExplanation(decision);
      } else {
        bodyEl.innerHTML = `<div class="card-yellow">模組四載入失敗：${escapeHtml(e.message)}<br>請確認時間軸在 22:10 之後（事件發生後）。</div>`;
      }
    } else {
      // SOP-1 路段 fallback
      try {
        const [segRes] = await Promise.all([fetch('/api/traffic/segments')]);
        const segData = await segRes.json();
        const seg = segData.segments.find(s => s.Segment_ID === type);
        if (!seg) { bodyEl.innerHTML = `<p>找不到路段 ${type} 的資料</p>`; return; }
        const levelText = seg.level === 'A' ? '飽和度 ≥ 0.95 → A 級癱瘓' : seg.level === 'B' ? '0.85 ≤ 飽和度 < 0.95 → B 級壅擠' : '飽和度 < 0.85 → 一般';
        bodyEl.innerHTML = `
          <div class="chain">
            <div class="chain-step active"><div class="node">1</div><div class="step-text">
              <span class="step-lbl">目前飽和度</span> ${seg.Road_Name}（${seg.Segment_ID}）<span class="mono ${seg.level === 'A' ? 'critical-text' : seg.level === 'B' ? 'caution-text' : ''}">${seg.Saturation_Score.toFixed(2)}</span>
            </div></div>
            <div class="chain-step active"><div class="node">2</div><div class="step-text">
              <span class="step-lbl">SOP-1 分級</span> ${levelText}
            </div></div>
          </div>
          <div class="card-yellow" style="margin-top:10px">目前時間點尚無事件觸發，僅顯示 SOP-1 壅塞分級。</div>`;
      } catch (e2) {
        bodyEl.innerHTML = `<p>資料載入失敗：${escapeHtml(e2.message)}</p>`;
      }
    }
  }
}

function emptyDecisionHint(clause) {
  return `<div class="card-yellow">尚未有 ${clause} 的真實決策資料。請先在「事件處置」注入會觸發該 SOP 的情境事件。</div>`;
}

function getCrowdSopTrigger(type) {
  const triggers = latestDashboardTriggers || [];
  if (type === 'sop4') return triggers.find(t => t.sop_clause === '第 4 條');
  const sop3 = triggers.find(t => t.sop_clause === '第 3 條');
  const sop4 = triggers.find(t => t.sop_clause === '第 4 條');
  const cascadeFromSop4 = sop4 && (sop4.cascade_checks || []).some(c => c.includes('第 3 條'));
  if (sop3) {
    return {
      ...sop3,
      linkage_items: [],
    };
  }

  if (!cascadeFromSop4) return null;
  return {
    triggered: true,
    sop_clause: '第 3 條',
    clause_name: '捷運與接駁分流',
    entity_id: 'BS_MRT_BL17',
    entity_name: '捷運國父紀念館站',
    basis: '本站尚未達自身人流門檻；因 SOP-4 大巨蛋散場啟動，提前連動接駁分流機制。',
    cascade_checks: sop4.cascade_checks || ['連動第 3 條接駁機制'],
    linkage_items: [],
    severity: 'yellow',
    timestamp: sop4.timestamp,
  };
}

async function loadCrowdReasoningTrend(trigger) {
  const target = crowdReasoningTrendTarget || {
    entityId: trigger?.entity_id,
    label: trigger?.entity_name,
  };
  if (!target?.entityId) return null;
  try {
    const res = await fetch(`/api/history?entity_id=${encodeURIComponent(target.entityId)}`);
    if (!res.ok) throw new Error(`entity_id ${target.entityId} not found`);
    const data = await res.json();
    return { ...data, label: target.label || trigger?.entity_name || target.entityId };
  } catch (e) {
    console.error('右側解釋鏈歷史趨勢載入失敗', e);
    return { error: e.message, label: target.label || target.entityId };
  }
}

function renderReasoningTrendCard(trend, timestamp) {
  if (!trend) return '';
  if (trend.error) {
    return `<div class="card-yellow" style="margin-bottom:14px">歷史趨勢載入失敗：${escapeHtml(trend.error)}</div>`;
  }
  const points = trend.points || [];
  if (!points.length) {
    return `<div class="card-yellow" style="margin-bottom:14px">目前沒有可顯示的歷史趨勢資料。</div>`;
  }

  const idx = findHistoryPointIndex(points, timestamp);
  const W = 1000, H = 96;
  const label = trend.label || trend.entity_id;

  if (trend.entity_type === 'station') {
    const userValues = points.map(p => p.user_count);
    const growthValues = points.map(p => p.growth_rate);
    const userMaxVal = Math.max(...userValues.filter(v => v != null), 1) * 1.15;
    const userPath = pathFromSeries(userValues, W, H, 0, userMaxVal);
    const growthAbsMax = Math.max(...growthValues.filter(v => v != null).map(Math.abs), 0.1) * 1.15;
    const growthPath = pathFromSeries(growthValues, W, H, -growthAbsMax, growthAbsMax);
    const userText = userValues[idx] != null ? userValues[idx].toLocaleString() : '--';
    const growthText = growthValues[idx] != null
      ? `${growthValues[idx] >= 0 ? '+' : ''}${Math.round(growthValues[idx] * 100)}%`
      : '--';
    return `
      <div class="formula-box align-left" style="margin-bottom:14px">
        <div class="formula-title">歷史趨勢</div>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px">
          <div><b>${escapeHtml(label)}</b><br><span class="mono" style="font-size:11px;color:var(--text-dim)">${escapeHtml(trend.entity_id || '')}</span></div>
          <div style="display:flex;gap:14px;text-align:right">
            <div><div class="mono" style="color:var(--caution);font-weight:700">${userText}</div><div style="font-size:11px;color:var(--text-dim)">人流數</div></div>
            <div><div class="mono" style="color:var(--safe);font-weight:700">${growthText}</div><div style="font-size:11px;color:var(--text-dim)">成長率</div></div>
          </div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:92px;display:block">
          <path d="${userPath}" fill="none" stroke="#5bd4ff" stroke-width="3"/>
          <path d="${growthPath}" fill="none" stroke="#eba4c4" stroke-width="3"/>
        </svg>
        <div class="mono" style="display:flex;gap:14px;font-size:11px;color:var(--text-dim);margin-top:6px">
          <span style="color:#5bd4ff">━ 人流數</span>
          <span style="color:#eba4c4">━ 成長率</span>
        </div>
      </div>`;
  }

  return '';
}

function findHistoryPointIndex(points, timestamp) {
  if (!points.length) return 0;
  const exact = points.findIndex(p => p.timestamp === timestamp);
  if (exact >= 0) return exact;
  const before = points.map((p, i) => ({ p, i })).filter(({ p }) => p.timestamp <= timestamp).pop();
  if (before) return before.i;
  return Math.min(Math.max(timelineIndex, 0), points.length - 1);
}

function renderCrowdSopReasoning(trigger, type, timestamp, trend) {
  const sopId = type === 'sop3' ? 'SOP-3' : 'SOP-4';
  const fallbackName = type === 'sop3' ? '捷運與接駁分流' : '大巨蛋散場啟動';
  const fallbackEntity = type === 'sop3' ? '捷運國父紀念館站' : '大巨蛋場館內';
  if (!trigger) {
    return `<div class="card-yellow">目前時間點尚未觸發 ${sopId}，沒有可顯示的判斷依據。請切到有警報的時間點再查看。</div>`;
  }

  const clauseName = trigger.clause_name || fallbackName;
  const entityName = trigger.entity_name || fallbackEntity;
  const entityId = trigger.entity_id || '';
  const timeText = (trigger.timestamp || timestamp || '').slice(11, 16) || '--:--';
  const linkageTitle = trigger.linkage_title || '連動條款';
  const linkageItems = trigger.linkage_items || (type === 'sop4' ? (trigger.cascade_checks || []) : []);
  const basisParts = String(trigger.basis || '目前無判斷依據文字').split('；').filter(Boolean);
  const summary = `${sopId} ${clauseName}｜${entityName} 已命中條件，歷史趨勢同步開啟，判斷依據如下。`;
  const chainSteps = [
    { order: 1, label: '讀取人流資料', detail: `${entityName}${entityId ? `（${entityId}）` : ''} 於 ${timeText} 的即時人流與成長率資料` },
    { order: 2, label: '檢查 SOP 門檻', detail: basisParts.join('；') },
    { order: 3, label: '命中 SOP', detail: `${sopId} ${clauseName}` },
    { order: 4, label: '連動檢查', detail: linkageItems.length ? linkageItems.join('、') : '無額外連動' },
    { order: 5, label: '輸出依據', detail: '同步顯示歷史趨勢，保留門檻、數值與連動原因供人工覆核' },
  ];

  return `
    ${renderReasoningTrendCard(trend, trigger.timestamp || timestamp)}

    <div class="formula-box align-left" style="border-left:3px solid var(--accent);margin-bottom:14px">
      <div class="formula-title" style="display:flex;align-items:center;gap:6px">
        <span>AI 摘要</span>
        <span class="mono" style="font-size:10px;color:var(--text-dim)">deterministic</span>
      </div>
      <div style="font-size:13px;line-height:1.7">${escapeHtml(summary)}</div>
    </div>

    <div class="decision-summary">
      <span class="decision-tag">${sopId}</span>
      <span class="ete-badge mono" style="background:rgba(234,184,92,0.18);color:var(--caution)">${escapeHtml(timeText)}</span>
      <span class="ete-badge mono" style="background:rgba(126,200,188,0.15);color:var(--accent)">歷史趨勢已開啟</span>
    </div>

    <div class="chain" style="margin-top:12px">
      ${chainSteps.map(step => `
        <div class="chain-step active"><div class="node">${step.order}</div><div class="step-text">
          <span class="step-lbl">${escapeHtml(step.label)}</span> ${escapeHtml(step.detail)}
        </div></div>
      `).join('')}
    </div>

    <div class="formula-box align-left">
      <div class="formula-title">判斷依據</div>
      ${basisParts.map(part => `<div class="excluded-row">${escapeHtml(part)}</div>`).join('')}
    </div>

    ${linkageItems.length ? `<div class="formula-box align-left">
      <div class="formula-title">${escapeHtml(linkageTitle)}</div>
      ${linkageItems.map(item => `<div class="excluded-row">${escapeHtml(item)}</div>`).join('')}
    </div>` : ''}
  `;
}

function renderDecisionExplanation(decision) {
  const ete = decision.ete_detail || {};
  const excluded = decision.excluded_routes || [];
  const hasRoutes = decision.sop_clause === 'SOP-2';
  return `
    <div class="decision-summary">
      <span class="decision-tag">${decision.sop_clause} ${decision.clause_name || ''}</span>
      ${decision.ete_minutes ? `<span class="ete-badge mono">ETE ${decision.ete_minutes} min</span>` : ''}
    </div>
    <div class="chain">
      <div class="chain-step active"><div class="node">1</div><div class="step-text">
        <span class="step-lbl">事件辨識</span> ${latestIncident?.event_id || decision.entity_id} · ${decision.entity_name || decision.entity_id}
      </div></div>
      <div class="chain-step active"><div class="node">2</div><div class="step-text">
        <span class="step-lbl">SOP 命中</span> ${decision.basis}
      </div></div>
      ${hasRoutes ? `<div class="chain-step active"><div class="node">3</div><div class="step-text">
        <span class="step-lbl">主疏散</span> ${decision.primary_route_name || decision.primary_route || '無'} ${decision.primary_route ? `(${decision.primary_route})` : ''}
      </div></div>` : ''}
      ${decision.secondary_routes?.length ? `<div class="chain-step active"><div class="node">4</div><div class="step-text">
        <span class="step-lbl">次疏散</span> ${decision.secondary_route_names?.join('、') || decision.secondary_routes.join('、')}
      </div></div>` : ''}
    </div>
    ${excluded.length ? `<div class="formula-box align-left">
      <div class="formula-title">排除候選</div>
      ${excluded.map(r => `<div class="excluded-row"><span class="mono">${r.segment_id}</span> ${r.name || ''}<br><small>${r.reason}</small></div>`).join('')}
    </div>` : ''}
    ${decision.ete_minutes ? `<div class="formula-box">
      <div class="formula-title">ETE 公式</div>
      <div class="formula mono">${ete.formula_note || 'ETE = base_clearance + congestion_penalty'}</div>
      <div class="formula-detail mono">= ${ete.base_clearance ?? '-'} + ${ete.congestion_penalty ?? '-'} = ${decision.ete_minutes} min</div>
      <div class="formula-detail">平均飽和度 ${ete.avg_saturation ?? '-'}；計算路段 ${(ete.affected_segments_used || []).join('、')}</div>
    </div>` : ''}`;
}

/* ── Chat (Module 3) ──────────────────────────────────────────────────────── */
let advisorHistory = [];  // 對話歷史，支援多輪追問

// 主動預警：頁面載入時掃描數據
async function loadAdvisorAlerts() {
  try {
    const res = await fetch('/api/advisor/alerts');
    const data = await res.json();
    if (data.alerts && data.alerts.length > 0) {
      const box = document.getElementById('chat-messages');
      if (box) {
        const alertMsg = document.createElement('div');
        alertMsg.className = 'msg ai';
        alertMsg.innerHTML = '<div class="answer-lead">📊 主動預警掃描結果</div>' +
          data.alerts.map(a => `<div class="advisor-action">${a.message}</div>`).join('');
        box.appendChild(alertMsg);
      }
    }
  } catch (e) { /* ignore */ }
}

const advisorRoadNames = [
  '忠孝東路四段', '光復南路', '基隆路一段', '市民大道四段', '仁愛路四段',
  '敦化南路一段', '松高路', '延吉街', '基隆路地下道', '市府路',
  '松壽路', '敦化南路二段', '信義路五段', '松智路', '復興南路一段',
];
const advisorStationNames = [
  '大巨蛋場館內', '捷運國父紀念館站', '松山文創園區', '捷運忠孝敦化站',
  '信義威秀商圈', '台北101廣場', '市府轉運站', 'ATT4FUN周邊', '捷運市政府站',
];
const advisorScenarioSets = {
  incident: advisorRoadNames.map(name => ({
    label: name,
    text: `如果${name}發生嚴重車禍並造成路段封鎖，依 SOP 應該怎麼改道、通報，預計多久恢復？`,
  })),
  signal: advisorRoadNames.map(name => ({
    label: name,
    text: `如果${name}號誌故障，依 SOP 要怎麼處理？`,
  })),
  notification: advisorStationNames.map(name => ({
    label: name,
    text: `檢查目前${name}是否需要啟動多語通報？`,
  })),
};

function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('hidden');
  document.getElementById('chat-backdrop').classList.toggle('hidden');
  // 首次開啟時檢查目前 LLM 後端（Bedrock / Ollama / Mock）狀態
  if (!window._advisorStatusChecked) {
    window._advisorStatusChecked = true;
    checkAdvisorStatus();
  }
}

async function checkAdvisorStatus() {
  const dot = document.getElementById('advisor-mode-dot');
  const text = document.getElementById('advisor-mode-text');
  try {
    const res = await fetch('/api/advisor/status');
    const data = await res.json();
    if (data.ok) {
      dot.className = 'mode-dot mode-dot-llm';
      text.textContent = data.message || `LLM 模式 · ${data.mode || 'ready'}`;
    } else {
      dot.className = 'mode-dot mode-dot-rules';
      text.textContent = data.message || '規則引擎 · 即時快照';
    }
  } catch (e) {
    dot.className = 'mode-dot mode-dot-rules';
    text.textContent = '規則引擎 · 即時快照';
  }
}

function showAdvisorScenarioSet(key) {
  const select = document.getElementById('advisor-scenario-select');
  if (!select) return;
  select.innerHTML = (advisorScenarioSets[key] || []).map(item =>
    `<option value="${escapeHtml(item.text)}">${escapeHtml(item.label)}</option>`
  ).join('');
  document.querySelectorAll('[data-advisor-set]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.advisorSet === key);
  });
}

function advisorQuickAsk(message) {
  sendAdvisorMessage(message);
}

function askAdvisorScenario() {
  const select = document.getElementById('advisor-scenario-select');
  sendAdvisorMessage(select.value);
}

async function sendAdvisorMessage(forcedMessage) {
  const input = document.getElementById('advisor-input');
  const message = (forcedMessage || input.value).trim();
  if (!message) return;
  input.value = '';
  appendChatMessage('user', message);
  // 記錄到對話歷史
  advisorHistory.push({role: 'user', content: message});
  const pending = appendChatMessage('ai', '');
  pending.innerHTML = `<div class="sq-thinking">
    <div class="sq-track">
      <svg class="sq-runner" viewBox="0 0 36 28">
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".75"/>
        <ellipse cx="20" cy="17" rx="10" ry="7" fill="currentColor"/>
        <circle cx="30" cy="12" r="5" fill="currentColor"/>
        <circle cx="32" cy="11" r="1.2" fill="var(--ink)"/>
        <line x1="15" y1="23" x2="15" y2="27" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="25" y1="23" x2="25" y2="27" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <span class="sq-label">Squirrel 正在檢索 SOP…</span>
  </div>`;
  try {
    const res = await fetch('/api/advisor/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: advisorHistory.slice(0, -1),
        current_event: latestIncident,
        current_decisions: latestDecisions,
      }),
    });
    const startTime = Date.now();
    const data = await res.json();
    // 松鼠至少跑 800ms
    const elapsed = Date.now() - startTime;
    if (elapsed < 800) await new Promise(r => setTimeout(r, 800 - elapsed));
    pending.innerHTML = formatAdvisorAnswer(data.answer);
    // 記錄 AI 回答到歷史
    advisorHistory.push({role: 'assistant', content: data.answer});
    // 更新模式指示
    const dot = document.getElementById('advisor-mode-dot');
    const text = document.getElementById('advisor-mode-text');
    if (data.source === 'llm') {
      dot.className = 'mode-dot mode-dot-llm';
      text.textContent = data.mode ? `LLM 模式 · ${data.mode}` : 'LLM 模式';
    } else {
      dot.className = 'mode-dot mode-dot-llm';
      text.textContent = 'LLM + 規則引擎';
    }
  } catch (e) {
    pending.textContent = '顧問服務暫時無法回應：' + e.message;
  }
}

function appendChatMessage(role, text) {
  const box = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function formatAdvisorAnswer(answer) {
  const lines = String(answer || '').split('\n')
    .map(line => line.trim().replace(/^#{1,4}\s*/, '').replace(/^第[一二三四五六七八九十]行[：:]\s*/, ''))
    .filter(Boolean);
  if (!lines.length) return '';
  return lines.map((line, index) => {
    const safe = escapeHtml(line);
    if (line.startsWith('✓')) return `<div class="advisor-check">${safe}</div>`;
    if (line.startsWith('■ 建議處置')) return `<div class="advisor-action advisor-action-treat"><span class="action-icon">🛠</span> ${safe.replace('■ ', '')}</div>`;
    if (line.startsWith('■ 後續確認')) return `<div class="advisor-action advisor-action-followup"><span class="action-icon">🔎</span> ${safe.replace('■ ', '')}</div>`;
    if (line.startsWith('■')) return `<div class="advisor-action">${safe.replace('■ ', '')}</div>`;
    if (index === 0 || (!line.startsWith('■') && !line.startsWith('✓') && index <= 2 && !lines.slice(0, index).some(l => l.startsWith('■')))) {
      return `<div class="answer-lead">${safe}</div>`;
    }
    return `<div class="answer-line">${safe}</div>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ── 模組五：漫遊率狀態（供即時警報欄 SOP-6 卡片使用）───────────────────── */
let m5Triggered = [];

let _m5Seq = 0;
async function loadModule5Status(timestamp) {
  const seq = ++_m5Seq;
  try {
    const url = timestamp ? `/api/signal/triggered?timestamp=${encodeURIComponent(timestamp)}` : '/api/signal/triggered';
    const res = await fetch(url);
    if (seq !== _m5Seq) return;
    const data = await res.json();
    m5Triggered = data.triggered || [];
  } catch (e) {
    if (seq === _m5Seq) console.error('模組 5 狀態載入失敗', e);
  }
}

/* ── Module 5：多語通報 Modal（原生元件，直接打 /api/signal、/api/notify，內部接 Ollama）── */
let m5Stations = [];
let m5Current = null;
let m5Alerts = {};
const M5_THRESHOLD = 0.30;
const M5_LANG_ORDER = ['zh_tw', 'en', 'ja', 'ko', 'th', 'vi', 'fr'];
const M5_LANG_LABEL = { zh_tw: '🇹🇼 繁中', en: '🇺🇸 EN', ja: '🇯🇵 日', ko: '🇰🇷 韓', th: '🇹🇭 泰', vi: '🇻🇳 越', fr: '🇫🇷 法' };

async function openModule5Modal() {
  document.getElementById('m5-modal-overlay').classList.remove('hidden');
  if (!m5Stations.length) await m5LoadStations();
}
function closeModule5Modal() {
  document.getElementById('m5-modal-overlay').classList.add('hidden');
}

async function m5LoadStations() {
  try {
    const res = await fetch('/api/signal/stations');
    const data = await res.json();
    m5Stations = data.stations.sort((a, b) => b.roaming_rate - a.roaming_rate);
    const sel = document.getElementById('m5-station-select');
    sel.innerHTML = m5Stations.map(s =>
      `<option value="${s.station_id}">${s.roaming_rate >= M5_THRESHOLD ? '🔴' : '🟢'} ${s.station_name}（${(s.roaming_rate * 100).toFixed(1)}%）</option>`
    ).join('');
    sel.onchange = () => m5SelectStation(sel.value);
    if (m5Stations.length) m5SelectStation(m5Stations[0].station_id);
  } catch (e) {
    document.getElementById('m5-modal-title').textContent = '站點資料載入失敗';
  }
}

function m5SelectStation(sid) {
  m5Current = m5Stations.find(s => s.station_id === sid);
  if (!m5Current) return;
  const multi = m5Current.roaming_rate >= M5_THRESHOLD;
  document.getElementById('m5-modal-title').textContent =
    `${m5Current.station_name} · 外籍旅客比例 ${(m5Current.roaming_rate * 100).toFixed(1)}%`;
  document.getElementById('m5-modal-meta').textContent = m5Current.timestamp || '';
  document.getElementById('m5-sop-banner').innerHTML = multi
    ? `<div class="card-red">SOP 第 6 條觸發｜將產出中英日韓泰越法七語版</div>`
    : `<div class="card-yellow">ℹ️ 未達 30% 門檻｜僅產出繁體中文</div>`;
  m5Alerts = {};
  document.getElementById('m5-editor').classList.add('hidden');
  document.getElementById('m5-btn-publish').disabled = true;
  document.getElementById('m5-publish-result').classList.add('hidden');
}

async function m5Generate() {
  if (!m5Current) return;
  const s = m5Current, multi = s.roaming_rate >= M5_THRESHOLD;
  const btn = document.getElementById('m5-btn-generate');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = '🤖 推論中，請稍候…';
  document.getElementById('m5-spinner').classList.remove('hidden');

  // 模擬進度條（漸慢曲線跑到 95%，收到結果後跳 100%）
  let progress = 0;
  const bar = document.getElementById('m5-progress-bar');
  const pct = document.getElementById('m5-progress-pct');
  const progressTimer = setInterval(() => {
    if (progress < 95) {
      progress += (95 - progress) * 0.04;
      bar.style.width = progress.toFixed(0) + '%';
      pct.textContent = progress.toFixed(0) + '%';
    }
  }, 500);

  try {
    const res = await fetch('/api/notify/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_id: s.station_id, station_name: s.station_name,
        user_count: s.user_count, roaming_rate: s.roaming_rate,
        growth_rate: s.growth_rate || 0, timestamp: s.timestamp || '',
        multilingual: multi,
      }),
    });
    const data = await res.json();
    clearInterval(progressTimer);
    bar.style.width = '100%';
    pct.textContent = '100%';
    m5Alerts = data.alerts;
    m5RenderEditor(multi);
    document.getElementById('m5-btn-publish').disabled = false;
    if (data.source === 'mock') {
      document.getElementById('m5-sop-banner').insertAdjacentHTML('beforeend',
        `<div class="card-yellow" style="margin-top:8px">LLM 未連線，目前顯示為預設模板文字（${data.llm_status?.message || ''}）</div>`);
    }
  } catch (e) {
    clearInterval(progressTimer);
    alert('生成失敗：' + e.message);
  } finally {
    setTimeout(() => {
      document.getElementById('m5-spinner').classList.add('hidden');
      bar.style.width = '0%';
      pct.textContent = '0%';
    }, 600);
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = '⚡ 生成多語告警';
  }
}

function m5RenderEditor(multi) {
  const langs = multi ? M5_LANG_ORDER : ['zh_tw'];
  document.getElementById('m5-lang-tabs').innerHTML = langs.map((k, i) =>
    `<div class="lang-tab ${i === 0 ? 'active' : ''}" data-lang="${k}">${M5_LANG_LABEL[k]}</div>`).join('');
  document.getElementById('m5-lang-panels').innerHTML = langs.map((k, i) =>
    `<div class="lang-panel ${i === 0 ? 'active' : ''}" id="m5-panel-${k}"><textarea id="m5-ta-${k}">${m5Alerts[k] || ''}</textarea></div>`).join('');
  document.querySelectorAll('#m5-lang-tabs .lang-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#m5-lang-tabs .lang-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#m5-lang-panels .lang-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`m5-panel-${tab.dataset.lang}`).classList.add('active');
    });
  });
  document.getElementById('m5-editor').classList.remove('hidden');
}

async function m5Publish() {
  if (!m5Current) return;
  const alerts = {};
  M5_LANG_ORDER.forEach(k => {
    const t = document.getElementById(`m5-ta-${k}`);
    if (t) alerts[k] = t.value;
  });
  try {
    const res = await fetch('/api/notify/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_name: m5Current.station_name, roaming_rate: m5Current.roaming_rate,
        alerts, channels: ['cell_broadcast', 'cms'],
      }),
    });
    const data = await res.json();
    if (data.success) {
      m5Alerts = alerts;
      document.getElementById('m5-publish-result').classList.remove('hidden');
      document.getElementById('m5-publish-result').innerHTML =
        `<div class="publish-success">已發送簡訊＋看板　 ${new Date().toLocaleTimeString()}</div>`;
    }
  } catch (e) {
    alert('發布失敗：' + e.message);
  }
}

function m5CopyAll() {
  const lines = M5_LANG_ORDER
    .filter(k => m5Alerts[k])
    .map(k => `[${M5_LANG_LABEL[k]}] ${document.getElementById(`m5-ta-${k}`)?.value || m5Alerts[k]}`);
  if (!lines.length) return;
  navigator.clipboard?.writeText(lines.join('\n\n'));
}

/* ── Module 5 CMS 多語化發布（從地圖 popup 觸發）─────────────────────────── */
let m5CmsAlerts = {};
let m5CmsMultilingual = false;
let m5CmsSourceTexts = [];

function openM5CmsModal(encodedData, eventTimestamp) {
  const cmsData = JSON.parse(decodeURIComponent(encodedData));
  m5CmsSourceTexts = cmsData; // [{sop: "SOP-2", text: "xxx"}, ...]

  document.getElementById('m5-cms-modal-overlay').classList.remove('hidden');
  document.getElementById('m5-cms-modal-title').textContent = '多語化通報生成中…';
  document.getElementById('m5-cms-modal-meta').textContent = eventTimestamp || '';
  document.getElementById('m5-cms-editor').classList.add('hidden');
  document.getElementById('m5-cms-btn-publish').disabled = true;
  document.getElementById('m5-cms-publish-result').classList.add('hidden');
  m5CmsAlerts = {};

  // 取得當前漫遊率判斷是否需要多語化
  const ts = eventTimestamp || '';
  const url = ts ? `/api/signal/triggered?timestamp=${encodeURIComponent(ts)}` : '/api/signal/triggered';
  fetch(url).then(r => r.json()).then(data => {
    const triggered = data.triggered || [];
    m5CmsMultilingual = triggered.length > 0; // 任一站點 >= 30%

    const combinedCms = cmsData.map(d => d.text).join('\n');

    if (m5CmsMultilingual) {
      const topStation = triggered.sort((a, b) => b.roaming_rate - a.roaming_rate)[0];
      document.getElementById('m5-cms-sop-banner').innerHTML =
        `<div class="card-red" style="margin-bottom:14px"><b>SOP 第 6 條觸發</b>｜${topStation.station_name} 漫遊率 ${(topStation.roaming_rate * 100).toFixed(1)}%（≥ 30%），自動產出七語版</div>`;
      document.getElementById('m5-cms-modal-title').textContent = '多語化通報（七語版）';
      m5CmsGenerate(combinedCms, true);
    } else {
      document.getElementById('m5-cms-sop-banner').innerHTML =
        `<div class="card-yellow" style="margin-bottom:14px">所有站點漫遊率 < 30%｜僅產出繁體中文版</div>`;
      document.getElementById('m5-cms-modal-title').textContent = '通報發布（中文版）';
      // 不需翻譯，直接顯示中文（加上【交通管制】標題）
      m5CmsAlerts = { zh_tw: '【交通管制】' + combinedCms };
      m5CmsRenderEditor(false);
      document.getElementById('m5-cms-btn-publish').disabled = false;
    }
  }).catch(e => {
    console.error('漫遊率查詢失敗', e);
    // fallback: 只產出中文
    const combinedCms = cmsData.map(d => d.text).join('\n');
    m5CmsAlerts = { zh_tw: '【交通管制】' + combinedCms };
    document.getElementById('m5-cms-sop-banner').innerHTML =
      `<div class="card-yellow" style="margin-bottom:14px">漫遊率資料讀取失敗，僅產出中文版</div>`;
    document.getElementById('m5-cms-modal-title').textContent = '通報發布（中文版）';
    m5CmsRenderEditor(false);
    document.getElementById('m5-cms-btn-publish').disabled = false;
  });
}

function closeM5CmsModal() {
  document.getElementById('m5-cms-modal-overlay').classList.add('hidden');
}

async function m5CmsGenerate(cmsText, multilingual) {
  document.getElementById('m5-cms-spinner').classList.remove('hidden');
  let progress = 0;
  const bar = document.getElementById('m5-cms-progress-bar');
  const pct = document.getElementById('m5-cms-progress-pct');
  const progressTimer = setInterval(() => {
    if (progress < 95) {
      progress += (95 - progress) * 0.04;
      bar.style.width = progress.toFixed(0) + '%';
      pct.textContent = progress.toFixed(0) + '%';
    }
  }, 500);

  try {
    const res = await fetch('/api/notify/generate-cms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cms_text: cmsText, multilingual }),
    });
    const data = await res.json();
    clearInterval(progressTimer);
    bar.style.width = '100%';
    pct.textContent = '100%';
    m5CmsAlerts = data.alerts;
    m5CmsRenderEditor(multilingual);
    document.getElementById('m5-cms-btn-publish').disabled = false;
  } catch (e) {
    clearInterval(progressTimer);
    // fallback 中文
    m5CmsAlerts = { zh_tw: cmsText };
    m5CmsRenderEditor(false);
    document.getElementById('m5-cms-btn-publish').disabled = false;
    document.getElementById('m5-cms-sop-banner').insertAdjacentHTML('beforeend',
      `<div class="card-yellow" style="margin-top:8px">翻譯失敗，僅顯示中文版</div>`);
  } finally {
    setTimeout(() => {
      document.getElementById('m5-cms-spinner').classList.add('hidden');
      bar.style.width = '0%';
      pct.textContent = '0%';
    }, 600);
  }
}

function m5CmsRenderEditor(multi) {
  const langs = multi ? M5_LANG_ORDER : ['zh_tw'];
  document.getElementById('m5-cms-lang-tabs').innerHTML = langs.map((k, i) =>
    `<div class="lang-tab ${i === 0 ? 'active' : ''}" data-lang="${k}">${M5_LANG_LABEL[k]}</div>`).join('');
  document.getElementById('m5-cms-lang-panels').innerHTML = langs.map((k, i) =>
    `<div class="lang-panel ${i === 0 ? 'active' : ''}" id="m5-cms-panel-${k}"><textarea id="m5-cms-ta-${k}">${m5CmsAlerts[k] || ''}</textarea></div>`).join('');
  document.querySelectorAll('#m5-cms-lang-tabs .lang-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#m5-cms-lang-tabs .lang-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#m5-cms-lang-panels .lang-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`m5-cms-panel-${tab.dataset.lang}`).classList.add('active');
    });
  });
  document.getElementById('m5-cms-editor').classList.remove('hidden');
}

async function m5CmsPublish() {
  const alerts = {};
  M5_LANG_ORDER.forEach(k => {
    const t = document.getElementById(`m5-cms-ta-${k}`);
    if (t) alerts[k] = t.value;
  });
  try {
    const res = await fetch('/api/notify/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_name: 'CMS 通報',
        roaming_rate: m5CmsMultilingual ? 0.30 : 0,
        alerts,
        channels: ['cell_broadcast', 'cms'],
      }),
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('m5-cms-publish-result').classList.remove('hidden');
      document.getElementById('m5-cms-publish-result').innerHTML =
        `<div class="publish-success" style="background:#1a2e25;border:1.5px solid #85d99a;border-radius:8px;padding:12px 18px;color:#85d99a;font-weight:700;margin-top:14px">通報已成功發布　${new Date().toLocaleTimeString()}</div>`;
      document.getElementById('m5-cms-btn-publish').disabled = true;
    }
  } catch (e) {
    alert('發布失敗：' + e.message);
  }
}

function m5CmsCopyAll() {
  const lines = M5_LANG_ORDER
    .filter(k => m5CmsAlerts[k])
    .map(k => `[${M5_LANG_LABEL[k]}] ${document.getElementById(`m5-cms-ta-${k}`)?.value || m5CmsAlerts[k]}`);
  if (!lines.length) return;
  navigator.clipboard?.writeText(lines.join('\n\n'));
}

/* ── Incident Injection ────────────────────────────────────────────────────── */
function openIncidentModal() {
  document.getElementById('incident-modal-overlay').classList.remove('hidden');
}
function closeIncidentModal() {
  document.getElementById('incident-modal-overlay').classList.add('hidden');
}

function showInjectLoading() {
  const panel = document.getElementById('incident-modal-body');
  if (!panel) return;
  // Remove existing overlay if any
  const existing = panel.querySelector('.inject-loading-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'inject-loading-overlay';
  overlay.innerHTML = `
    <div class="loading-spinner"></div>
    <div class="loading-text">SOP 規則引擎運算中… <span id="m2-progress-pct">0%</span></div>
    <div style="width:60%;height:8px;background:#1e2a3a;border-radius:4px;overflow:hidden;margin-top:10px">
      <div id="m2-progress-bar" style="width:0%;height:100%;background:var(--accent,#7ec8bc);border-radius:4px;transition:width .3s ease"></div>
    </div>
  `;
  panel.appendChild(overlay);
  // 啟動模擬進度
  let progress = 0;
  window._m2ProgressTimer = setInterval(() => {
    if (progress < 95) {
      progress += (95 - progress) * 0.06;
      const bar = document.getElementById('m2-progress-bar');
      const pct = document.getElementById('m2-progress-pct');
      if (bar) bar.style.width = progress.toFixed(0) + '%';
      if (pct) pct.textContent = progress.toFixed(0) + '%';
    }
  }, 400);
}
function hideInjectLoading() {
  if (window._m2ProgressTimer) clearInterval(window._m2ProgressTimer);
  const bar = document.getElementById('m2-progress-bar');
  const pct = document.getElementById('m2-progress-pct');
  if (bar) bar.style.width = '100%';
  if (pct) pct.textContent = '100%';
  setTimeout(() => {
    const overlay = document.querySelector('.inject-loading-overlay');
    if (overlay) overlay.remove();
  }, 500);
}

async function injectIncident(eventId) {
  showInjectLoading();
  try {
    const listRes = await fetch('/api/incidents/list');
    const listData = await listRes.json();
    const event = listData.incidents.find(i => i.event_id === eventId);
    if (!event) { hideInjectLoading(); showInjectResultNotification(false, '找不到該事件'); return; }

    const res = await fetch('/api/incidents/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      hideInjectLoading();
      showInjectResultNotification(false, `伺服器回傳 ${res.status} 錯誤`);
      return;
    }
    const data = await res.json();
    hideInjectLoading();
    if (data.success) {
      latestIncident = data.event;
      latestDecisions = data.decisions || [];
      latestSnapshot = data.snapshot || null;
      // 同步更新 Module 1 門檻觸發（SOP-1/3/4），供建議書使用
      if (data.m1_triggers) latestDashboardTriggers = data.m1_triggers;
      closeIncidentModal();
      showInjectResultNotification(true, null, data);
      applyIncidentToDashboard(data);
    } else {
      showInjectResultNotification(false, '注入失敗');
    }
  } catch (e) {
    hideInjectLoading();
    showInjectResultNotification(false, e.message);
  }
}

async function submitCustomIncident(event) {
  event.preventDefault();
  const now = new Date();
  const fallbackId = `CUSTOM_${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
  const affected = document.getElementById('custom-segment').value.trim();
  const location = document.getElementById('custom-location').value.trim() || affected;
  const timeValue = document.getElementById('custom-timestamp').value || '22:00';
  const timestamp = `2026-05-20 ${timeValue}`;
  const payload = {
    event_id: document.getElementById('custom-event-id').value.trim() || fallbackId,
    type: document.getElementById('custom-type').value.trim() || 'Unknown',
    location,
    affected_segment: affected,
    affected_road: null,
    severity: document.getElementById('custom-severity').value,
    status: document.getElementById('custom-status').value,
    description: document.getElementById('custom-description').value.trim(),
    timestamp,
  };
  if (!payload.affected_segment) {
    alert('請選擇影響路段/站點');
    return;
  }
  await injectIncidentPayload(payload);
}

async function injectIncidentPayload(payload) {
  showInjectLoading();
  try {
    const res = await fetch('/api/incidents/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      hideInjectLoading();
      showInjectResultNotification(false, `伺服器回傳 ${res.status} 錯誤`);
      return;
    }
    const data = await res.json();
    hideInjectLoading();
    if (data.success) {
      latestIncident = data.event;
      latestDecisions = data.decisions || [];
      latestSnapshot = data.snapshot || null;
      // 同步更新 Module 1 門檻觸發（SOP-1/3/4），供建議書使用
      if (data.m1_triggers) latestDashboardTriggers = data.m1_triggers;
      closeIncidentModal();
      showInjectResultNotification(true, null, data);
      applyIncidentToDashboard(data);
      loadIncidentData();
    } else {
      showInjectResultNotification(false, '注入失敗');
    }
  } catch (e) {
    hideInjectLoading();
    showInjectResultNotification(false, e.message);
  }
}

function showInjectResult(data) {
  // Legacy: kept for compatibility; new flow uses showInjectResultNotification + applyIncidentToDashboard
  applyIncidentToDashboard(data);
}

/* ── 匯入結果通知 Modal ─────────────────────────────────────────────────── */
function showInjectResultNotification(success, errorMsg, data) {
  const overlay = document.getElementById('inject-result-modal-overlay');
  const title = document.getElementById('inject-result-title');
  const body = document.getElementById('inject-result-body');

  if (success && data) {
    const event = data.event;
    const decisions = data.decisions || [];
    const elapsed = data.processing_time_ms ?? 0;
    const triggeredCount = decisions.filter(d => d.triggered).length;
    const sopClauses = decisions.filter(d => d.triggered).map(d => d.sop_clause).filter(Boolean).join('、') || '無';

    title.textContent = '✓ 匯入成功';
    title.style.color = 'var(--safe, #85d99a)';
    body.innerHTML = `
      <div class="inject-result-success">
        <div class="inject-result-icon">✓</div>
        <div class="inject-result-detail">
          <p>事件 <b>${escapeHtml(event.event_id)}</b> 已成功注入</p>
          <p class="mono" style="font-size:12px;color:var(--text-dim)">
            ${escapeHtml(event.affected_segment)} · ${escapeHtml(event.severity)} · ${escapeHtml(event.status)}
          </p>
          <p style="margin-top:10px">觸發 SOP 條款：<b>${escapeHtml(sopClauses)}</b>（${triggeredCount} 筆決策）</p>
          <p class="mono" style="font-size:11px;color:var(--text-dim)">規則運算 ${elapsed} ms</p>
        </div>
      </div>`;
  } else {
    title.textContent = '✗ 匯入失敗';
    title.style.color = 'var(--critical, #f27a84)';
    body.innerHTML = `
      <div class="inject-result-fail">
        <div class="inject-result-icon fail">✗</div>
        <div class="inject-result-detail">
          <p>事件注入失敗</p>
          <p style="color:var(--critical)">${escapeHtml(errorMsg || '未知錯誤')}</p>
        </div>
      </div>`;
  }

  overlay.classList.remove('hidden');
}

function closeInjectResultModal() {
  document.getElementById('inject-result-modal-overlay').classList.add('hidden');
}

/* ── 將匯入事件的 SOP 決策結果反映到儀表板 ─────────────────────────────────── */
function applyIncidentToDashboard(data) {
  const event = data.event;
  const decisions = data.decisions || [];
  const snapshot = data.snapshot || latestSnapshot;

  // 1. 在右側即時警報區加入簡化的 SOP 決策卡片
  renderIncidentDecisionsOnDashboard(event, decisions);

  // 2. 在地圖上標記事件位置（閃爍圖示 + 封閉路段標紅）
  addIncidentMapMarkers(event, decisions, snapshot);

  // 3. 更新事件數量 KPI
  const alertEl = document.getElementById('ks-alert-value');
  if (alertEl) {
    const current = parseInt(alertEl.textContent) || 0;
    alertEl.textContent = current + 1;
  }

  // 4. 顯示 nav bar 上的「產出建議書」按鈕
  const advisoryNavBtn = document.getElementById('advisory-nav-btn');
  if (advisoryNavBtn) advisoryNavBtn.classList.remove('hidden');

  // 5. 將時間軸移動到事件時間點（如不存在則新增）
  insertIncidentTimestamp(event, data);
}

/* ── 在時間軸插入事件時間點並跳轉 ─────────────────────────────────────────── */

function insertIncidentTimestamp(event, data) {
  const ts = event.timestamp;
  if (!ts || !timelineTimestamps.length) return;

  // 儲存事件資料到對應時間點
  injectedTimelineData[ts] = {
    event: data.event,
    decisions: data.decisions || [],
    snapshot: data.snapshot || latestSnapshot,
  };

  // 檢查時間軸是否已包含此時間點
  const existingIdx = timelineTimestamps.indexOf(ts);
  if (existingIdx >= 0) {
    // 時間點已存在，直接跳轉
    timelineIndex = existingIdx;
  } else {
    // 找到插入位置（保持排序）
    let insertIdx = timelineTimestamps.findIndex(t => t > ts);
    if (insertIdx === -1) insertIdx = timelineTimestamps.length;
    timelineTimestamps.splice(insertIdx, 0, ts);

    // 更新 slider 範圍
    const slider = document.getElementById('timeline-slider');
    slider.max = timelineTimestamps.length - 1;
    timelineIndex = insertIdx;
  }

  // 更新 slider 顯示
  const slider = document.getElementById('timeline-slider');
  slider.value = timelineIndex;
  document.getElementById('timeline-range').textContent =
    `${shortTime(timelineTimestamps[0])} ─ ${shortTime(timelineTimestamps[timelineTimestamps.length - 1])}`;
  updateTimelineDisplay();

  // 載入該時間點的資料
  loadSnapshotAt(ts);
}

/* ── 在儀表板右側即時警報區渲染簡化 SOP 決策卡片 ──────────────────────────── */
function renderIncidentDecisionsOnDashboard(event, decisions) {
  const container = document.querySelector('#panel-dashboard .dash-alerts .alert-scroll');
  if (!container) return;

  const triggeredDecisions = decisions.filter(d => d.triggered);
  if (!triggeredDecisions.length) return;

  // 生成每筆 SOP 決策的簡化警報卡片（只顯示最基本資訊，詳細內容在「為什麼」裡）
  let cardsHtml = '';
  triggeredDecisions.forEach(d => {
    const sopClass = d.sop_clause === 'SOP-1' ? 'sop1'
      : d.sop_clause === 'SOP-2' ? 'sop2'
      : d.sop_clause === 'SOP-5' ? 'sop5'
      : d.sop_clause === 'SOP-3' ? 'sop3'
      : d.sop_clause === 'SOP-6' ? 'sop6'
      : 'sop2';
    const tagBg = d.severity === 'critical' || d.severity === 'red' ? '' : 'caution-bg';
    const timeStr = (event.timestamp || '').slice(11, 16);

    // 簡化卡片：只顯示實體名稱 + 一行摘要
    let bodyHtml = `<b>${escapeHtml(d.entity_name || event.location)} (${escapeHtml(d.entity_id || event.affected_segment)})</b>`;

    // 只顯示一行重點
    if (d.sop_clause === 'SOP-2') {
      if (d.primary_route) bodyHtml += `<br>疏散 → ${escapeHtml(d.primary_route_name || d.primary_route)}`;
    } else if (d.sop_clause === 'SOP-5') {
      bodyHtml += `<br>人工指揮派遣`;
    } else if (d.sop_clause === 'SOP-1') {
      const shortBasis = d.basis.split('（')[0] || d.basis;
      bodyHtml += `<br>${escapeHtml(shortBasis)}`;
    }

    const explainType = d.sop_clause === 'SOP-2' ? 'sop2'
      : d.sop_clause === 'SOP-5' ? 'sop5'
      : d.sop_clause === 'SOP-1' && d.entity_id?.startsWith('RD_') ? d.entity_id
      : 'sop2';

    cardsHtml += `
      <div class="alert-card ${sopClass} injected-alert">
        <div class="alert-hdr">
          <span class="alert-tag ${tagBg}">${d.sop_clause || '事件'} ${escapeHtml(d.clause_name || '')}</span>
          ${d.ete_minutes && d.sop_clause !== 'SOP-2' && d.sop_clause !== 'SOP-5' ? `<span class="ete-badge mono">ETE ${d.ete_minutes} min</span>` : ''}
          <span class="mono">${timeStr}</span>
        </div>
        <div class="alert-body">${bodyHtml}</div>
        <button class="btn-explain" onclick="openDrawer('${explainType}')">查看判斷依據</button>
      </div>`;
  });

  // 在 alert-scroll 最前面插入
  container.insertAdjacentHTML('afterbegin', cardsHtml);
}

/* ── 地圖事件標記：閃爍圖示 + 封閉路段標紅 ─────────────────────────────────── */
let incidentMapMarkers = [];
let incidentAffectedSegments = []; // 紀錄被標紅的路段，切換時間點要還原

function clearIncidentMapMarkers() {
  // 移除所有事件 marker
  incidentMapMarkers.forEach(m => { if (mapInstance) mapInstance.removeLayer(m); });
  incidentMapMarkers = [];
  // 清除事件詳情暫存
  window._incidentDetailStore = {};
  // 還原被標紅的路段（恢復為正常配色，等 renderTrafficMap 重新上色）
  incidentAffectedSegments.forEach(segId => {
    if (roadPolylines[segId]) {
      roadPolylines[segId].setStyle({ weight: 5, opacity: 0.9 });
      const el = roadPolylines[segId].getElement();
      if (el) {
        el.classList.remove('road-incident-blink');
        el.style.filter = '';
      }
    }
  });
  incidentAffectedSegments = [];
  // 清除 dashboard 上的注入事件卡片
  const container = document.querySelector('#panel-dashboard .dash-alerts .alert-scroll');
  if (container) {
    container.querySelectorAll('.injected-alert').forEach(el => el.remove());
  }
}

/* ── 指揮官建議 popup 渲染 ──────────────────────────────────────────────── */
function renderCommanderAdvicePopup(advice) {
  if (!advice) return '';
  const levelColor = { red: 'var(--critical, #f27a84)', yellow: 'var(--caution, #eab85c)', green: 'var(--safe, #85d99a)' };

  let reasonsHtml = '';
  if (advice.reasons && advice.reasons.length) {
    reasonsHtml = advice.reasons.map(r => `
      <tr>
        <td class="cmd-adv-label">${escapeHtml(r.label)}</td>
        <td class="cmd-adv-value" style="color:${levelColor[r.level] || 'var(--text)'}">${escapeHtml(r.value)}</td>
      </tr>`).join('');
  }

  let actionsHtml = '';
  if (advice.actions && advice.actions.length) {
    actionsHtml = advice.actions.map(a => {
      const dot = a.level === 'green' ? '▸' : a.level === 'red' ? '✕' : '▹';
      const color = levelColor[a.level] || 'var(--text)';
      return `<div class="cmd-adv-action" style="color:${color}"><span class="cmd-adv-dot">${dot}</span><b>${escapeHtml(a.label)}</b> ${escapeHtml(a.value)}</div>`;
    }).join('');
  }

  return `
    <div class="incident-popup-commander">
      <div class="cmd-adv-header">指揮官建議</div>
      <div class="cmd-adv-summary">${escapeHtml(advice.summary || '')}</div>
      ${reasonsHtml ? `<table class="cmd-adv-table">${reasonsHtml}</table>` : ''}
      ${actionsHtml ? `<div class="cmd-adv-actions">${actionsHtml}</div>` : ''}
    </div>`;
}

function addIncidentMapMarkers(event, decisions, snapshot) {
  if (!mapInstance) return;
  const segId = event.affected_segment;

  // 1. 將受影響路段標紅並加粗（封閉效果）
  if (segId && segId.startsWith('RD_') && roadPolylines[segId]) {
    roadPolylines[segId].setStyle({
      color: '#ff2244',
      weight: 8,
      opacity: 1,
    });
    // 加上閃爍 CSS class
    const el = roadPolylines[segId].getElement();
    if (el) el.classList.add('road-incident-blink');
    incidentAffectedSegments.push(segId);
  }

  // 2. 在事件位置放一個閃爍圖示標記
  let markerCoords = null;

  // 優先使用路段座標的中點
  if (segId && ROAD_COORDS[segId] && ROAD_COORDS[segId].length) {
    const pts = ROAD_COORDS[segId];
    const midIdx = Math.floor(pts.length / 2);
    markerCoords = pts[midIdx];
  }
  // 其次使用站點座標
  if (!markerCoords && segId && STATION_COORDS[segId]) {
    markerCoords = STATION_COORDS[segId];
  }

  if (markerCoords) {
    // 決定圖示：車禍 vs 號誌故障
    const isSignalFailure = event.type === 'Power_Failure' ||
      (event.description && (event.description.includes('號誌') || event.description.includes('信號')));
    const iconEmoji = isSignalFailure ? '🚦' : '🚨';
    const severityColor = event.severity === 'Critical' ? '#ff2244'
      : event.severity === 'High' ? '#f27a84'
      : '#eab85c';

    const icon = L.divIcon({
      className: 'incident-map-marker',
      html: `<div class="incident-marker-pulse" style="--pulse-color:${severityColor}">
        <span class="incident-marker-icon">${iconEmoji}</span>
      </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    const marker = L.marker(markerCoords, { icon, zIndexOffset: 500, pane: 'incidentPane' }).addTo(mapInstance);

    // 點擊閃爍 emoji 圖示時開啟事件詳情 Modal
    if (!window._incidentDetailStore) window._incidentDetailStore = {};
    window._incidentDetailStore[event.event_id] = { event, decisions, snapshot, segId, iconEmoji };
    marker.on('click', () => { openIncidentDetailModal(event.event_id); });

    // 氣泡顯示事件 ID + 點選提示（使用 tooltip 常駐，不受 marker click 影響）
    const labelHtml = `<div class="incident-map-label-id">${escapeHtml(event.event_id)}</div><div class="incident-map-label-hint">點選顯示詳情</div>`;
    marker.bindTooltip(labelHtml, { permanent: true, direction: 'top', offset: [0, -20], className: 'incident-label-tooltip-container', interactive: false, pane: 'incidentTooltipPane' });

    incidentMapMarkers.push(marker);
  }
}

/* ── 事件詳情 Modal ────────────────────────────────────────────────────────── */
function openIncidentDetailModal(eventId) {
  const store = window._incidentDetailStore || {};
  const data = store[eventId];
  if (!data) return;
  const { event, decisions, snapshot, segId, iconEmoji } = data;

  const triggeredSops = decisions.filter(d => d.triggered).map(d => d.sop_clause).filter(Boolean).join('、') || '無';
  const eteDecision = decisions.find(d => d.ete_minutes);
  const cmsDecisions = decisions.filter(d => d.triggered && d.cms_text);
  const adviceDecision = decisions.find(d => d.commander_advice);

  // 組合 CMS 區塊（含發布警告按鈕）
  let cmsHtml = '';
  if (cmsDecisions.length) {
    const cmsItems = cmsDecisions.map(d =>
      `<div class="incident-popup-cms-item"><span class="incident-popup-cms-tag">${d.sop_clause}</span>${escapeHtml(d.cms_text)}</div>`
    ).join('');
    const cmsDataAttr = encodeURIComponent(JSON.stringify(cmsDecisions.map(d => ({ sop: d.sop_clause, text: d.cms_text }))));
    const eventTs = event.timestamp || '';
    cmsHtml = `
      <div class="incident-popup-cms-block">
        <div class="incident-popup-cms-label">CMS</div>
        ${cmsItems}
        <button class="btn-publish-warning" onclick="closeIncidentDetailModal(); openM5CmsModal('${cmsDataAttr}', '${eventTs}')">發布警告</button>
      </div>`;
  }

  const bodyHtml = `
    <div class="incident-popup">
      <div class="incident-popup-title">${iconEmoji} ${escapeHtml(event.event_id)}</div>
      <div class="incident-popup-row"><b>類型</b> ${escapeHtml(event.type)}</div>
      <div class="incident-popup-row"><b>位置</b> ${escapeHtml(event.location)}</div>
      <div class="incident-popup-row"><b>嚴重度</b> <span class="severity-${event.severity.toLowerCase()}">${escapeHtml(event.severity)}</span></div>
      <div class="incident-popup-row"><b>狀態</b> ${escapeHtml(event.status)}</div>
      <div class="incident-popup-row"><b>路段</b> ${escapeHtml(segId)}</div>
      <div class="incident-popup-row"><b>觸發 SOP</b> ${escapeHtml(triggeredSops)}</div>
      ${eteDecision ? `<div class="incident-popup-row"><b>ETE</b> ${eteDecision.ete_minutes} 分鐘</div>` : ''}
      ${cmsHtml}
      ${adviceDecision ? renderCommanderAdvicePopup(adviceDecision.commander_advice) : ''}
      <div class="incident-popup-desc">${escapeHtml(event.description)}</div>
    </div>`;

  document.getElementById('incident-detail-modal-body').innerHTML = bodyHtml;
  document.getElementById('incident-detail-modal-overlay').classList.remove('hidden');
}

function closeIncidentDetailModal() {
  document.getElementById('incident-detail-modal-overlay').classList.add('hidden');
}

function renderDecisionCard(decision, index) {
  const tagClass = decision.triggered ? 'decision-tag' : 'decision-tag muted';
  const explainType = decision.sop_clause === 'SOP-2' ? 'sop2'
                    : decision.sop_clause === 'SOP-5' ? 'sop5'
                    : decision.sop_clause === 'SOP-1' && decision.entity_id?.startsWith('RD_') ? decision.entity_id
                    : `decision:${index}`;
  const routeLine = decision.primary_route
    ? `<p><b>主疏散：</b>${decision.primary_route_name || decision.primary_route} <span class="mono">${decision.primary_route}</span></p>`
    : '';
  const secondaryLine = decision.secondary_routes?.length
    ? `<p><b>次疏散：</b>${decision.secondary_route_names?.join('、') || decision.secondary_routes.join('、')}</p>`
    : '';
  const cmsLine = decision.cms_text ? `<p><b>CMS：</b>${decision.cms_text}</p>` : '';
  const actions = decision.actions?.length
    ? `<ul class="action-list">${decision.actions.map(a => `<li>${a}</li>`).join('')}</ul>`
    : `<p>${decision.basis}</p>`;

  return `
    <div class="decision-card ${decision.triggered ? '' : 'decision-muted'}">
      <div class="decision-hdr">
        <span class="${tagClass}">${decision.sop_clause || '未觸發'} ${decision.clause_name || ''}</span>
        ${decision.ete_minutes ? `<span class="ete-badge mono">ETE ${decision.ete_minutes} min</span>` : ''}
      </div>
      <div class="decision-body">
        ${routeLine}
        ${secondaryLine}
        ${cmsLine}
        ${actions}
      </div>
      <button class="btn-explain" onclick="openDrawer('${explainType}')">查看判斷依據</button>
    </div>`;
}

/* ── Draggable Advisor Orb ─────────────────────────────────────────────────── */
(function initDraggableOrb() {
  const orb = document.getElementById('advisor-orb');
  let isDragging = false, hasMoved = false;
  let startX, startY, origX, origY;

  orb.addEventListener('mousedown', dragStart);
  orb.addEventListener('touchstart', dragStart, { passive: false });

  function dragStart(e) {
    isDragging = true;
    hasMoved = false;
    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    const rect = orb.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    orb.style.transition = 'none';
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
  }

  function dragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved = true;
    if (!hasMoved) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 60, origX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 60, origY + dy));
    orb.style.left = newX + 'px';
    orb.style.top = newY + 'px';
    orb.style.right = 'auto';
    orb.style.bottom = 'auto';
  }

  function dragEnd() {
    isDragging = false;
    orb.style.transition = '';
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('touchend', dragEnd);
    if (!hasMoved) {
      toggleChat();
    }
  }

  orb.removeAttribute('onclick');
})();


/* ══════════════════════════════════════════════════════════════════════════════
   Module 4: 完整決策分析（融合到「查看判斷依據」Drawer）
   ══════════════════════════════════════════════════════════════════════════════ */

async function loadM4DeepAnalysis(segmentId) {
  const container = document.getElementById('m4-analysis-content');
  if (!container) return;
  // Toggle: if already showing, hide it
  if (container.innerHTML.trim() && !container.classList.contains('hidden')) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = `<div class="spinner" style="margin-top:8px">載入模組四決策分析…</div>`;
  try {
    const res = await fetch('/api/reasoning/demo');
    if (!res.ok) throw new Error(await res.text());
    const record = await res.json();
    currentM4Request = {};
    container.innerHTML = renderM4Inline(record);
    setTimeout(runM4CF, 0);
  } catch (e) {
    container.innerHTML = `<div class="card-yellow" style="margin-top:8px">目前時間點尚無事件觸發，請將時間軸調至 22:10 之後查看完整決策分析。</div>`;
  }
}

function renderM4Inline(record) {
  const rec = record.route_candidates?.find(r => r.status === 'recommended');
  const excluded = record.route_candidates?.filter(r => r.status === 'excluded') || [];
  const rel = record.reliability || {};
  const ete = record.ete || {};

  return `
    <div id="m4-ai-summary" class="formula-box align-left" style="border-left:3px solid var(--accent);margin-bottom:14px">
      <div class="formula-title" style="display:flex;align-items:center;gap:6px">
        <span>AI 摘要</span>
        <span class="mono" style="font-size:10px;color:var(--text-dim)" id="m4-summary-source">載入中…</span>
      </div>
      <div id="m4-summary-text" style="font-size:13px;line-height:1.7">${escapeHtml(record.explanation?.summary || '載入中…')}</div>
    </div>

    <div class="decision-summary">
      <span class="decision-tag">${record.classification?.level || '?'} 級</span>
      <span class="ete-badge mono">ETE ${ete.total_minutes?.toFixed(0) || '?'} min</span>
      <span class="ete-badge mono" style="background:rgba(126,200,188,0.15);color:var(--accent)">可靠度 ${((rel.overall || 0) * 100).toFixed(0)}%</span>
    </div>

    <div class="chain" style="margin-top:12px">
      ${(record.evidence_chain || []).map(step => `
        <div class="chain-step active"><div class="node">${step.order}</div><div class="step-text">
          <span class="step-lbl">${escapeHtml(step.title)}</span> ${escapeHtml(step.detail)}
        </div></div>
      `).join('')}
    </div>

    ${rec ? `<div class="formula-box align-left">
      <div class="formula-title">推薦道路</div>
      <div><b>${escapeHtml(rec.name)}</b>（${rec.segment_id}）</div>
      <div class="mono" style="margin-top:4px;font-size:12px;color:var(--text-dim)">容量 ${rec.capacity_vph} vph · 飽和度 ${rec.current_saturation} · 分流後 ${rec.predicted_saturation} · 分數 ${rec.score}</div>
    </div>` : ''}

    ${excluded.length ? `<div class="formula-box align-left">
      <div class="formula-title">排除道路</div>
      ${excluded.map(r => `<div class="excluded-row"><span class="mono">${r.segment_id}</span> ${escapeHtml(r.name)}<br><small>${escapeHtml(r.exclusion_reasons?.join('、') || '')}</small></div>`).join('')}
    </div>` : ''}

    <div class="formula-box">
      <div class="formula-title">ETE 公式</div>
      <div class="formula mono">${escapeHtml(ete.formula || '')}</div>
      <div class="formula-detail mono">= ${ete.base_minutes || 0} + ${ete.congestion_adjustment_minutes || 0} = ${ete.total_minutes || 0} min</div>
    </div>

    <div id="m4-cf-panel" style="margin-top:10px">
      <div class="formula-box align-left">
        <div class="formula-title">反事實分析</div>
        <div class="spinner">分析中…</div>
      </div>
    </div>
  `;
}

async function runM4CF() {
  const panel = document.getElementById('m4-cf-panel');
  if (!panel || panel.dataset.loaded === 'true') return;
  panel.dataset.loaded = 'true';
  panel.innerHTML = `<div class="formula-box align-left"><div class="formula-title">反事實分析</div><div class="spinner">分析中…</div></div>`;
  try {
    const res = await fetch('/api/reasoning/counterfactual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentM4Request || {}),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.results && data.results.length) {
      panel.innerHTML = `<div class="formula-box align-left">
        <div class="formula-title">反事實分析</div>
        ${data.results.map(r => `
          <div class="excluded-row">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px">${escapeHtml(r.narrative)}</div>
            <div class="mono" style="font-size:11px;color:var(--text-dim)">
              欄位：${r.changed_field} · 原始：${r.original_value} · 翻轉：${r.switch_value}
            </div>
          </div>
        `).join('')}
      </div>`;
    } else {
      panel.innerHTML = `<div class="formula-box align-left"><div class="formula-title">反事實分析</div><div class="card-yellow">在搜尋範圍內未找到翻轉點</div></div>`;
    }
  } catch (e) {
    panel.innerHTML = `<div class="formula-box align-left"><div class="formula-title">反事實分析</div><div style="color:var(--critical)">反事實分析失敗：${escapeHtml(e.message)}</div></div>`;
  }
}


async function loadAiSummary(timestamp, eventId) {
  const textEl = document.getElementById('m4-summary-text');
  const sourceEl = document.getElementById('m4-summary-source');
  if (!textEl || !sourceEl) return;
  try {
    let url = `/api/reasoning/summary?timestamp=${encodeURIComponent(timestamp)}`;
    if (eventId) url += `&event_id=${encodeURIComponent(eventId)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    textEl.textContent = data.summary;
    sourceEl.textContent = data.source === 'deterministic' ? 'deterministic' : `${data.source} · ${data.model || ''}`;
  } catch (e) {
    sourceEl.textContent = 'fallback';
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   交控中心建議書 (Advisory Report Modal)
   ══════════════════════════════════════════════════════════════════════════════ */

let advisoryMarkdownCache = '';

function openAdvisoryModal() {
  // 蒐集所有已注入的事件
  const allInjected = Object.values(injectedTimelineData).filter(d => d.event && d.decisions?.length);
  // 也加入 latestIncident（若尚未存在於 injectedTimelineData 中）
  if (latestIncident && latestDecisions.length) {
    const alreadyExists = allInjected.some(d => d.event.event_id === latestIncident.event_id);
    if (!alreadyExists) {
      allInjected.push({ event: latestIncident, decisions: latestDecisions, snapshot: latestSnapshot });
    }
  }

  if (!allInjected.length) {
    alert('請先注入事件並取得 SOP 決策結果');
    return;
  }

  const overlay = document.getElementById('advisory-modal-overlay');
  overlay.classList.remove('hidden');

  if (allInjected.length === 1) {
    // 只有一筆事件，直接產出建議書
    renderAdvisoryReportFor(allInjected[0].event, allInjected[0].decisions, allInjected[0].snapshot);
  } else {
    // 多筆事件，顯示選擇介面
    renderAdvisoryEventSelector(allInjected);
  }
}

function renderAdvisoryEventSelector(injectedList) {
  const body = document.getElementById('advisory-modal-body');
  let html = '<div class="advisory-event-selector">';
  html += '<div class="advisory-sub-title">請選擇要產出建議書的事件：</div>';
  html += '<div class="advisory-event-list">';
  injectedList.forEach((item, idx) => {
    const ev = item.event;
    const triggeredCount = (item.decisions || []).filter(d => d.triggered).length;
    const sopClauses = (item.decisions || []).filter(d => d.triggered).map(d => d.sop_clause).filter(Boolean).join('、') || '無';
    html += `
      <div class="advisory-event-option" onclick="selectAdvisoryEvent(${idx})">
        <div class="advisory-event-option-id"><b>${escapeHtml(ev.event_id)}</b></div>
        <div class="advisory-event-option-desc">${escapeHtml(ev.description || ev.type)}</div>
        <div class="advisory-event-option-meta">
          <span class="mono">${escapeHtml(ev.affected_segment)}</span>
          <span class="advisory-event-severity severity-${ev.severity?.toLowerCase()}">${escapeHtml(ev.severity)}</span>
          <span class="mono">${escapeHtml(ev.timestamp || '')}</span>
        </div>
        <div class="advisory-event-option-sop">觸發 SOP：${escapeHtml(sopClauses)}（${triggeredCount} 筆決策）</div>
      </div>`;
  });
  html += '</div></div>';
  body.innerHTML = html;

  // 暫存列表供 selectAdvisoryEvent 使用
  window._advisoryInjectedList = injectedList;
}

function selectAdvisoryEvent(idx) {
  const list = window._advisoryInjectedList;
  if (!list || !list[idx]) return;
  const item = list[idx];
  renderAdvisoryReportFor(item.event, item.decisions, item.snapshot);
}

function closeAdvisoryModal() {
  document.getElementById('advisory-modal-overlay').classList.add('hidden');
}

function renderAdvisoryReportFor(incident, decisions, snapshot) {
  // 更新全域快取（供複製 Markdown / 模擬發布使用）
  latestIncident = incident;
  latestDecisions = decisions;
  latestSnapshot = snapshot;
  renderAdvisoryReport();
}

function renderAdvisoryReport() {
  const body = document.getElementById('advisory-modal-body');
  const incident = latestIncident;
  const decisions = latestDecisions;
  const snapshot = latestSnapshot;

  // 1. 事件辨識
  const triggeredDecisions = decisions.filter(d => d.triggered);
  const sopClauses = triggeredDecisions.map(d => d.sop_clause).filter(Boolean).join('、') || '無觸發';

  // 事件匯入時間點
  const eventTimestamp = incident.timestamp || '';

  // 2. 交通分級判定
  const seg_id = incident.affected_segment;
  const segData = snapshot?.road_segments?.[seg_id] || snapshot?.stations?.[seg_id];
  const entityName = resolveEntityName(seg_id, snapshot);
  const saturation = segData?.saturation_score;
  const avgSpeed = segData?.avg_speed;
  let levelText = '未達壅塞門檻';
  let levelClass = 'level-normal';
  if (saturation >= 0.95) { levelText = 'A 級（癱瘓）'; levelClass = 'level-a'; }
  else if (saturation >= 0.85) { levelText = 'B 級（壅擠）'; levelClass = 'level-b'; }

  // 3. 替代路徑建議
  const sop2 = triggeredDecisions.find(d => d.sop_clause === 'SOP-2');
  let primaryRouteHtml = '<span class="mono dim">未規劃主疏散路徑</span>';
  let secondaryRouteHtml = '<span class="mono dim">無次要疏散</span>';
  let excludedHtml = '';
  if (sop2) {
    if (sop2.primary_route) {
      const pName = sop2.primary_route_name || snapshot?.road_segments?.[sop2.primary_route]?.name || sop2.primary_route;
      const pSat = snapshot?.road_segments?.[sop2.primary_route]?.saturation_score;
      primaryRouteHtml = `<b>${escapeHtml(pName)}</b> <span class="mono">(${sop2.primary_route})</span>`;
      if (pSat != null) primaryRouteHtml += ` — 飽和度 <span class="mono">${(pSat * 100).toFixed(0)}%</span>`;
    }
    if (sop2.secondary_routes?.length) {
      const secNames = sop2.secondary_routes.map(id => {
        const name = sop2.secondary_route_names?.[sop2.secondary_routes.indexOf(id)]
          || snapshot?.road_segments?.[id]?.name || id;
        return `${name} (${id})`;
      });
      secondaryRouteHtml = secNames.map(n => `<span class="sec-route">${escapeHtml(n)}</span>`).join('、');
    }
    if (sop2.excluded_routes?.length) {
      excludedHtml = sop2.excluded_routes.map(r =>
        `<div class="excluded-item"><span class="mono">${escapeHtml(r.segment_id)}</span>：${escapeHtml(r.reason)}</div>`
      ).join('');
    }
  }

  // 4. 號誌調整建議
  let signalHtml = '';
  const sop1 = triggeredDecisions.find(d => d.sop_clause === 'SOP-1');
  if (sop1 && sop1.actions) {
    signalHtml = sop1.actions.filter(a => a.includes('綠燈') || a.includes('配時')).map(a => `<div class="signal-action">${escapeHtml(a)}</div>`).join('');
  }
  if (!signalHtml && sop2 && sop2.primary_route) {
    const altName = snapshot?.road_segments?.[sop2.primary_route]?.name || sop2.primary_route;
    signalHtml = `<div class="signal-action">替代道路 <b class="signal-alt-road">${escapeHtml(altName)}</b> 綠燈配時 +25%（事件持續期間）</div>`;
  }
  if (!signalHtml) {
    signalHtml = '<span class="mono dim">本次事件未觸發號誌調整</span>';
  }

  // 5. 跨系統聯動（觸發第 3 或第 5 條時，列出對北捷、公車處、警力之請求）
  let crossSystemHtml = '';
  const hasSop3or5 = triggeredDecisions.some(d => d.sop_clause === 'SOP-3' || d.sop_clause === 'SOP-5');
  const cascadeItems = [];
  triggeredDecisions.forEach(d => {
    (d.cascade_checks || []).forEach(c => cascadeItems.push(c));
  });
  if (hasSop3or5 || cascadeItems.length) {
    const requests = [];
    if (triggeredDecisions.some(d => d.sop_clause === 'SOP-5')) {
      const sop5 = triggeredDecisions.find(d => d.sop_clause === 'SOP-5');
      requests.push(`[警力派遣] ${sop5?.entity_name || seg_id} 各路口派遣 2 名警力接管指揮`);
    }
    if (triggeredDecisions.some(d => d.sop_clause === 'SOP-3') || cascadeItems.some(c => c.includes('第 3 條') || c.includes('SOP-3'))) {
      requests.push('[北捷] 建議啟動「過站不停」疏運');
      requests.push('[公車處] 調度接駁專車');
    }
    if (cascadeItems.some(c => c.includes('警力'))) {
      requests.push('[警力] 淨空壅塞路口');
    }
    if (sop2 && incident.severity === 'Critical') {
      requests.push('[警力] 事故現場交管＋主疏散路口疏導');
    }
    crossSystemHtml = requests.map(r => `<div class="cross-system-item">${escapeHtml(r)}</div>`).join('');
  }
  if (!crossSystemHtml) {
    crossSystemHtml = '<span class="mono dim">本次事件未觸發跨系統聯動</span>';
  }

  // ETE
  const eteDecision = triggeredDecisions.find(d => d.ete_minutes);
  const eteText = eteDecision ? `${eteDecision.ete_minutes} 分鐘` : '未計算';

  body.innerHTML = `
    <div class="advisory-report">
      <div class="advisory-section">
        <div class="advisory-section-title">一、事件辨識</div>
        <div class="advisory-field"><span class="af-label">事件 ID</span><span class="af-value mono">${escapeHtml(incident.event_id)}</span></div>
        <div class="advisory-field"><span class="af-label">事件描述</span><span class="af-value">${escapeHtml(incident.description || incident.type)}</span></div>
        <div class="advisory-field"><span class="af-label">事件時間點</span><span class="af-value mono">${escapeHtml(eventTimestamp)}</span></div>
        <div class="advisory-field"><span class="af-label">受影響路段</span><span class="af-value mono">${escapeHtml(incident.affected_segment)} — ${escapeHtml(entityName || '')}</span></div>
        <div class="advisory-field"><span class="af-label">觸發 SOP 條款</span><span class="af-value">${escapeHtml(sopClauses)}</span></div>
        <div class="advisory-field"><span class="af-label">對應條款名稱</span><span class="af-value">${triggeredDecisions.map(d => d.clause_name || '').filter(Boolean).join('、') || '—'}</span></div>
        <div class="advisory-field"><span class="af-label">嚴重度</span><span class="af-value">${escapeHtml(incident.severity)}</span></div>
        <div class="advisory-field"><span class="af-label">狀態</span><span class="af-value">${escapeHtml(incident.status)}</span></div>
        <div class="advisory-field"><span class="af-label">預計恢復時間 (ETE)</span><span class="af-value mono">${eteText}</span></div>
      </div>

      <div class="advisory-section">
        <div class="advisory-section-title">二、交通分級判定</div>
        ${seg_id.startsWith('BS_') ? `
        <div class="advisory-field"><span class="af-label">類型</span><span class="af-value">站點（${escapeHtml(entityName || seg_id)}）</span></div>
        <div class="advisory-field"><span class="af-label">說明</span><span class="af-value">受影響對象為人流站點，非車行路段，不適用路段飽和度分級</span></div>
        ` : `
        <div class="advisory-level ${levelClass}">${levelText} <span class="advisory-level-road">(${escapeHtml(entityName || incident.affected_segment)})</span></div>
        <div class="advisory-field"><span class="af-label">路段飽和度</span><span class="af-value mono">${saturation != null ? (saturation * 100).toFixed(1) + '%' : 'N/A'}</span></div>
        <div class="advisory-field"><span class="af-label">平均車速</span><span class="af-value mono">${avgSpeed != null ? avgSpeed + ' km/h' : 'N/A'}</span></div>
        <div class="advisory-field"><span class="af-label">判定依據</span><span class="af-value">A 級：Saturation_Score >= 0.95；B 級：0.85 <= Saturation_Score < 0.95</span></div>
        ${sop1 ? `<div class="advisory-field"><span class="af-label">SOP-1 判定</span><span class="af-value">${escapeHtml(sop1.basis)}</span></div>` : ''}
        `}
      </div>

      <div class="advisory-section">
        <div class="advisory-section-title">三、替代路徑建議</div>
        <div class="advisory-field"><span class="af-label">主要疏散</span><span class="af-value">${primaryRouteHtml}</span></div>
        <div class="advisory-field"><span class="af-label">次要替代</span><span class="af-value">${secondaryRouteHtml}</span></div>
        ${excludedHtml ? `<div class="advisory-sub-title">排除候選及理由</div><div class="excluded-list">${excludedHtml}</div>` : ''}
        ${sop2 ? `<div class="advisory-sub-title">SOP-2 判定依據</div><div class="advisory-basis">${escapeHtml(sop2.basis)}</div>` : ''}
      </div>

      <div class="advisory-section">
        <div class="advisory-section-title">四、號誌調整建議</div>
        ${signalHtml}
      </div>

      <div class="advisory-section">
        <div class="advisory-section-title">五、跨系統聯動</div>
        ${(() => {
          // 直接輸出 Module 1 在該事件時間點已判斷出的 SOP-3 和 SOP-5 結果
          const m1Triggers = latestDashboardTriggers || [];
          const m1Sop3 = m1Triggers.find(t => t.sop_clause === '第 3 條');
          const m2Sop5 = triggeredDecisions.find(d => d.sop_clause === 'SOP-5');
          let refHtml = '';

          // ═══ SOP 第 3 條：捷運與接駁分流 ═══
          refHtml += '<div class="advisory-sub-title sop-rule-header">SOP3 - 捷運與接駁分流</div>';
          refHtml += '<div class="advisory-ref-block">';
          if (m1Sop3) {
            refHtml += '<div class="sop-rule-result triggered">';
            refHtml += '<div class="advisory-field"><span class="af-label">判定結果</span><span class="af-value sop-triggered">已觸發 ✓</span></div>';
            refHtml += `<div class="advisory-field"><span class="af-label">站點</span><span class="af-value">${escapeHtml(m1Sop3.entity_name || '')} (${escapeHtml(m1Sop3.entity_id || '')})</span></div>`;
            refHtml += `<div class="advisory-field"><span class="af-label">判定依據</span><span class="af-value">${escapeHtml(m1Sop3.basis)}</span></div>`;
            refHtml += `<div class="advisory-field"><span class="af-label">時間點</span><span class="af-value mono">${escapeHtml(m1Sop3.timestamp || eventTimestamp)}</span></div>`;
            refHtml += '</div>';
            refHtml += '<div class="sop-rule-actions">';
            refHtml += '<div class="advisory-sub-title">▸ 對外請求</div>';
            refHtml += '<div class="cross-system-item"><b>[北捷]</b> 建議啟動「過站不停」疏運模式</div>';
            refHtml += '<div class="cross-system-item"><b>[公車處]</b> 通知調度接駁專車</div>';
            refHtml += '<div class="cross-system-item"><b>[引導]</b> 引導群眾步行至 BS_MRT_BL18（捷運市政府站）</div>';
            refHtml += '</div>';
          } else {
            refHtml += '<div class="sop-rule-result not-triggered">';
            refHtml += '<div class="advisory-field"><span class="af-label">判定結果</span><span class="af-value mono dim">未觸發 — BS_MRT_BL17 當前未達分流門檻</span></div>';
            refHtml += '</div>';
          }
          refHtml += '</div>';

          // ═══ SOP 第 5 條：號誌故障應變 ═══
          refHtml += '<div class="advisory-sub-title sop-rule-header">SOP5 - 號誌故障應變</div>';
          refHtml += '<div class="advisory-ref-block">';
          if (m2Sop5) {
            refHtml += '<div class="sop-rule-result triggered">';
            refHtml += '<div class="advisory-field"><span class="af-label">判定結果</span><span class="af-value sop-triggered">已觸發 ✓</span></div>';
            refHtml += `<div class="advisory-field"><span class="af-label">受影響路段</span><span class="af-value">${escapeHtml(m2Sop5.entity_name || '')} (${escapeHtml(m2Sop5.entity_id || '')})</span></div>`;
            refHtml += `<div class="advisory-field"><span class="af-label">判定依據</span><span class="af-value">${escapeHtml(m2Sop5.basis)}</span></div>`;
            if (m2Sop5.cms_text) refHtml += `<div class="advisory-field"><span class="af-label">CMS 文字</span><span class="af-value">${escapeHtml(m2Sop5.cms_text)}</span></div>`;
            if (m2Sop5.ete_minutes) refHtml += `<div class="advisory-field"><span class="af-label">估計持續時間</span><span class="af-value mono">${m2Sop5.ete_minutes} 分鐘</span></div>`;
            refHtml += `<div class="advisory-field"><span class="af-label">時間點</span><span class="af-value mono">${escapeHtml(m2Sop5.timestamp || eventTimestamp)}</span></div>`;
            refHtml += '</div>';
            refHtml += '<div class="sop-rule-actions">';
            refHtml += '<div class="advisory-sub-title">▸ 對外請求</div>';
            if (m2Sop5.actions?.length) {
              m2Sop5.actions
                .filter(a => !a.startsWith('CMS 更新') && !a.startsWith('指揮官建議'))
                .forEach(a => {
                  refHtml += `<div class="cross-system-item"><b>[警力]</b> ${escapeHtml(a)}</div>`;
                });
            } else {
              refHtml += `<div class="cross-system-item"><b>[警力]</b> ${escapeHtml(m2Sop5.entity_name || '')} 各路口派遣 2 名警力接管指揮</div>`;
            }
            refHtml += '</div>';
          } else {
            refHtml += '<div class="sop-rule-result not-triggered">';
            refHtml += '<div class="advisory-field"><span class="af-label">判定結果</span><span class="af-value mono dim">未觸發 — 本次事件非號誌故障類型</span></div>';
            refHtml += '</div>';
          }
          refHtml += '</div>';

          return refHtml;
        })()}
      </div>
    </div>`;

  // 預先快取 Markdown 版本
  advisoryMarkdownCache = generateAdvisoryMarkdown(incident, decisions, snapshot);
}

function generateAdvisoryMarkdown(incident, decisions, snapshot) {
  const triggeredDecisions = decisions.filter(d => d.triggered);
  const sopClauses = triggeredDecisions.map(d => d.sop_clause).filter(Boolean).join('、') || '無觸發';
  const seg_id = incident.affected_segment;
  const segData = snapshot?.road_segments?.[seg_id] || snapshot?.stations?.[seg_id];
  const entityName = resolveEntityName(seg_id, snapshot);
  const saturation = segData?.saturation_score;
  const avgSpeed = segData?.avg_speed;
  let levelText = '未達壅塞門檻';
  if (saturation >= 0.95) levelText = 'A 級（癱瘓）';
  else if (saturation >= 0.85) levelText = 'B 級（壅擠）';

  const sop2 = triggeredDecisions.find(d => d.sop_clause === 'SOP-2');
  const sop1 = triggeredDecisions.find(d => d.sop_clause === 'SOP-1');
  const sop5 = triggeredDecisions.find(d => d.sop_clause === 'SOP-5');
  const eteDecision = triggeredDecisions.find(d => d.ete_minutes);
  const eteText = eteDecision ? `${eteDecision.ete_minutes} 分鐘` : '未計算';

  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  let md = `# 交控中心建議書\n\n`;
  md += `> 發布時間：${timeStr}  \n`;
  md += `> 事件 ID：${incident.event_id}  \n`;
  md += `> 系統：SQUIRREL 交通指揮中心\n\n`;
  md += `---\n\n`;

  md += `## 一、事件辨識\n\n`;
  md += `| 欄位 | 內容 |\n|------|------|\n`;
  md += `| 事件 ID | ${incident.event_id} |\n`;
  md += `| 事件類型 | ${incident.type} |\n`;
  md += `| 事件描述 | ${incident.description || incident.type} |\n`;
  md += `| 事件時間點 | ${incident.timestamp || 'N/A'} |\n`;
  md += `| 受影響路段 | ${seg_id} — ${entityName || ''} |\n`;
  md += `| 觸發 SOP 條款 | ${sopClauses} |\n`;
  md += `| 嚴重度 | ${incident.severity} |\n`;
  md += `| 狀態 | ${incident.status} |\n`;
  md += `| ETE 預計恢復 | ${eteText} |\n\n`;

  md += `## 二、交通分級判定\n\n`;
  if (seg_id.startsWith('BS_')) {
    md += `- **類型**：站點（${entityName || seg_id}）\n`;
    md += `- **說明**：受影響對象為人流站點，非車行路段，不適用路段飽和度分級\n`;
  } else {
    md += `- **分級結果**：${levelText}（${entityName || seg_id}）\n`;
    md += `- **路段飽和度**：${saturation != null ? (saturation * 100).toFixed(1) + '%' : 'N/A'}\n`;
    md += `- **平均車速**：${avgSpeed != null ? avgSpeed + ' km/h' : 'N/A'}\n`;
    md += `- **判定依據**：A 級 Saturation_Score >= 0.95；B 級 >= 0.85 且 < 0.95\n`;
    if (sop1) md += `- **SOP-1 判定**：${sop1.basis}\n`;
  }
  md += `\n`;

  md += `## 三、替代路徑建議\n\n`;
  if (sop2 && sop2.primary_route) {
    const pName = snapshot?.road_segments?.[sop2.primary_route]?.name || sop2.primary_route;
    const pSat = snapshot?.road_segments?.[sop2.primary_route]?.saturation_score;
    md += `### 主要疏散\n\n`;
    md += `- **路段**：${pName} (${sop2.primary_route})\n`;
    if (pSat != null) md += `- **當前飽和度**：${(pSat * 100).toFixed(1)}%\n`;
    md += `\n`;
  }
  if (sop2?.secondary_routes?.length) {
    md += `### 次要替代\n\n`;
    sop2.secondary_routes.forEach(id => {
      const name = snapshot?.road_segments?.[id]?.name || id;
      md += `- ${name} (${id})\n`;
    });
    md += `\n`;
  }
  if (sop2?.excluded_routes?.length) {
    md += `### 排除候選及理由\n\n`;
    sop2.excluded_routes.forEach(r => {
      md += `- **${r.segment_id}**：${r.reason}\n`;
    });
    md += `\n`;
  }
  if (sop2) {
    md += `### SOP-2 判定依據\n\n`;
    md += `${sop2.basis}\n\n`;
  }
  if (!sop2) {
    md += `> 本次事件未觸發路網重規劃（SOP-2 未達條件）\n\n`;
  }

  md += `## 四、號誌調整建議\n\n`;
  if (sop1 && sop1.actions) {
    sop1.actions.filter(a => a.includes('綠燈') || a.includes('配時')).forEach(a => {
      md += `- ${a}\n`;
    });
  } else if (sop2 && sop2.primary_route) {
    const altName = snapshot?.road_segments?.[sop2.primary_route]?.name || sop2.primary_route;
    md += `- 替代道路 **${altName}** 綠燈配時 +25%（事件持續期間）\n`;
  } else {
    md += `> 本次事件未觸發號誌調整\n`;
  }
  md += `\n`;

  md += `## 五、跨系統聯動\n\n`;

  // Module 1 即時警報 SOP-3 / SOP-5 完整判定結果
  const m1Triggers = latestDashboardTriggers || [];
  const m1Sop3 = m1Triggers.find(t => t.sop_clause === '第 3 條');

  md += `### ═══ 3. 捷運與接駁分流 ═══\n\n`;

  if (m1Sop3) {
    md += `**判定結果：已觸發 ✓**\n\n`;
    md += `- **站點**：${m1Sop3.entity_name || ''} (${m1Sop3.entity_id || ''})\n`;
    md += `- **判定依據**：${m1Sop3.basis}\n`;
    md += `- **時間點**：${m1Sop3.timestamp || incident.timestamp || ''}\n\n`;
    md += `**對外請求：**\n\n`;
    md += `- **[北捷]** 建議啟動「過站不停」疏運模式\n`;
    md += `- **[公車處]** 通知調度接駁專車\n`;
    md += `- **[引導]** 引導群眾步行至 BS_MRT_BL18（捷運市政府站）\n\n`;
  } else {
    md += `**判定結果：未觸發** — BS_MRT_BL17 當前未達分流門檻\n\n`;
  }

  md += `### ═══ 5. 號誌故障應變 ═══\n\n`;

  if (sop5) {
    md += `**判定結果：已觸發 ✓**\n\n`;
    md += `- **受影響路段**：${sop5.entity_name || ''} (${sop5.entity_id || ''})\n`;
    md += `- **判定依據**：${sop5.basis}\n`;
    if (sop5.cms_text) md += `- **CMS 文字**：${sop5.cms_text}\n`;
    if (sop5.ete_minutes) md += `- **估計持續時間**：${sop5.ete_minutes} 分鐘\n`;
    md += `- **時間點**：${sop5.timestamp || incident.timestamp || ''}\n\n`;
    md += `**對外請求：**\n\n`;
    if (sop5.actions?.length) {
      sop5.actions
        .filter(a => !a.startsWith('CMS 更新') && !a.startsWith('指揮官建議'))
        .forEach(a => { md += `- **[警力]** ${a}\n`; });
    } else {
      md += `- **[警力]** ${sop5.entity_name || ''} 各路口派遣 2 名警力接管指揮\n`;
    }
    md += `\n`;
  } else {
    md += `**判定結果：未觸發** — 本次事件非號誌故障類型\n\n`;
  }

  md += `---\n\n`;
  md += `*本建議書由 SQUIRREL 交通指揮中心自動產出，僅供決策參考。*\n`;

  return md;
}

function copyAdvisoryMarkdown() {
  if (!advisoryMarkdownCache) {
    alert('尚無建議書內容');
    return;
  }
  navigator.clipboard.writeText(advisoryMarkdownCache).then(() => {
    alert('已複製建議書 Markdown 至剪貼簿');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = advisoryMarkdownCache;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('已複製建議書 Markdown 至剪貼簿');
  });
}

/* ── 模擬發布事件書 ─────────────────────────────────────────────────────── */
function showPublishSimulation() {
  const overlay = document.getElementById('publish-sim-modal-overlay');
  const body = document.getElementById('publish-sim-body');
  overlay.classList.remove('hidden');

  // Render markdown as formatted HTML preview
  const md = advisoryMarkdownCache || generateAdvisoryMarkdown(latestIncident, latestDecisions, latestSnapshot);
  body.innerHTML = `
    <div class="publish-sim-preview">
      <div class="publish-sim-header">
        <span class="publish-badge">DRAFT</span>
        <span class="publish-time">${new Date().toLocaleString('zh-TW')}</span>
      </div>
      <pre class="publish-md-content">${escapeHtml(md)}</pre>
    </div>`;
}

function closePublishSimModal() {
  document.getElementById('publish-sim-modal-overlay').classList.add('hidden');
}

function copyPublishMarkdown() {
  const md = advisoryMarkdownCache || '';
  navigator.clipboard.writeText(md).then(() => {
    alert('已複製事件書全文至剪貼簿');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('已複製事件書全文至剪貼簿');
  });
}

function confirmPublish() {
  const body = document.getElementById('publish-sim-body');
  body.innerHTML += `
    <div class="publish-confirm-banner">
      <span class="publish-confirm-icon">[V]</span>
      <span>建議書已模擬發布成功（模擬模式：實際系統未傳送）</span>
    </div>`;
  // Change badge to SENT
  const badge = body.querySelector('.publish-badge');
  if (badge) { badge.textContent = 'SENT'; badge.classList.add('sent'); }
}
