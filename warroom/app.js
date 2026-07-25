/* ── Leaflet Map Init ──────────────────────────────────────────────────────── */
let mapInstance = null;
let roadPolylines = {};
let latestDecisions = [];
let latestSnapshot = null;
let latestIncident = null;

document.addEventListener('DOMContentLoaded', () => {
  mapInstance = L.map('leaflet-map', { zoomControl: false }).setView([25.0370, 121.5625], 14.5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(mapInstance);
  L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

  // 模組 5 的觸發站點要先拿到，儀表板右側 SOP-6 卡片才能顯示真實資料
  loadModule5Status().then(() => {
    loadTrafficData();
    loadIncidentData();
  });
  showAdvisorScenarioSet('incident');
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

  html += renderModule5AlertCard();
  container.innerHTML = html;
}

/* ── 模組五：多語通報卡片（真實資料，不是寫死文字）─────────────────────────── */
function renderModule5AlertCard() {
  if (!m5Triggered || !m5Triggered.length) {
    return `
    <div class="alert-card sop6">
      <div class="alert-hdr"><span class="alert-tag accent-bg">SOP-6 多語</span></div>
      <div class="alert-body">目前無站點外籍旅客比例達 30% 門檻</div>
      <button class="btn-explain" onclick="openModule5Modal()">🌐 查看站點狀態</button>
    </div>`;
  }
  const top = [...m5Triggered].sort((a, b) => b.roaming_rate - a.roaming_rate)[0];
  const more = m5Triggered.length > 1 ? `（共 ${m5Triggered.length} 站觸發）` : '';
  return `
    <div class="alert-card sop6">
      <div class="alert-hdr"><span class="alert-tag accent-bg">SOP-6 多語</span><span class="mono">${(top.timestamp || '').slice(11, 16)}</span></div>
      <div class="alert-body">
        <b>${top.station_name}</b> (${top.station_id})<br>
        漫遊率 <span class="mono critical-text">${(top.roaming_rate * 100).toFixed(1)}%</span> ≥ 30% → 觸發七語通報${more}
      </div>
      <button class="btn-explain" onclick="openModule5Modal()">🌐 查看多語通報</button>
    </div>`;
}

function renderTrafficMap(segments) {
  const colorMap = { A: '#f27a84', B: '#eab85c', OK: '#85d99a' };
  // 使用 Module 2 TrafficMap 的真實路網座標
  const roadCoords = {
    'RD_TPE_001': [[25.0418, 121.5530], [25.0418, 121.5680]],
    'RD_TPE_002': [[25.0460, 121.5575], [25.0330, 121.5575]],
    'RD_TPE_003': [[25.0418, 121.5680], [25.0295, 121.5680]],
    'RD_TPE_004': [[25.0460, 121.5480], [25.0460, 121.5575]],
    'RD_TPE_005': [[25.0330, 121.5480], [25.0330, 121.5680]],
    'RD_TPE_006': [[25.0460, 121.5480], [25.0330, 121.5480]],
    'RD_TPE_007': [[25.0380, 121.5650], [25.0380, 121.5750]],
    'RD_TPE_008': [[25.0418, 121.5530], [25.0330, 121.5530]],
    'RD_TPE_009': [[25.0418, 121.5690], [25.0370, 121.5690]],
    'RD_TPE_010': [[25.0380, 121.5750], [25.0310, 121.5750]],
    'RD_TPE_011': [[25.0340, 121.5650], [25.0340, 121.5770]],
    'RD_TPE_012': [[25.0330, 121.5480], [25.0250, 121.5480]],
    'RD_TPE_013': [[25.0295, 121.5650], [25.0295, 121.5770]],
    'RD_TPE_014': [[25.0380, 121.5770], [25.0295, 121.5770]],
    'RD_TPE_015': [[25.0460, 121.5430], [25.0418, 121.5430]],
  };
  segments.forEach(s => {
    const pts = roadCoords[s.Segment_ID];
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

/* ── Drawer (Module 4) ────────────────────────────────────────────────────────
   SOP-1 直接查 /api/traffic；SOP-2/SOP-5 則讀最近一次事件注入後的真實 decisions。 */
function openDrawer(type) {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
  renderDrawerContent(type);
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

async function renderDrawerContent(type) {
  const titleEl = document.getElementById('drawer-title');
  const bodyEl = document.getElementById('drawer-body-content');

  if (type === 'sop2') {
    titleEl.textContent = '🧠 判斷依據 — SOP-2 主疏散路徑';
    const decision = latestDecisions.find(d => d.sop_clause === 'SOP-2');
    bodyEl.innerHTML = decision ? renderDecisionExplanation(decision) : emptyDecisionHint('SOP-2');
    return;
  }

  if (type === 'sop5') {
    titleEl.textContent = '🧠 判斷依據 — SOP-5 號誌故障應變';
    const decision = latestDecisions.find(d => d.sop_clause === 'SOP-5');
    bodyEl.innerHTML = decision ? renderDecisionExplanation(decision) : emptyDecisionHint('SOP-5');
    return;
  }

  if (type.startsWith('decision:')) {
    const index = Number(type.split(':')[1]);
    const decision = latestDecisions[index];
    titleEl.textContent = '🧠 判斷依據 — 未觸發 / 轉交判斷';
    bodyEl.innerHTML = decision ? renderDecisionExplanation(decision) : emptyDecisionHint('該決策');
    return;
  }

  // 其餘一律當成 SOP-1 壅塞分級的路段 ID 查詢
  titleEl.textContent = '🧠 判斷依據 — SOP-1 壅塞分級';
  bodyEl.innerHTML = `<div class="spinner">載入路段資料…</div>`;
  try {
    const [segRes, netRes] = await Promise.all([
      fetch('/api/traffic/segments'),
      fetch('/api/traffic/network'),
    ]);
    const segData = await segRes.json();
    const netData = await netRes.json();
    const seg = segData.segments.find(s => s.Segment_ID === type);
    if (!seg) {
      bodyEl.innerHTML = `<p>找不到路段 ${type} 的資料</p>`;
      return;
    }
    const TRIGGER_ROADS = ['RD_TPE_001', 'RD_TPE_002'];
    const isTrigger = TRIGGER_ROADS.includes(seg.Segment_ID);
    const geo = netData.network.find(n => n.segment_id === seg.Segment_ID);
    const altNames = (geo?.alternatives || []).map(id => {
      const alt = netData.network.find(n => n.segment_id === id);
      return alt ? alt.name : id;
    });
    const levelText = seg.level === 'A' ? '飽和度 ≥ 0.95 → A 級癱瘓／紅燈'
                     : seg.level === 'B' ? '0.85 ≤ 飽和度 < 0.95 → B 級壅擠／黃燈'
                     : '飽和度 < 0.85 → 一般狀態';

    bodyEl.innerHTML = `
      <div class="chain">
        <div class="chain-step active"><div class="node">1</div><div class="step-text">
          <span class="step-lbl">目前飽和度</span> ${seg.Road_Name}（${seg.Segment_ID}）
          <span class="mono ${seg.level === 'A' ? 'critical-text' : seg.level === 'B' ? 'caution-text' : ''}">${seg.Saturation_Score.toFixed(2)}</span>
        </div></div>
        <div class="chain-step active"><div class="node">2</div><div class="step-text">
          <span class="step-lbl">SOP-1 分級</span> ${levelText}
        </div></div>
        <div class="chain-step active"><div class="node">3</div><div class="step-text">
          <span class="step-lbl">應變動作</span> ${isTrigger
            ? '屬於城市應變觸發路段（忠孝東路四段／光復南路），啟動長綠燈時制並調度警力淨空路口' + (seg.level === 'A' ? '，另加開替代路徑引導' : '')
            : '不屬於城市應變觸發路段，Dashboard 僅顯示分級顏色，不自動啟動長綠燈或替代路徑'}
        </div></div>
      </div>
      ${isTrigger ? `<div class="formula-box">
        <div class="formula-title">替代道路（綠燈配時 +25%）</div>
        <div class="formula">${altNames.length ? altNames.join('、') : '（路網資料未提供替代道路）'}</div>
      </div>` : ''}`;
  } catch (e) {
    bodyEl.innerHTML = `<p>資料載入失敗：${e.message}</p>`;
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
    text: `如果${name}號誌故障，依 SOP 要怎麼派遣現場人力、發布 CMS，預計多久恢復？`,
  })),
  notification: advisorStationNames.map(name => ({
    label: name,
    text: `檢查${name}是否需要啟動多語通報。`,
  })),
};

function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('hidden');
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
  const pending = appendChatMessage('ai', '分析目前快照中…');
  try {
    const res = await fetch('/api/advisor/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        current_event: latestIncident,
        current_decisions: latestDecisions,
      }),
    });
    const data = await res.json();
    pending.innerHTML = formatAdvisorAnswer(data.answer);
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
  const lines = String(answer || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  return lines.map((line, index) => {
    const safe = escapeHtml(line);
    if (index === 0) return `<div class="answer-lead">${safe}</div>`;
    if (line.startsWith('✓')) return `<div class="advisor-check">${safe}</div>`;
    if (line.startsWith('■')) return `<div class="advisor-action">${safe.replace('■ ', '')}</div>`;
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

/* ── Module 5：多語通報 Toast ─────────────────────────────────────────────────
   真實資料來源：/api/signal/triggered。沒有站點跨過 30% 門檻時不彈 toast。 */
let m5Triggered = [];

async function loadModule5Status() {
  try {
    const res = await fetch('/api/signal/triggered');
    const data = await res.json();
    m5Triggered = data.triggered || [];
    if (m5Triggered.length) {
      const top = [...m5Triggered].sort((a, b) => b.roaming_rate - a.roaming_rate)[0];
      const more = m5Triggered.length > 1 ? `等 ${m5Triggered.length} 個站點` : '';
      document.getElementById('toast-text').textContent =
        `🌐 ${top.station_name}${more} 外籍旅客比例達 ${(top.roaming_rate * 100).toFixed(0)}%，超過 SOP 第 6 條 30% 門檻`;
      document.getElementById('toast').classList.remove('hidden');
    } else {
      document.getElementById('toast-text').textContent = '🌐 目前無站點外籍旅客比例達 30% 門檻';
    }
  } catch (e) {
    console.error('模組 5 狀態載入失敗', e);
    document.getElementById('toast-text').textContent = '🌐 多語通報狀態載入失敗';
  }
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
    ? `<div class="card-red">📌 SOP 第 6 條觸發｜將產出中英日韓泰越法七語版</div>`
    : `<div class="card-yellow">ℹ️ 未達 30% 門檻｜僅產出繁體中文</div>`;
  m5Alerts = {};
  document.getElementById('m5-editor').classList.add('hidden');
  document.getElementById('m5-btn-publish').disabled = true;
  document.getElementById('m5-publish-result').classList.add('hidden');
}

async function m5Generate() {
  if (!m5Current) return;
  const s = m5Current, multi = s.roaming_rate >= M5_THRESHOLD;
  document.getElementById('m5-spinner').classList.remove('hidden');
  document.getElementById('m5-btn-generate').disabled = true;
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
        `<div class="card-yellow" style="margin-top:8px">⚠️ Ollama 未連線，目前顯示為預設模板文字（${data.ollama_status?.message || ''}）</div>`);
    }
  } catch (e) {
    alert('生成失敗：' + e.message);
  } finally {
    document.getElementById('m5-spinner').classList.add('hidden');
    document.getElementById('m5-btn-generate').disabled = false;
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
        `<div class="publish-success">✅ 已發送簡訊＋看板　⏱ ${new Date().toLocaleTimeString()}</div>`;
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
    hideInjectLoading();
    alert('❌ 注入失敗：' + e.message);
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
      alert('❌ 注入失敗');
    }
  } catch (e) {
    hideInjectLoading();
    alert('❌ 注入失敗：' + e.message);
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
      ✅ 事件 <b>${event.event_id}</b> 已注入（${event.affected_segment} · ${event.severity} · ${event.status}）。
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
      <button class="btn-explain" onclick="openDrawer('${explainType}')">🔍 為什麼</button>
    </div>`;
}

/* ── Bell ──────────────────────────────────────────────────────────────────── */
document.getElementById('bell-btn').addEventListener('click', () => {
  loadModule5Status();
  document.getElementById('toast').classList.remove('hidden');
});
