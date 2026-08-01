/* ── Leaflet Map Init ──────────────────────────────────────────────────────── */
let mapInstance = null;
let roadPolylines = {};
let stationMarkers = {};
let latestDecisions = [];
let latestSnapshot = null;
let latestIncident = null;

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
  mapInstance.getPane('stationPane').style.zIndex = 450;
  // 地圖高度改用 flex:1 撐滿面板剩餘空間（見 style.css .map-wrap），視窗尺寸變動時
  // 容器實際像素高度會跟著變，Leaflet 需要重新量測才不會顯示錯位/留白。
  window.addEventListener('resize', () => mapInstance.invalidateSize());

  // 模組 5 的觸發站點要先拿到，儀表板右側 SOP-6 卡片才能顯示真實資料
  loadModule5Status().then(() => {
    showModule5Toast();
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
    renderTrafficKPI(computeTrafficSummary(data.segments));
    renderTrafficAlerts(data.segments, dashboard);
    renderTrafficMap(data.segments);
    renderSegmentStatusList(data.segments);
  } catch (e) { console.error('車流資料載入失敗', e); }
}

/* ── 模組一：基地台狀態（左側常駐面板，資料來源與模組5共用 /api/signal/stations）── */
async function loadBaseStationPanel(timestamp) {
  try {
    const url = timestamp ? `/api/signal/stations?timestamp=${encodeURIComponent(timestamp)}` : '/api/signal/stations';
    const res = await fetch(url);
    const data = await res.json();
    renderBaseStationPanel(data.stations || []);
    renderStationMarkers(data.stations || []);
  } catch (e) {
    console.error('基地台狀態載入失敗', e);
    const el = document.getElementById('station-status-list');
    if (el) el.innerHTML = '<div class="station-row">基地台狀態載入失敗</div>';
  }
}

/* ── 模組一：地圖站點標記（滑鼠移上去顯示人流成長率等即時狀況）───────────────── */
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
    const tooltipHtml = `
      <b>${s.station_name}</b><br>
      人流 ${s.user_count.toLocaleString()} 人 · 成長率 ${growthSign}${growthPct}%<br>
      外籍旅客比例 ${roamingPct}%${s.roaming_rate >= 0.30 ? '（已達門檻）' : ''}`;

    if (stationMarkers[s.station_id]) {
      stationMarkers[s.station_id].setTooltipContent(tooltipHtml);
    } else {
      const marker = L.circleMarker(coords, {
        pane: 'stationPane',
        radius: 6, color: '#fff', weight: 1.5,
        fillColor: s.roaming_rate >= 0.30 ? '#f27a84' : '#7ec8bc',
        fillOpacity: 0.9,
      }).addTo(mapInstance);
      marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -6], className: 'map-tooltip', opacity: 1 });
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
  }, 1200 / timelineSpeed);
}

