/* ── Leaflet Map Init ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const map = L.map('leaflet-map', { zoomControl: false }).setView([25.0336, 121.5636], 15);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // 路段（模擬）
  const roads = [
    { name: '忠孝東路四段', pts: [[25.041,121.557],[25.040,121.572]], color: '#e2707a' },
    { name: '基隆路一段',   pts: [[25.033,121.548],[25.028,121.549]], color: '#d6a45d' },
    { name: '市民大道四段', pts: [[25.046,121.560],[25.045,121.570]], color: '#7ccf91' },
    { name: '松高路',       pts: [[25.035,121.565],[25.033,121.566]], color: '#7ccf91' },
    { name: '信義路五段',   pts: [[25.033,121.556],[25.033,121.572]], color: '#d6a45d' },
    { name: '光復南路',     pts: [[25.040,121.551],[25.030,121.552]], color: '#7ccf91' },
  ];
  roads.forEach(r => {
    L.polyline(r.pts, { color: r.color, weight: 5, opacity: 0.9 }).addTo(map).bindTooltip(r.name);
  });

  // 基地台標記
  const stations = [
    { name: '台北101廣場',       pos: [25.034, 121.564], alert: true },
    { name: '大巨蛋場館內',      pos: [25.044, 121.560], alert: false },
    { name: '捷運國父紀念館站',  pos: [25.041, 121.557], alert: false },
    { name: 'ATT4FUN周邊',       pos: [25.036, 121.567], alert: true },
    { name: '信義威秀商圈',      pos: [25.034, 121.562], alert: true },
  ];
  stations.forEach(s => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="font-size:20px;filter:drop-shadow(0 0 4px rgba(0,0,0,.8))">${s.alert ? '⛑️' : '🐿️'}</div>`,
      iconSize: [24, 24],
    });
    L.marker(s.pos, { icon }).addTo(map).bindTooltip(s.name);
  });
});

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

/* ── Incident Injection (mock) ────────────────────────────────────────────── */
function injectIncident() {
  // Mock: 切到事件 tab、顯示決策卡片（已有 HTML）
  alert('✅ 事件已注入！SOP-2 決策已產生。');
}

/* ── Bell ──────────────────────────────────────────────────────────────────── */
document.getElementById('bell-btn').addEventListener('click', () => {
  document.getElementById('toast').classList.remove('hidden');
});
