/* ── Leaflet Map Init ──────────────────────────────────────────────────────── */
let mapInstance = null;
let roadPolylines = {};
let stationMarkers = {};
let latestDecisions = [];
let latestSnapshot = null;
let latestIncident = null;
let injectedTimelineData = {}; // { timestamp: { event, decisions, snapshot } }

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
  // 事件標記 pane：z-index 高於站點，確保事件 popup 不會被遮住
  mapInstance.createPane('incidentPane');
  mapInstance.getPane('incidentPane').style.zIndex = 650;
  // 確保 popup pane 永遠在最上層（解決站點標記蓋住 popup 的問題）
  mapInstance.getPane('popupPane').style.zIndex = 900;
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
    // 先清除地圖上的事件標記（只在非事件時間點清除）
    clearIncidentMapMarkers();

    // /api/dashboard 是 /api/snapshot 的超集：同一份快照之外，還多附上門檻判斷
    // （triggers）、這次新觸發的項目（newly_triggered）跟 LLM 趨勢摘要（summary），
    // 一次打完不用再分開呼叫 /api/snapshot。
    // 模組五（基地台狀態／SOP-6 多語卡）跟模組一原本是兩套獨立系統，這裡一起帶
    // 同一個 timestamp，讓整個儀表板（含地圖站點標記）都跟著時間軸走，不會有
    // 「時間軸調到 18:00，SOP-6 卡片卻還停在最新時間點」的不一致。

    // 如果該 timestamp 是注入事件的時間點（後端可能沒有此精確時間），用最近的可用時間
    let queryTs = timestamp;
    let dashRes = await fetch(`/api/dashboard?timestamp=${encodeURIComponent(queryTs)}`);
    if (!dashRes.ok && injectedTimelineData[timestamp]) {
      // 找最近的前一個可用時間點
      const candidates = timelineTimestamps.filter(t => t <= timestamp && !injectedTimelineData[t]);
      const fallbackTs = candidates.length ? candidates[candidates.length - 1] : timelineTimestamps.find(t => !injectedTimelineData[t]) || timelineTimestamps[0];
      dashRes = await fetch(`/api/dashboard?timestamp=${encodeURIComponent(fallbackTs)}`);
    }

    const [dashboard] = await Promise.all([
      dashRes.json(),
      loadModule5Status(timestamp),
      loadBaseStationPanel(timestamp),
    ]);
    const segments = snapshotToSegments(dashboard.snapshot);
    renderTrafficKPI(computeTrafficSummary(segments));
    renderTrafficAlerts(segments, dashboard);
    renderTrafficMap(segments);
    renderSegmentStatusList(segments);

    // 如果該時間點有注入事件，重新顯示事件標記和警報卡片
    const injected = injectedTimelineData[timestamp];
    if (injected) {
      renderIncidentDecisionsOnDashboard(injected.event, injected.decisions);
      addIncidentMapMarkers(injected.event, injected.decisions, injected.snapshot);
    }
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
          ${cascade ? `<br><span class="mono caution-text">⚡ ${cascade}</span>` : ''}
        </div>
        <button class="btn-explain" onclick="showEntityHistory('${sop4.entity_id}', '${sop4.entity_name}')">查看歷史趨勢</button>
      </div>`;
  }
  return `
    <div class="alert-card sop4">
      <div class="alert-hdr"><span class="alert-tag muted-bg">SOP-4 散場</span></div>
      <div class="alert-body">目前大巨蛋（BS_TPE_DOME）未達散場啟動條件</div>
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
  titleEl.textContent = '決策推理與解釋';
  titleEl.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:1rem;padding:8px 0 4px;';
  titleEl.innerHTML = '<span style="width:3.5px;height:16px;border-radius:2px;background:var(--accent);flex:none"></span>決策推理與解釋';
  bodyEl.innerHTML = `<div class="spinner">載入決策分析…</div>`;
  const currentTs = timelineTimestamps[timelineIndex] || '2026-05-20 22:15';
  try {
    const res = await fetch(`/api/reasoning/demo?timestamp=${encodeURIComponent(currentTs)}`);
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
        <div class="card-yellow" style="margin-top:10px">目前時間點尚無事件觸發，僅顯示 SOP-1 壅塞分級。</div>`;
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

    // Popup 顯示事件詳細資料
    const triggeredSops = decisions.filter(d => d.triggered).map(d => d.sop_clause).filter(Boolean).join('、') || '無';
    const eteDecision = decisions.find(d => d.ete_minutes);
    const cmsDecision = decisions.find(d => d.cms_text);
    let popupHtml = `
      <div class="incident-popup">
        <div class="incident-popup-title">${iconEmoji} ${escapeHtml(event.event_id)}</div>
        <div class="incident-popup-row"><b>類型</b> ${escapeHtml(event.type)}</div>
        <div class="incident-popup-row"><b>位置</b> ${escapeHtml(event.location)}</div>
        <div class="incident-popup-row"><b>嚴重度</b> <span class="severity-${event.severity.toLowerCase()}">${escapeHtml(event.severity)}</span></div>
        <div class="incident-popup-row"><b>狀態</b> ${escapeHtml(event.status)}</div>
        <div class="incident-popup-row"><b>路段</b> ${escapeHtml(segId)}</div>
        <div class="incident-popup-row"><b>觸發 SOP</b> ${escapeHtml(triggeredSops)}</div>
        ${eteDecision ? `<div class="incident-popup-row"><b>ETE</b> ${eteDecision.ete_minutes} 分鐘</div>` : ''}
        ${cmsDecision ? `<div class="incident-popup-row incident-popup-cms"><b>CMS</b> ${escapeHtml(cmsDecision.cms_text)}</div>` : ''}
        <div class="incident-popup-desc">${escapeHtml(event.description)}</div>
      </div>`;
    marker.bindPopup(popupHtml, { maxWidth: 320, className: 'incident-popup-container' });
    marker.openPopup();

    incidentMapMarkers.push(marker);
  }
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

    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-explain" onclick="toggleM4Panel('m4-rel-panel')">可靠度</button>
      <button class="btn-explain" onclick="toggleM4Panel('m4-cf-panel'); runM4CF()">反事實</button>
      <button class="btn-explain" onclick="toggleM4Panel('m4-forecast-panel'); runM4Forecast()">壅塞預測</button>
      <button class="btn-explain" onclick="toggleM4Panel('m4-anomaly-panel'); runM4Anomaly()">異常偵測</button>
    </div>

    <div id="m4-rel-panel" class="hidden" style="margin-top:8px">
      <div class="formula-box align-left">
        <div class="formula-title">Decision Reliability 四維度</div>
        ${renderM4Bars(rel)}
      </div>
    </div>

    <div id="m4-cf-panel" class="hidden" style="margin-top:8px">
    </div>

    <div id="m4-forecast-panel" class="hidden" style="margin-top:8px">
    </div>

    <div id="m4-anomaly-panel" class="hidden" style="margin-top:8px">
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
    const res = await fetch(`/api/reasoning/summary?timestamp=${encodeURIComponent(timestamp)}`);
    if (!res.ok) return;
    const data = await res.json();
    textEl.textContent = data.summary;
    sourceEl.textContent = data.source === 'ollama' ? `Ollama · ${data.model}` : 'deterministic';
  } catch (e) {
    sourceEl.textContent = 'fallback';
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   交控中心建議書 (Advisory Report Modal)
   ══════════════════════════════════════════════════════════════════════════════ */

let advisoryMarkdownCache = '';

function openAdvisoryModal() {
  if (!latestIncident || !latestDecisions.length) {
    alert('請先注入事件並取得 SOP 決策結果');
    return;
  }
  const overlay = document.getElementById('advisory-modal-overlay');
  overlay.classList.remove('hidden');
  renderAdvisoryReport();
}

function closeAdvisoryModal() {
  document.getElementById('advisory-modal-overlay').classList.add('hidden');
}

function renderAdvisoryReport() {
  const body = document.getElementById('advisory-modal-body');
  const incident = latestIncident;
  const decisions = latestDecisions;
  const snapshot = latestSnapshot;

  // 1. 事件辨識
  const triggeredDecisions = decisions.filter(d => d.triggered);
  const sopClauses = triggeredDecisions.map(d => d.sop_clause).filter(Boolean).join('、') || '無觸發';

  // 2. 交通分級判定
  const seg_id = incident.affected_segment;
  const segData = snapshot?.road_segments?.[seg_id];
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
    signalHtml = `<div class="signal-action">替代道路 ${escapeHtml(altName)} 綠燈配時 +25%（事件持續期間）</div>`;
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
        <div class="advisory-field"><span class="af-label">受影響路段</span><span class="af-value mono">${escapeHtml(incident.affected_segment)} — ${escapeHtml(segData?.name || '')}</span></div>
        <div class="advisory-field"><span class="af-label">觸發 SOP 條款</span><span class="af-value">${escapeHtml(sopClauses)}</span></div>
        <div class="advisory-field"><span class="af-label">對應條款名稱</span><span class="af-value">${triggeredDecisions.map(d => d.clause_name || '').filter(Boolean).join('、') || '—'}</span></div>
        <div class="advisory-field"><span class="af-label">嚴重度</span><span class="af-value">${escapeHtml(incident.severity)}</span></div>
        <div class="advisory-field"><span class="af-label">狀態</span><span class="af-value">${escapeHtml(incident.status)}</span></div>
        <div class="advisory-field"><span class="af-label">預計恢復時間 (ETE)</span><span class="af-value mono">${eteText}</span></div>
      </div>

      <div class="advisory-section">
        <div class="advisory-section-title">二、交通分級判定</div>
        <div class="advisory-level ${levelClass}">${levelText}</div>
        <div class="advisory-field"><span class="af-label">路段飽和度</span><span class="af-value mono">${saturation != null ? (saturation * 100).toFixed(1) + '%' : 'N/A'}</span></div>
        <div class="advisory-field"><span class="af-label">平均車速</span><span class="af-value mono">${avgSpeed != null ? avgSpeed + ' km/h' : 'N/A'}</span></div>
        <div class="advisory-field"><span class="af-label">判定依據</span><span class="af-value">A 級：Saturation_Score >= 0.95；B 級：0.85 <= Saturation_Score < 0.95</span></div>
        ${sop1 ? `<div class="advisory-field"><span class="af-label">SOP-1 判定</span><span class="af-value">${escapeHtml(sop1.basis)}</span></div>` : ''}
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
        ${crossSystemHtml}
        ${triggeredDecisions.some(d => d.cascade_checks?.length) ? `<div class="advisory-sub-title">連動檢查</div>${triggeredDecisions.flatMap(d => d.cascade_checks || []).map(c => `<div class="cross-system-item">${escapeHtml(c)}</div>`).join('')}` : ''}
      </div>
    </div>`;

  // 預先快取 Markdown 版本
  advisoryMarkdownCache = generateAdvisoryMarkdown(incident, decisions, snapshot);
}

