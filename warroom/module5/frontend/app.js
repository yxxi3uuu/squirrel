/* Module 5 Frontend — 嵌入戰情室 drawer 用 */
const API = '/api';
const THRESHOLD = 0.30;
const LANG_ORDER = ['zh_tw','en','ja','ko','th','vi','fr'];
const LANG_LABEL = {
  zh_tw:'🇹🇼 繁中', en:'🇺🇸 EN', ja:'🇯🇵 日',
  ko:'🇰🇷 韓', th:'🇹🇭 泰', vi:'🇻🇳 越', fr:'🇫🇷 法',
};
const CMS_META = {
  zh_tw:{flag:'🇹🇼 繁體中文',title:'交通管制通報'},
  en:{flag:'🇺🇸 English',title:'TRAFFIC ALERT'},
  ja:{flag:'🇯🇵 日本語',title:'交通規制情報'},
  ko:{flag:'🇰🇷 한국어',title:'교통 통제 알림'},
  th:{flag:'🇹🇭 ภาษาไทย',title:'ประกาศจราจร'},
  vi:{flag:'🇻🇳 Tiếng Việt',title:'CẢNH BÁO GIAO THÔNG'},
  fr:{flag:'🇫🇷 Français',title:'ALERTE CIRCULATION'},
};

let stations = [], currentAlerts = {}, currentStation = null, activeLang = 'zh_tw';

document.addEventListener('DOMContentLoaded', () => {
  loadStations();
  document.getElementById('btn-generate').addEventListener('click', generateAlerts);
  document.getElementById('btn-publish').addEventListener('click', publishAlerts);
});

async function loadStations() {
  try {
    const res = await fetch(`${API}/signal/stations`);
    const data = await res.json();
    stations = data.stations;
    renderKPI(); renderTriggered(); renderTable(); renderSelect();
  } catch(e) { console.error('載入失敗', e); }
}

function renderKPI() {
  const triggered = stations.filter(s => s.roaming_rate >= THRESHOLD);
  const max = Math.max(...stations.map(s => s.roaming_rate)) * 100;
  document.getElementById('kpi-triggered').textContent = triggered.length;
  document.getElementById('kpi-total').textContent = stations.length;
  const el = document.getElementById('kpi-maxrate');
  el.textContent = max.toFixed(1) + '%';
  el.className = 'kpi-val ' + (max >= 30 ? 'red' : 'yellow');
}

function renderTriggered() {
  const list = stations.filter(s => s.roaming_rate >= THRESHOLD)
                       .sort((a,b) => b.roaming_rate - a.roaming_rate);
  const c = document.getElementById('triggered-cards');
  if (!list.length) { c.innerHTML = '<div class="card-yellow">✅ 無站點觸發 SOP 第6條</div>'; return; }
  c.innerHTML = list.map(s => `
    <div class="card-red"><b style="color:#f27a84">⚠ ${s.station_name}</b>
    <span style="color:#a0b3c4;font-size:.82rem;margin-left:8px">${s.station_id}</span><br>
    漫遊率 <b class="red">${(s.roaming_rate*100).toFixed(1)}%</b> ｜ 人數 <b>${Number(s.user_count).toLocaleString()}</b></div>
  `).join('');
}

function renderTable() {
  document.getElementById('station-tbody').innerHTML = stations.map(s => `
    <tr><td>${s.station_id}</td><td class="${s.roaming_rate>=THRESHOLD?'tag-triggered':''}">${s.station_name}</td>
    <td>${Number(s.user_count).toLocaleString()}</td>
    <td class="${s.roaming_rate>=THRESHOLD?'tag-triggered':''}">${(s.roaming_rate*100).toFixed(1)}%</td>
    <td>${s.growth_rate?(s.growth_rate*100).toFixed(1)+'%':'—'}</td></tr>
  `).join('');
}

function renderSelect() {
  const sel = document.getElementById('station-select');
  const sorted = [...stations].sort((a,b) => b.roaming_rate - a.roaming_rate);
  sel.innerHTML = sorted.map(s => {
    const f = s.roaming_rate >= THRESHOLD ? '🔴' : '🟢';
    return `<option value="${s.station_id}">${f} ${s.station_name} (${(s.roaming_rate*100).toFixed(1)}%)</option>`;
  }).join('');
  sel.addEventListener('change', updateInfo);
  updateInfo();
}

