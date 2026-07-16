/* ── 常數 ──────────────────────────────────────────────────────────────────── */
const API = '';   // 同 origin，FastAPI serve 前端
const THRESHOLD = 0.30;

const LANG_ORDER = ['zh_tw','en','ja','ko','th','vi','fr'];
const LANG_LABEL = {
  zh_tw: '🇹🇼 繁中', en: '🇺🇸 EN', ja: '🇯🇵 日',
  ko: '🇰🇷 韓',    th: '🇹🇭 泰', vi: '🇻🇳 越', fr: '🇫🇷 法',
};
const CMS_META = {
  zh_tw: { flag: '🇹🇼 繁體中文',  title: '交通管制通報' },
  en:    { flag: '🇺🇸 English',   title: 'TRAFFIC ALERT' },
  ja:    { flag: '🇯🇵 日本語',    title: '交通規制情報' },
  ko:    { flag: '🇰🇷 한국어',    title: '교통 통제 알림' },
  th:    { flag: '🇹🇭 ภาษาไทย',  title: 'ประกาศจราจร' },
  vi:    { flag: '🇻🇳 Tiếng Việt',title: 'CẢNH BÁO GIAO THÔNG' },
  fr:    { flag: '🇫🇷 Français',  title: 'ALERTE CIRCULATION' },
};

/* ── State ─────────────────────────────────────────────────────────────────── */
let stations      = [];
let currentAlerts = {};
let currentStation = null;
let activeLang    = 'zh_tw';

/* ── Init ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  checkOllama();
  loadStations();
  document.getElementById('btn-generate').addEventListener('click', generateAlerts);
  document.getElementById('btn-publish').addEventListener('click', publishAlerts);
});

/* ── Ollama 狀態 ────────────────────────────────────────────────────────────── */
async function checkOllama() {
  const badge = document.getElementById('ollama-badge');
  try {
    const res  = await fetch(`${API}/api/notify/ollama-status`);
    const data = await res.json();
    badge.textContent = data.ok ? `✅ ${data.message}` : `⚠️ ${data.message}`;
    badge.className   = `badge ${data.ok ? 'badge-ok' : 'badge-error'}`;
  } catch {
    badge.textContent = '❌ 後端未啟動';
    badge.className   = 'badge badge-error';
  }
}

/* ── 載入站點資料 ────────────────────────────────────────────────────────────── */
async function loadStations() {
  try {
    const res  = await fetch(`${API}/api/signal/stations`);
    const data = await res.json();
    stations   = data.stations;
    renderKPI(stations);
    renderTriggeredCards(stations);
    renderTable(stations);
    renderSelect(stations);
  } catch (e) {
    console.error('載入站點失敗', e);
  }
}

/* ── KPI ───────────────────────────────────────────────────────────────────── */
function renderKPI(list) {
  const triggered = list.filter(s => s.roaming_rate >= THRESHOLD);
  const maxRate   = Math.max(...list.map(s => s.roaming_rate)) * 100;

  const tEl = document.getElementById('kpi-val-triggered');
  tEl.textContent = triggered.length;
  tEl.className   = `kpi-val ${triggered.length > 0 ? 'red' : 'green'}`;

  document.getElementById('kpi-val-total').textContent = list.length;

  const mEl = document.getElementById('kpi-val-maxrate');
  mEl.textContent = `${maxRate.toFixed(1)}%`;
  mEl.className   = `kpi-val ${maxRate >= 30 ? 'red' : 'yellow'}`;
}

/* ── 觸發站點卡片 ────────────────────────────────────────────────────────────── */
function renderTriggeredCards(list) {
  const container = document.getElementById('triggered-cards');
  const triggered = list.filter(s => s.roaming_rate >= THRESHOLD)
                        .sort((a,b) => b.roaming_rate - a.roaming_rate);
  if (!triggered.length) {
    container.innerHTML = `<div class="normal-card">✅ 無站點觸發 SOP 第6條（漫遊率均 < 30%）</div>`;
    return;
  }
  container.innerHTML = '<p style="font-weight:700;margin-bottom:8px">🔴 已觸發多語化告警的站點：</p>' +
    triggered.map(s => `
      <div class="alert-card">
        <b>⚠ ${s.station_name}</b>
        <span style="color:#888;font-size:.82rem;margin-left:8px">${s.station_id}</span><br>
        漫遊率 <b class="red">${(s.roaming_rate*100).toFixed(1)}%</b>
        &ensp;｜&ensp;人數 <b>${Number(s.user_count).toLocaleString()}</b>
      </div>`).join('');
}