function generateAdvisoryMarkdown(incident, decisions, snapshot) {
  const triggeredDecisions = decisions.filter(d => d.triggered);
  const sopClauses = triggeredDecisions.map(d => d.sop_clause).filter(Boolean).join('、') || '無觸發';
  const seg_id = incident.affected_segment;
  const segData = snapshot?.road_segments?.[seg_id];
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
  md += `| 受影響路段 | ${seg_id} — ${segData?.name || ''} |\n`;
  md += `| 觸發 SOP 條款 | ${sopClauses} |\n`;
  md += `| 嚴重度 | ${incident.severity} |\n`;
  md += `| 狀態 | ${incident.status} |\n`;
  md += `| ETE 預計恢復 | ${eteText} |\n\n`;

  md += `## 二、交通分級判定\n\n`;
  md += `- **分級結果**：${levelText}\n`;
  md += `- **路段飽和度**：${saturation != null ? (saturation * 100).toFixed(1) + '%' : 'N/A'}\n`;
  md += `- **平均車速**：${avgSpeed != null ? avgSpeed + ' km/h' : 'N/A'}\n`;
  md += `- **判定依據**：A 級 Saturation_Score >= 0.95；B 級 >= 0.85 且 < 0.95\n`;
  if (sop1) md += `- **SOP-1 判定**：${sop1.basis}\n`;
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
    md += `- 替代道路 ${altName} 綠燈配時 +25%（事件持續期間）\n`;
  } else {
    md += `> 本次事件未觸發號誌調整\n`;
  }
  md += `\n`;

  md += `## 五、跨系統聯動\n\n`;
  const crossItems = [];
  if (sop5) {
    crossItems.push(`- [警力派遣] ${sop5.entity_name || seg_id} 各路口派遣 2 名警力接管指揮`);
  }
  if (sop2 && incident.severity === 'Critical') {
    crossItems.push(`- [警力] 事故現場交管＋主疏散路口疏導`);
  }
  const cascadeItems = [];
  triggeredDecisions.forEach(d => { (d.cascade_checks || []).forEach(c => cascadeItems.push(c)); });
  if (triggeredDecisions.some(d => d.sop_clause === 'SOP-3') || cascadeItems.some(c => c.includes('第 3 條') || c.includes('SOP-3'))) {
    crossItems.push(`- [北捷] 建議啟動「過站不停」疏運`);
    crossItems.push(`- [公車處] 調度接駁專車`);
  }
  if (crossItems.length) {
    md += crossItems.join('\n') + '\n';
  } else {
    md += `> 本次事件未觸發跨系統聯動\n`;
  }
  // 連動檢查（cascade_checks from sop_engine）
  const allCascade = triggeredDecisions.flatMap(d => d.cascade_checks || []);
  if (allCascade.length) {
    md += `\n### 連動檢查\n\n`;
    allCascade.forEach(c => { md += `- ${c}\n`; });
  }
  md += `\n---\n\n`;
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