async function loadSnapshotAt(timestamp) {
  try {
    // /api/dashboard 是 /api/snapshot 的超集：同一份快照之外，還多附上門檻判斷
    // （triggers）、這次新觸發的項目（newly_triggered）跟 LLM 趨勢摘要（summary），
    // 一次打完不用再分開呼叫 /api/snapshot。
    // 模組五（基地台狀態／SOP-6 多語卡）跟模組一原本是兩套獨立系統，這裡一起帶
    // 同一個 timestamp，讓整個儀表板（含地圖站點標記）都跟著時間軸走，不會有
    // 「時間軸調到 18:00，SOP-6 卡片卻還停在最新時間點」的不一致。
    const [dashRes] = await Promise.all([
      fetch(`/api/dashboard?timestamp=${encodeURIComponent(timestamp)}`),
      loadModule5Status(timestamp),
      loadBaseStationPanel(timestamp),
    ]);
    const dashboard = await dashRes.json();
    const segments = snapshotToSegments(dashboard.snapshot);
    renderTrafficKPI(computeTrafficSummary(segments));
    renderTrafficAlerts(segments, dashboard);
    renderTrafficMap(segments);
    renderSegmentStatusList(segments);
  } catch (e) { console.error('快照載入失敗', e); }
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

function renderTrafficKPI(summary) {
  document.getElementById('ks-speed-value').textContent = summary.avg_speed;
  const speedDelta = document.getElementById('ks-speed-delta');
  speedDelta.textContent = summary.avg_speed < 25 ? '▲ 壅塞' : '▼ 順暢';
  speedDelta.className = 'ks-delta ' + (summary.avg_speed < 25 ? 'up' : 'down');

  document.getElementById('ks-sat-value').textContent = Math.round(summary.avg_saturation * 100);
  const satDelta = document.getElementById('ks-sat-delta');
  satDelta.textContent = summary.avg_saturation >= 0.85 ? '超過門檻' : '低於門檻';
  satDelta.className = 'ks-delta ' + (summary.avg_saturation >= 0.85 ? 'up' : 'down');

  const segCount = summary.a_count + summary.b_count;
  document.getElementById('ks-seg-value').textContent = segCount;
  document.getElementById('ks-seg-total').textContent = `/ ${summary.total}`;
  const segDelta = document.getElementById('ks-seg-delta');
  segDelta.textContent = segCount > 0 ? '需留意' : '全線正常';
  segDelta.className = 'ks-delta ' + (segCount > 0 ? 'up' : 'down');

  document.getElementById('ks-impact-value').textContent = (summary.impacted / 1000).toFixed(1);
}

function renderTrafficAlerts(segments, dashboard) {
  const container = document.querySelector('#panel-dashboard .dash-alerts');
  const alerts = segments.filter(s => s.level === 'A' || s.level === 'B')
                         .sort((a, b) => b.Saturation_Score - a.Saturation_Score);

  let html = '<h3>即時警報</h3><div class="alert-scroll">';
  html += renderAiSummaryCard(dashboard);
  html += renderSop3Card(dashboard);
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

  html += renderModule5AlertCard();
  html += '</div>';
  container.innerHTML = html;
}

/* ── 模組一：AI 趨勢摘要卡（LLM 產出，只有本次有新觸發門檻時才有內容）───────── */
function renderAiSummaryCard(dashboard) {
  if (!dashboard || !dashboard.summary) return '';
  return `
    <div class="alert-card ai-summary">
      <div class="alert-hdr"><span class="alert-tag accent-bg">分析摘要</span><span class="mono">${(dashboard.timestamp || '').slice(11, 16)}</span></div>
      <div class="alert-body">${escapeHtml(dashboard.summary).replace(/\n/g, '<br>')}</div>
    </div>`;
}

/* ── 模組一：SOP-3 捷運分流門檻卡（BS_MRT_BL17 Growth_Rate>0.30 或 User_Count>25000）── */
function renderSop3Card(dashboard) {
  const sop3 = (dashboard?.triggers || []).find(t => t.sop_clause === '第 3 條');
  if (sop3) {
    return `
      <div class="alert-card sop3">
        <div class="alert-hdr"><span class="alert-tag safe-bg">SOP-3 捷運分流</span></div>
        <div class="alert-body">
          <b>${sop3.entity_name}</b><br>
          ${sop3.basis}
        </div>
        <button class="btn-explain" onclick="showEntityHistory('${sop3.entity_id}', '${sop3.entity_name}')">查看歷史趨勢</button>
      </div>`;
  }
  return `
    <div class="alert-card sop3">
      <div class="alert-hdr"><span class="alert-tag muted-bg">SOP-3 捷運分流</span></div>
      <div class="alert-body">目前 BS_MRT_BL17（捷運國父紀念館站）未達分流門檻</div>
    </div>`;
}

/* ── 模組五：多語通報卡片（真實資料，不是寫死文字）─────────────────────────── */
function renderModule5AlertCard() {
  if (!m5Triggered || !m5Triggered.length) {
    return `
    <div class="alert-card sop6">
      <div class="alert-hdr"><span class="alert-tag accent-bg">SOP-6 多語</span></div>
      <div class="alert-body">目前無站點外籍旅客比例達 30% 門檻</div>
      <button class="btn-explain" onclick="openModule5Modal()">查看站點狀態</button>
    </div>`;
  }
  const sorted = [...m5Triggered].sort((a, b) => b.roaming_rate - a.roaming_rate);
  const stationLines = sorted.map(s =>
    `<b>${s.station_name}</b> (${s.station_id}) — <span class="mono critical-text">${(s.roaming_rate * 100).toFixed(1)}%</span>`
  ).join('<br>');
  return `
    <div class="alert-card sop6">
      <div class="alert-hdr"><span class="alert-tag accent-bg">SOP-6 多語</span><span class="mono">${sorted.length} 站觸發</span></div>
      <div class="alert-body">
        ${stationLines}
      </div>
      <button class="btn-explain" onclick="openModule5Modal()">查看多語通報</button>
    </div>`;
}

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
      roadPolylines[s.Segment_ID] = line;
    }
  });

  // 加入站點標記（捷運站、地標、公車轉運站）— 來自 Module 2 TrafficMap
  if (!window._stationMarkersAdded) {
    window._stationMarkersAdded = true;
    const stations = [
      { id: "BS_MRT_BL17", name: "捷運國父紀念館站", type: "mrt", coords: [25.0408, 121.5576] },
      { id: "BS_MRT_BL16", name: "捷運忠孝敦化站",   type: "mrt", coords: [25.0415, 121.5483] },
      { id: "BS_MRT_BL18", name: "捷運市政府站",     type: "mrt", coords: [25.0406, 121.5659] },
      { id: "BS_TPE_DOME", name: "大巨蛋",           type: "venue", coords: [25.0357, 121.5573] },
      { id: "BS_TPE_101",  name: "台北101",           type: "landmark", coords: [25.0339, 121.5645] },
      { id: "BS_XY_VIESHOW", name: "信義威秀",       type: "venue", coords: [25.0380, 121.5680] },
      { id: "BS_XY_ATT",  name: "ATT4FUN",           type: "venue", coords: [25.0368, 121.5680] },
      { id: "BS_BUS_TERM", name: "市府轉運站",       type: "bus",   coords: [25.0405, 121.5660] },
      { id: "BS_SS_PARK", name: "松山文創園區",      type: "venue", coords: [25.0462, 121.5605] },
    ];
    stations.forEach(st => {
      const color = st.type === 'mrt' ? '#00cec9' : st.type === 'bus' ? '#fdcb6e' : '#fd79a8';
      const size = st.type === 'mrt' ? 14 : 12;
      const radius = st.type === 'mrt' ? '50%' : st.type === 'venue' ? '3px' : '50%';
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:${radius};background:${color};border:2px solid #fff;box-shadow:0 0 6px ${color}aa;"></div>`,
        iconSize: [size, size], iconAnchor: [size/2, size/2],
      });
      const marker = L.marker(st.coords, { icon, zIndexOffset: 200 }).addTo(mapInstance);
      const typeLabel = st.type === 'mrt' ? '[捷運]' : st.type === 'bus' ? '[公車]' : '[地標]';
      marker.bindPopup(`<div style="font-family:sans-serif;min-width:140px"><b style="font-size:13px">${st.name}</b><div style="font-size:11px;color:#888;margin-top:4px">${typeLabel}</div></div>`);
    });
  }
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
}