/* ── 完整表格 ────────────────────────────────────────────────────────────────── */
function renderTable(list) {
  const tbody = document.getElementById('station-tbody');
  tbody.innerHTML = list.map(s => {
    const rate = (s.roaming_rate * 100).toFixed(1);
    const grow = s.growth_rate ? `${(s.growth_rate*100).toFixed(1)}%` : '—';
    const cls  = s.roaming_rate >= THRESHOLD ? 'tag-triggered' : '';
    return `<tr>
      <td>${s.station_id}</td>
      <td class="${cls}">${s.station_name}</td>
      <td>${Number(s.user_count).toLocaleString()}</td>
      <td class="${cls}">${rate}%</td>
      <td>${grow}</td>
      <td>${s.stay_time ?? '—'}</td>
    </tr>`;
  }).join('');
}

/* ── 站點下拉 ────────────────────────────────────────────────────────────────── */
function renderSelect(list) {
  const sel = document.getElementById('station-select');
  const sorted = [...list].sort((a,b) => b.roaming_rate - a.roaming_rate);
  sel.innerHTML = sorted.map(s => {
    const flag = s.roaming_rate >= THRESHOLD ? '🔴' : '🟢';
    return `<option value="${s.station_id}">${flag} ${s.station_name} (${(s.roaming_rate*100).toFixed(1)}%)</option>`;
  }).join('');
  sel.addEventListener('change', () => updateStationInfo());
  updateStationInfo();
}

/* ── 站點資訊更新 ────────────────────────────────────────────────────────────── */
function updateStationInfo() {
  const sel = document.getElementById('station-select');
  currentStation = stations.find(s => s.station_id === sel.value);
  if (!currentStation) return;

  const s = currentStation;
  const isMulti = s.roaming_rate >= THRESHOLD;

  // Metrics
  document.getElementById('station-metrics').innerHTML = `
    <div class="metric-box"><div class="metric-val">${s.station_name}</div><div class="metric-label">站點</div></div>
    <div class="metric-box"><div class="metric-val">${Number(s.user_count).toLocaleString()}</div><div class="metric-label">目前人數</div></div>
    <div class="metric-box"><div class="metric-val ${isMulti ? 'red' : ''}">${(s.roaming_rate*100).toFixed(1)}%</div><div class="metric-label">漫遊率${isMulti ? ' ⚠' : ''}</div></div>
    <div class="metric-box"><div class="metric-val">${s.growth_rate ? (s.growth_rate*100).toFixed(1)+'%' : '—'}</div><div class="metric-label">人流增幅</div></div>
  `;

  // SOP banner
  document.getElementById('sop-banner').innerHTML = isMulti
    ? `<div class="sop-card sop-triggered">📌 <b>SOP 第 6 條觸發</b>｜漫遊率 ${(s.roaming_rate*100).toFixed(1)}% ≥ 30%，將產出 <b>繁中／英文／日文／韓文／泰文／越南文／法文</b> 七語版。</div>`
    : `<div class="sop-card sop-normal">ℹ️ SOP 第 6 條未觸發｜漫遊率 ${(s.roaming_rate*100).toFixed(1)}% &lt; 30%，僅產出<b>繁體中文</b>。</div>`;

  // 清除舊告警
  currentAlerts = {};
  document.getElementById('alerts-editor').classList.add('hidden');
  document.getElementById('btn-publish').disabled = true;
  document.getElementById('btn-generate').disabled = false;
  document.getElementById('publish-result').classList.add('hidden');
}