async function runM4Forecast() {
  const panel = document.getElementById('m4-forecast-panel');
  if (!panel || panel.innerHTML.trim()) return;
  panel.innerHTML = `<div class="spinner">預測中…</div>`;
  try {
    const ts = timelineTimestamps[timelineIndex] || '2026-05-20 22:15';
    const res = await fetch(`/api/reasoning/forecast?timestamp=${encodeURIComponent(ts)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.warnings && data.warnings.length) {
      panel.innerHTML = data.warnings.map(w => `
        <div class="formula-box align-left" style="margin-bottom:6px;border-left:3px solid var(--caution)">
          <div style="font-weight:600;font-size:13px">${escapeHtml(w)}</div>
        </div>
      `).join('') + `<div style="font-size:11px;color:var(--text-dim);margin-top:6px">共 ${data.total_segments} 路段分析，${data.approaching_threshold} 條接近門檻</div>`;
    } else {
      panel.innerHTML = `<div class="card-yellow">目前所有路段趨勢穩定，無接近門檻預警。</div>`;
    }
  } catch (e) {
    panel.innerHTML = `<div style="color:var(--critical)">壅塞預測失敗：${escapeHtml(e.message)}</div>`;
  }
}

async function runM4Anomaly() {
  const panel = document.getElementById('m4-anomaly-panel');
  if (!panel || panel.innerHTML.trim()) return;
  panel.innerHTML = `<div class="spinner">偵測中…</div>`;
  try {
    const ts = timelineTimestamps[timelineIndex] || '2026-05-20 22:15';
    const res = await fetch(`/api/reasoning/anomaly?timestamp=${encodeURIComponent(ts)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.alerts && data.alerts.length) {
      panel.innerHTML = data.alerts.map(a => `
        <div class="formula-box align-left" style="margin-bottom:6px;border-left:3px solid ${a.severity === 'critical' ? 'var(--critical)' : 'var(--caution)'}">
          <div style="font-weight:600;font-size:13px">[${a.severity}] ${escapeHtml(a.segment_name)}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:4px">${escapeHtml(a.description)}</div>
        </div>
      `).join('') + `<div style="font-size:11px;color:var(--text-dim);margin-top:6px">共偵測到 ${data.anomaly_count} 個異常</div>`;
    } else {
      panel.innerHTML = `<div class="card-yellow">目前無資料異常。</div>`;
    }
  } catch (e) {
    panel.innerHTML = `<div style="color:var(--critical)">異常偵測失敗：${escapeHtml(e.message)}</div>`;
  }
}
