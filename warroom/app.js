/* ── Leaflet Map Init ──────────────────────────────────────────────────────── */
let mapInstance = null;
let roadPolylines = {};

document.addEventListener('DOMContentLoaded', () => {
  mapInstance = L.map('leaflet-map', { zoomControl: false }).setView([25.0336, 121.5636], 15);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(mapInstance);
  L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

  // 載入真實資料
  loadTrafficData();
  loadIncidentData();
});

/* ── 模組一：車流資料 ─────────────────────────────────────────────────────── */
async function loadTrafficData() {
  try {
    const res = await fetch('/api/traffic/segments');
    const data = await res.json();
    renderTrafficKPI(data.summary);
    renderTrafficAlerts(data.segments);
    renderTrafficMap(data.segments);
  } catch (e) { console.error('車流資料載入失敗', e); }
}

function renderTrafficKPI(summary) {
  document.querySelector('#panel-dashboard .kpi-card.critical .kpi-val').textContent = summary.a_count;
  document.querySelector('#panel-dashboard .kpi-card.caution .kpi-val').textContent = summary.b_count;
  document.querySelector('#panel-dashboard .kpi-card.safe .kpi-val').textContent = summary.avg_speed + ' km/h';
}

function renderTrafficAlerts(segments) {
  const container = document.querySelector('#panel-dashboard .grid-2 > .panel:nth-child(2)');
  const alerts = segments.filter(s => s.level === 'A' || s.level === 'B')
                         .sort((a, b) => b.Saturation_Score - a.Saturation_Score);

  let html = '<h3>🚨 即時警報</h3>';
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
        <button class="btn-explain" onclick="openDrawer('${s.Segment_ID}')">🔍 查看判斷依據</button>
      </div>`;
  });

  // Module 5 觸發卡片（從 signal API 取）
  html += `
    <div class="alert-card sop6">
      <div class="alert-hdr"><span class="alert-tag accent-bg">SOP-6 多語</span><span class="mono">22:15</span></div>
      <div class="alert-body">漫遊率 ≥ 30% 站點觸發七語通報</div>
      <button class="btn-explain" onclick="openModule5Drawer()">🌐 查看多語通報</button>
    </div>`;

  container.innerHTML = html;
}

function renderTrafficMap(segments) {
  const colorMap = { A: '#f27a84', B: '#eab85c', OK: '#85d99a' };
  // 簡化：依 segment_id 畫路線（需要路網座標，這裡用 mock 座標）
  const mockCoords = {
    'RD_TPE_001': [[25.041,121.557],[25.040,121.572]],
    'RD_TPE_002': [[25.040,121.551],[25.030,121.552]],
    'RD_TPE_003': [[25.033,121.548],[25.028,121.549]],
    'RD_TPE_004': [[25.046,121.560],[25.045,121.570]],
    'RD_TPE_005': [[25.035,121.565],[25.033,121.566]],
    'RD_TPE_006': [[25.034,121.564],[25.032,121.565]],
    'RD_TPE_007': [[25.037,121.554],[25.036,121.569]],
    'RD_TPE_008': [[25.033,121.556],[25.033,121.572]],
    'RD_TPE_009': [[25.040,121.551],[25.030,121.552]],
    'RD_TPE_010': [[25.040,121.561],[25.030,121.562]],
    'RD_TPE_011': [[25.042,121.559],[25.037,121.560]],
    'RD_TPE_012': [[25.038,121.566],[25.037,121.570]],
    'RD_TPE_013': [[25.027,121.550],[25.020,121.550]],
    'RD_TPE_014': [[25.026,121.556],[25.026,121.565]],
    'RD_TPE_015': [[25.033,121.558],[25.030,121.559]],
  };
  segments.forEach(s => {
    const pts = mockCoords[s.Segment_ID];
    if (!pts) return;
    const color = colorMap[s.level] || '#85d99a';
    if (roadPolylines[s.Segment_ID]) {
      roadPolylines[s.Segment_ID].setStyle({ color });
    } else {
      const line = L.polyline(pts, { color, weight: 5, opacity: 0.9 }).addTo(mapInstance);
      line.bindTooltip(`${s.Road_Name} (${s.Segment_ID})<br>飽和: ${s.Saturation_Score.toFixed(2)}`);
      roadPolylines[s.Segment_ID] = line;
    }
  });
}

/* ── 模組二：事件資料 ─────────────────────────────────────────────────────── */
async function loadIncidentData() {
  try {
    const res = await fetch('/api/incidents/list');
    const data = await res.json();
    renderIncidentList(data.incidents);
  } catch (e) { console.error('事件資料載入失敗', e); }
}

function renderIncidentList(incidents) {
  const container = document.querySelector('.scenario-list');
  if (!container) return;
  container.innerHTML = incidents.map(inc => `
    <div class="scenario-item" onclick="injectIncident('${inc.event_id}')">
      <b>${inc.event_id}</b> — ${inc.type}<br>
      <span class="mono">${inc.affected_segment} · ${inc.severity} · ${inc.status}</span>
    </div>
  `).join('');
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

/* ── Drawer (Module 4) ────────────────────────────────────────────────────── */
function openDrawer(type) {
  document.getElementById('drawer').classList.remove('hidden');
  document.getElementById('drawer-backdrop').classList.remove('hidden');
}
function closeDrawer() {
  document.getElementById('drawer').classList.add('hidden');
  document.getElementById('drawer-backdrop').classList.add('hidden');
}

/* ── Module 5 Drawer ──────────────────────────────────────────────────────── */
function openModule5Drawer() {
  document.getElementById('module5-drawer').classList.remove('hidden');
  document.getElementById('drawer-backdrop').classList.remove('hidden');
  // 隱藏 Leaflet 控制項避免穿透
  document.querySelectorAll('.leaflet-control-container').forEach(el => el.style.display = 'none');
}
function closeModule5Drawer() {
  const d = document.getElementById('module5-drawer');
  d.classList.add('hidden');
  d.classList.remove('expanded');
  document.getElementById('drawer-backdrop').classList.add('hidden');
  // 恢復 Leaflet 控制項
  document.querySelectorAll('.leaflet-control-container').forEach(el => el.style.display = '');
}
function toggleModule5Expand() {
  document.getElementById('module5-drawer').classList.toggle('expanded');
}

/* ── Chat (Module 3) ──────────────────────────────────────────────────────── */
function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('hidden');
}

/* ── Toast (Module 5 trigger) ─────────────────────────────────────────────── */
function closeToast() {
  document.getElementById('toast').classList.add('hidden');
}

// 模擬 2 秒後觸發 Module 5 通報 toast
setTimeout(() => {
  document.getElementById('toast').classList.remove('hidden');
}, 2000);

/* ── Incident Injection ────────────────────────────────────────────────────── */
async function injectIncident(eventId) {
  try {
    const listRes = await fetch('/api/incidents/list');
    const listData = await listRes.json();
    const event = listData.incidents.find(i => i.event_id === eventId);
    if (!event) { alert('找不到該事件'); return; }

    const res = await fetch('/api/incidents/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ 事件 ${eventId} 已注入！`);
    }
  } catch (e) {
    alert('❌ 注入失敗：' + e.message);
  }
}

/* ── Bell ──────────────────────────────────────────────────────────────────── */
document.getElementById('bell-btn').addEventListener('click', () => {
  document.getElementById('toast').classList.remove('hidden');
});