/* ── 生成告警 ─────────────────────────────────────────────────────────────── */
async function generateAlerts() {
  if (!currentStation) return;
  const s = currentStation;
  const btn = document.getElementById('btn-generate');
  const spinner = document.getElementById('generate-spinner');

  btn.disabled = true;
  spinner.classList.remove('hidden');
  document.getElementById('alerts-editor').classList.add('hidden');

  try {
    const res  = await fetch(`${API}/api/notify/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_id:   s.station_id,
        station_name: s.station_name,
        user_count:   s.user_count,
        roaming_rate: s.roaming_rate,
        growth_rate:  s.growth_rate || 0,
        timestamp:    s.timestamp || '2026-05-20 22:00',
        multilingual: s.roaming_rate >= THRESHOLD,
      }),
    });
    const data = await res.json();
    currentAlerts = data.alerts;
    renderEditor(currentAlerts, s.roaming_rate >= THRESHOLD);
    document.getElementById('btn-publish').disabled = false;
    document.getElementById('publish-hint').style.display = 'none';
    if (data.source === 'mock') {
      showToast('ℹ️ Ollama 未就緒，使用 Mock 預設文字');
    }
  } catch (e) {
    showToast('❌ 生成失敗：' + e.message);
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
  }
}

/* ── 告警編輯器 ───────────────────────────────────────────────────────────── */
function renderEditor(alerts, multilingual) {
  const langs = multilingual ? LANG_ORDER : ['zh_tw'];
  const tabsEl   = document.getElementById('lang-tabs');
  const panelsEl = document.getElementById('lang-panels');

  tabsEl.innerHTML = langs.map((k,i) =>
    `<div class="lang-tab ${i===0?'active':''}" data-lang="${k}">${LANG_LABEL[k]}</div>`
  ).join('');

  panelsEl.innerHTML = langs.map((k,i) =>
    `<div class="lang-panel ${i===0?'active':''}" id="panel-${k}">
       <textarea id="ta-${k}">${alerts[k] || ''}</textarea>
     </div>`
  ).join('');

  // Tab 切換
  tabsEl.querySelectorAll('.lang-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'));
      panelsEl.querySelectorAll('.lang-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.lang}`).classList.add('active');
    });
  });

  document.getElementById('alerts-editor').classList.remove('hidden');
}

/* ── 讀取編輯器當前文字 ──────────────────────────────────────────────────── */
function getEditedAlerts() {
  const result = {};
  LANG_ORDER.forEach(k => {
    const ta = document.getElementById(`ta-${k}`);
    if (ta) result[k] = ta.value;
  });
  return result;
}

/* ── 發布 ─────────────────────────────────────────────────────────────────── */
async function publishAlerts() {
  if (!currentStation) return;
  const alerts = getEditedAlerts();

  try {
    const res  = await fetch(`${API}/api/notify/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_name: currentStation.station_name,
        roaming_rate: currentStation.roaming_rate,
        alerts,
        channels: ['cell_broadcast', 'cms'],
      }),
    });
    const data = await res.json();
    if (data.success) {
      currentAlerts = alerts;
      showPublishResult(data);
      updateLogTable(data.log_entry);
    }
  } catch (e) {
    showToast('❌ 發布失敗：' + e.message);
  }
}

/* ── 發布結果預覽 ─────────────────────────────────────────────────────────── */
function showPublishResult(data) {
  const s = currentStation;
  const isMulti = s.roaming_rate >= THRESHOLD;
  const langs   = isMulti ? LANG_ORDER.filter(k => currentAlerts[k]) : ['zh_tw'];
  activeLang    = langs[0];

  document.getElementById('publish-time').textContent =
    `　⏱ ${new Date(data.published_at).toLocaleTimeString()}`;

  // 語言按鈕
  const btnsEl = document.getElementById('preview-lang-btns');
  btnsEl.innerHTML = langs.map(k =>
    `<button class="preview-lang-btn ${k===activeLang?'active':''}" data-lang="${k}">${LANG_LABEL[k]}</button>`
  ).join('');
  btnsEl.querySelectorAll('.preview-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btnsEl.querySelectorAll('.preview-lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeLang = btn.dataset.lang;
      updatePreview();
    });
  });

  document.getElementById('publish-result').classList.remove('hidden');
  document.getElementById('log-section').style.display = 'block';
  updatePreview();
}

/* ── 更新預覽（iPhone + CMS）────────────────────────────────────────────── */
function updatePreview() {
  const msg  = currentAlerts[activeLang] || '（無內容）';
  const meta = CMS_META[activeLang] || CMS_META.zh_tw;
  const now  = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const sname = currentStation?.station_name || '';

  document.getElementById('iphone-msg').textContent  = msg;
  document.getElementById('iphone-time').textContent = now;
  document.getElementById('cms-flag').textContent    = meta.flag;
  document.getElementById('cms-title').textContent   = `⚠ ${meta.title} — ${sname}`;
  document.getElementById('cms-body').textContent    = msg;
  document.getElementById('cms-footer').textContent  =
    `發布：${new Date().toLocaleDateString('zh-TW')} ${now} ｜ 交控中心`;
}

/* ── 日誌表格 ─────────────────────────────────────────────────────────────── */
function updateLogTable(entry) {
  const tbody = document.getElementById('log-tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${entry.time}</td>
    <td>${entry.station}</td>
    <td>${entry.roaming_rate}</td>
    <td>${entry.lang_count}</td>
    <td style="color:#27ae60;font-weight:700">✅ 成功</td>
  `;
  tbody.prepend(tr);
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#333;color:#fff;padding:10px 20px;border-radius:8px;
    font-size:.9rem;z-index:9999;opacity:1;transition:opacity .4s;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}