async function renderDrawerContent(type) {
  const titleEl = document.getElementById('drawer-title');
  const bodyEl = document.getElementById('drawer-body-content');

  if (type === 'sop2') {
    titleEl.textContent = '判斷依據 — SOP-2 主疏散路徑';
    const decision = latestDecisions.find(d => d.sop_clause === 'SOP-2');
    bodyEl.innerHTML = decision ? renderDecisionExplanation(decision) : emptyDecisionHint('SOP-2');
    return;
  }

  if (type === 'sop5') {
    titleEl.textContent = '判斷依據 — SOP-5 號誌故障應變';
    const decision = latestDecisions.find(d => d.sop_clause === 'SOP-5');
    bodyEl.innerHTML = decision ? renderDecisionExplanation(decision) : emptyDecisionHint('SOP-5');
    return;
  }

  if (type.startsWith('decision:')) {
    const index = Number(type.split(':')[1]);
    const decision = latestDecisions[index];
    titleEl.textContent = '判斷依據 — 未觸發 / 轉交判斷';
    bodyEl.innerHTML = decision ? renderDecisionExplanation(decision) : emptyDecisionHint('該決策');
    return;
  }

  // 其餘一律當成 SOP-1 壅塞分級的路段 ID 查詢
  titleEl.textContent = '判斷依據 — 決策解釋鏈';
  bodyEl.innerHTML = `<div class="spinner">載入決策分析…</div>`;
  const currentTs = timelineTimestamps[timelineIndex] || '2026-05-20 22:15';
  try {
    const res = await fetch(`/api/reasoning/demo?timestamp=${encodeURIComponent(currentTs)}&event_id=TPE_2026_ACC_001`);
    if (!res.ok) throw new Error(await res.text());
    const record = await res.json();
    bodyEl.innerHTML = renderM4Inline(record);
    // Async load AI summary from Ollama (non-blocking)
    loadAiSummary(currentTs);
  } catch (e) {
    // Fallback to original SOP-1 display if M4 fails
    try {
      const [segRes, netRes] = await Promise.all([
        fetch('/api/traffic/segments'),
        fetch('/api/traffic/network'),
      ]);
      const segData = await segRes.json();
      const netData = await netRes.json();
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
        <div class="card-yellow" style="margin-top:10px">模組四詳細分析載入失敗：${escapeHtml(e.message)}</div>`;
    } catch (e2) {
      bodyEl.innerHTML = `<p>資料載入失敗：${escapeHtml(e2.message)}</p>`;
    }
  }
}

function emptyDecisionHint(clause) {
  return `<div class="card-yellow">尚未有 ${clause} 的真實決策資料。請先在「事件處置」注入會觸發該 SOP 的情境事件。</div>`;
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

/* ── 模組五：多語通報 Toast ─────────────────────────────────────────────────
   真實資料來源：/api/signal/triggered，帶 timestamp 讓 m5Triggered（供即時警報
   欄的 SOP-6 卡片使用）跟著模組一時間軸走。但 toast 本身「只在」頁面載入／按
   鈴鐺時彈出，不會跟著時間軸每一格都跳，避免快速拖動時 toast 一直閃現互蓋。 */
let m5Triggered = [];

async function loadModule5Status(timestamp) {
  try {
    const url = timestamp ? `/api/signal/triggered?timestamp=${encodeURIComponent(timestamp)}` : '/api/signal/triggered';
    const res = await fetch(url);
    const data = await res.json();
    m5Triggered = data.triggered || [];
  } catch (e) {
    console.error('模組 5 狀態載入失敗', e);
  }
}

function showModule5Toast() {
  if (m5Triggered.length) {
    const top = [...m5Triggered].sort((a, b) => b.roaming_rate - a.roaming_rate)[0];
    const more = m5Triggered.length > 1 ? `等 ${m5Triggered.length} 個站點` : '';
    document.getElementById('toast-text').textContent =
      `${top.station_name}${more} 外籍旅客比例達 ${(top.roaming_rate * 100).toFixed(0)}%，超過 SOP 第 6 條 30% 門檻`;
  } else {
    document.getElementById('toast-text').textContent = '目前無站點外籍旅客比例達 30% 門檻';
  }
  document.getElementById('toast').classList.remove('hidden');
}
function closeToast() {
  document.getElementById('toast').classList.add('hidden');
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
    m5Alerts = data.alerts;
    m5RenderEditor(multi);
    document.getElementById('m5-btn-publish').disabled = false;
    if (data.source === 'mock') {
      document.getElementById('m5-sop-banner').insertAdjacentHTML('beforeend',
        `<div class="card-yellow" style="margin-top:8px">Ollama 未連線，目前顯示為預設模板文字（${data.ollama_status?.message || ''}）</div>`);
    }
  } catch (e) {
    alert('生成失敗：' + e.message);
  } finally {
    document.getElementById('m5-spinner').classList.add('hidden');
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

/* ── Incident Injection ────────────────────────────────────────────────────── */
function showInjectLoading() {
  const panel = document.querySelector('#panel-incident');
  if (!panel) return;
  // Remove existing overlay if any
  const existing = panel.querySelector('.inject-loading-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'inject-loading-overlay';
  overlay.innerHTML = `<div class="loading-spinner"></div><div class="loading-text">SOP 規則引擎運算中…</div>`;
  panel.appendChild(overlay);
}
function hideInjectLoading() {
  const overlay = document.querySelector('.inject-loading-overlay');
  if (overlay) overlay.remove();
}

async function injectIncident(eventId) {
  showInjectLoading();
  try {
    const listRes = await fetch('/api/incidents/list');
    const listData = await listRes.json();
    const event = listData.incidents.find(i => i.event_id === eventId);
    if (!event) { hideInjectLoading(); alert('找不到該事件'); return; }

    const res = await fetch('/api/incidents/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const data = await res.json();
    hideInjectLoading();
    if (data.success) {
      latestIncident = data.event;
      latestDecisions = data.decisions || [];
      latestSnapshot = data.snapshot || null;
      showInjectResult(data);
    }
  } catch (e) {
    alert('注入失敗：' + e.message);
  }
}

async function submitCustomIncident(event) {
  event.preventDefault();
  const now = new Date();
  const fallbackId = `CUSTOM_${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
  const affected = document.getElementById('custom-segment').value.trim();
  const affectedRoad = document.getElementById('custom-affected-road').value.trim() || null;
  const location = document.getElementById('custom-location').value.trim() || affected;
  const payload = {
    event_id: document.getElementById('custom-event-id').value.trim() || fallbackId,
    type: document.getElementById('custom-type').value,
    location,
    affected_segment: affected,
    affected_road: affectedRoad,
    severity: document.getElementById('custom-severity').value,
    status: document.getElementById('custom-status').value,
    description: document.getElementById('custom-description').value.trim(),
    timestamp: latestSnapshot?.timestamp || '2026-05-20 22:30',
  };
  if (!payload.affected_segment) {
    alert('請選擇目標路段或站點');
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
    const data = await res.json();
    hideInjectLoading();
    if (data.success) {
      latestIncident = data.event;
      latestDecisions = data.decisions || [];
      latestSnapshot = data.snapshot || null;
      showInjectResult(data);
      loadIncidentData();
    } else {
      alert('注入失敗');
    }
  } catch (e) {
    alert('注入失敗：' + e.message);
  }
}

function showInjectResult(data) {
  const container = document.getElementById('decision-cards');
  const event = data.event;
  const decisions = data.decisions || [];
  const elapsed = data.processing_time_ms ?? 0;

  // Extract CMS texts and guidance texts from all decisions, grouped by SOP clause
  const highlightMap = {};
  decisions.forEach(d => {
    if (d.cms_text || d.guidance_text) {
      const key = d.sop_clause || 'other';
      if (!highlightMap[key]) highlightMap[key] = { clause: d.sop_clause, cms: null, guidance: null };
      if (d.cms_text) highlightMap[key].cms = d.cms_text;
      if (d.guidance_text) highlightMap[key].guidance = d.guidance_text;
    }
  });
  const highlights = Object.values(highlightMap);

  const highlightHtml = highlights.length ? `
    <div class="decision-highlight">
      <div class="decision-highlight-title">⚡ 關鍵決策摘要</div>
      ${highlights.map(h => `
        <div class="highlight-group" data-sop="${h.clause || ''}">
          <div class="highlight-group-header">
            <span class="highlight-sop-badge">${h.clause || '未分類'}</span>
          </div>
          ${h.cms ? `<div class="highlight-item">
            <div class="highlight-label"><span class="hl-icon">📺</span> CMS 電子看板</div>
            <div class="highlight-value">${h.cms}</div>
          </div>` : ''}
          ${h.guidance ? `<div class="highlight-item">
            <div class="highlight-label"><span class="hl-icon">🎖️</span> 指揮官建議</div>
            <div class="highlight-value">${h.guidance}</div>
          </div>` : ''}
        </div>`).join('')}
    </div>` : '';

  container.innerHTML = `
    <div class="card-yellow" style="margin-bottom:14px">
      事件 <b>${event.event_id}</b> 已注入（${event.affected_segment} · ${event.severity} · ${event.status}）。
      <span class="mono">規則運算 ${elapsed} ms</span>
    </div>
    ${highlightHtml}
    ${decisions.map(renderDecisionCard).join('')}`;
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
      <button class="btn-explain" onclick="openDrawer('${explainType}')">為什麼</button>
    </div>`;
}

/* ── Bell：重新整理目前時間點的資料（含模組五），並跳出模組五 toast ───────── */
document.getElementById('bell-btn').addEventListener('click', () => {
  if (timelineTimestamps.length) loadSnapshotAt(timelineTimestamps[timelineIndex]);
  loadModule5Status().then(showModule5Toast);
});

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
    container.innerHTML = renderM4Inline(record);
  } catch (e) {
    container.innerHTML = `<div class="card-yellow" style="margin-top:8px">模組四載入失敗：${escapeHtml(e.message)}</div>`;
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

    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-explain" onclick="toggleM4Panel('m4-rel-panel')">可靠度</button>
      <button class="btn-explain" onclick="toggleM4Panel('m4-cf-panel'); runM4CF()">反事實</button>
    </div>

    <div id="m4-rel-panel" class="hidden" style="margin-top:8px">
      <div class="formula-box align-left">
        <div class="formula-title">Decision Reliability 四維度</div>
        ${renderM4Bars(rel)}
      </div>
    </div>

    <div id="m4-cf-panel" class="hidden" style="margin-top:8px">
    </div>
  `;
}

function renderM4Bars(rel) {
  const dims = [
    { label: '資料可靠', value: rel.data_reliability || 0 },
    { label: '規則可靠', value: rel.rule_reliability || 0 },
    { label: '決策穩定', value: rel.decision_stability || 0 },
    { label: '證據覆蓋', value: rel.evidence_coverage || 0 },
  ];
  return dims.map(d => {
    const pct = Math.round(d.value * 100);
    const color = pct >= 80 ? 'var(--safe)' : pct >= 60 ? 'var(--caution)' : 'var(--critical)';
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
      <span style="width:55px;font-size:11px;color:var(--text-dim)">${d.label}</span>
      <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width .4s"></div>
      </div>
      <span class="mono" style="width:32px;text-align:right;font-size:11px">${pct}%</span>
    </div>`;
  }).join('');
}

function toggleM4Panel(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}

async function runM4CF() {
  const panel = document.getElementById('m4-cf-panel');
  if (!panel || panel.innerHTML.trim()) return; // already loaded
  panel.innerHTML = `<div class="spinner">分析中…</div>`;
  try {
    const res = await fetch('/api/reasoning/counterfactual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.results && data.results.length) {
      panel.innerHTML = data.results.map(r => `
        <div class="formula-box align-left" style="margin-bottom:6px;border-left:3px solid var(--caution)">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">${escapeHtml(r.narrative)}</div>
          <div class="mono" style="font-size:11px;color:var(--text-dim)">
            欄位：${r.changed_field} · 原始：${r.original_value} · 翻轉：${r.switch_value}
          </div>
        </div>
      `).join('');
    } else {
      panel.innerHTML = `<div class="card-yellow">在搜尋範圍內未找到翻轉點</div>`;
    }
  } catch (e) {
    panel.innerHTML = `<div style="color:var(--critical)">反事實分析失敗：${escapeHtml(e.message)}</div>`;
  }
}


async function loadAiSummary(timestamp) {
  const textEl = document.getElementById('m4-summary-text');
  const sourceEl = document.getElementById('m4-summary-source');
  if (!textEl || !sourceEl) return;
  try {
    const res = await fetch(`/api/reasoning/summary?timestamp=${encodeURIComponent(timestamp)}&event_id=TPE_2026_ACC_001`);
    if (!res.ok) return;
    const data = await res.json();
    textEl.textContent = data.summary;
    sourceEl.textContent = data.source === 'ollama' ? `Ollama · ${data.model}` : 'deterministic';
  } catch (e) {
    sourceEl.textContent = 'fallback';
  }
}