function updateInfo() {
  const sid = document.getElementById('station-select').value;
  currentStation = stations.find(s => s.station_id === sid);
  if (!currentStation) return;
  const s = currentStation, multi = s.roaming_rate >= THRESHOLD;
  document.getElementById('station-metrics').innerHTML = `
    <div class="metric-box"><div class="metric-val">${s.station_name}</div><div class="metric-label">站點</div></div>
    <div class="metric-box"><div class="metric-val">${Number(s.user_count).toLocaleString()}</div><div class="metric-label">人數</div></div>
    <div class="metric-box"><div class="metric-val ${multi?'red':''}">${(s.roaming_rate*100).toFixed(1)}%</div><div class="metric-label">漫遊率</div></div>
  `;
  document.getElementById('sop-banner').innerHTML = multi
    ? `<div class="card-red">📌 <b>SOP 第 6 條觸發</b>｜漫遊率 ≥ 30%，產出七語版。</div>`
    : `<div class="card-yellow">ℹ️ SOP 未觸發｜僅產出繁體中文。</div>`;
  currentAlerts = {};
  document.getElementById('alerts-editor').classList.add('hidden');
  document.getElementById('btn-publish').disabled = true;
  document.getElementById('btn-generate').disabled = false;
  document.getElementById('publish-result').classList.add('hidden');
}

async function generateAlerts() {
  if (!currentStation) return;
  const s = currentStation;
  document.getElementById('btn-generate').disabled = true;
  document.getElementById('generate-spinner').classList.remove('hidden');
  try {
    const res = await fetch(`${API}/notify/generate`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        station_id:s.station_id, station_name:s.station_name,
        user_count:s.user_count, roaming_rate:s.roaming_rate,
        growth_rate:s.growth_rate||0, timestamp:s.timestamp||'',
        multilingual: s.roaming_rate >= THRESHOLD,
      }),
    });
    const data = await res.json();
    currentAlerts = data.alerts;
    renderEditor(s.roaming_rate >= THRESHOLD);
    document.getElementById('btn-publish').disabled = false;
    document.getElementById('publish-hint').style.display = 'none';
  } catch(e) { alert('生成失敗: '+e.message); }
  finally {
    document.getElementById('btn-generate').disabled = false;
    document.getElementById('generate-spinner').classList.add('hidden');
  }
}

function renderEditor(multi) {
  const langs = multi ? LANG_ORDER : ['zh_tw'];
  document.getElementById('lang-tabs').innerHTML = langs.map((k,i) =>
    `<div class="lang-tab ${i===0?'active':''}" data-lang="${k}">${LANG_LABEL[k]}</div>`).join('');
  document.getElementById('lang-panels').innerHTML = langs.map((k,i) =>
    `<div class="lang-panel ${i===0?'active':''}" id="panel-${k}"><textarea id="ta-${k}">${currentAlerts[k]||''}</textarea></div>`).join('');
  document.querySelectorAll('.lang-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lang-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.lang-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.lang}`).classList.add('active');
    });
  });
  document.getElementById('alerts-editor').classList.remove('hidden');
}

async function publishAlerts() {
  if (!currentStation) return;
  const alerts = {};
  LANG_ORDER.forEach(k => { const t=document.getElementById(`ta-${k}`); if(t) alerts[k]=t.value; });
  try {
    const res = await fetch(`${API}/notify/publish`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ station_name:currentStation.station_name,
                             roaming_rate:currentStation.roaming_rate, alerts, channels:['cell_broadcast','cms'] }),
    });
    const data = await res.json();
    if (data.success) { currentAlerts=alerts; showResult(data); }
  } catch(e) { alert('發布失敗: '+e.message); }
}

function showResult(data) {
  const multi = currentStation.roaming_rate >= THRESHOLD;
  const langs = multi ? LANG_ORDER.filter(k=>currentAlerts[k]) : ['zh_tw'];
  activeLang = langs[0];
  document.getElementById('publish-time').textContent = ' ⏱ ' + new Date().toLocaleTimeString();
  const btns = document.getElementById('preview-lang-btns');
  btns.innerHTML = langs.map(k => `<button class="preview-lang-btn ${k===activeLang?'active':''}" data-lang="${k}">${LANG_LABEL[k]}</button>`).join('');
  btns.querySelectorAll('.preview-lang-btn').forEach(b => {
    b.addEventListener('click', () => {
      btns.querySelectorAll('.preview-lang-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); activeLang=b.dataset.lang; updatePreview();
    });
  });
  document.getElementById('publish-result').classList.remove('hidden');
  updatePreview();
}

function updatePreview() {
  const msg = currentAlerts[activeLang] || '（無內容）';
  const meta = CMS_META[activeLang] || CMS_META.zh_tw;
  const now = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  document.getElementById('iphone-msg').textContent = msg;
  document.getElementById('iphone-time').textContent = now;
  document.getElementById('cms-flag').textContent = meta.flag;
  document.getElementById('cms-title').textContent = `⚠ ${meta.title} — ${currentStation?.station_name||''}`;
  document.getElementById('cms-body').textContent = msg;
  document.getElementById('cms-footer').textContent = `發布：${new Date().toLocaleDateString('zh-TW')} ${now} ｜ 交控中心`;
}
