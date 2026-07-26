"""
模組 5：多語化全通路通報模組  ─  app.py
執行：streamlit run app.py

LLM 後端：Ollama  (http://localhost:11434)
  安裝：https://ollama.com/download/windows
  拉模型：ollama pull qwen2.5:3b

.env 設定（選填）：
  OLLAMA_MODEL=qwen2.5:3b
  OLLAMA_URL=http://localhost:11434
"""

import os, re, json
import urllib.request, urllib.error
import pandas as pd
import streamlit as st

# ── 載入 .env ─────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── 頁面設定 ──────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="模組 5｜多語化全通路通報",
    page_icon="🚨",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── 全域 CSS ──────────────────────────────────────────────────────────────────
st.markdown("""
<style>
/* ── 白底主色調 ── */
html, body, [data-testid="stAppViewContainer"] {
    background-color:#f8f9fa !important; color:#1a1a2e !important;
}
[data-testid="stSidebar"] {
    background-color:#ffffff !important;
    border-right: 2px solid #e0e0e0;
}
/* 所有 Streamlit 預設文字確保深色 */
[data-testid="stSidebar"] * { color:#1a1a2e !important; }

/* ── 區塊標題 ── */
.sec-hdr {
    font-size:1.05rem; font-weight:700; letter-spacing:.06em;
    color:#c0392b;
    border-left:4px solid #c0392b; padding:4px 10px; margin:18px 0 12px 0;
    background:#fdecea; border-radius:0 6px 6px 0;
}

/* ── 警戒卡片 ── */
.card-red {
    background:#fff0f0; border:2px solid #e74c3c;
    border-radius:8px; padding:12px 16px; margin-bottom:8px;
    color:#1a1a2e;
}
.card-yellow {
    background:#fffbf0; border:2px solid #f39c12;
    border-radius:8px; padding:12px 16px; margin-bottom:8px;
    color:#1a1a2e;
}

/* ── KPI 數字 ── */
.kpi    { font-size:2rem; font-weight:800; }
.red    { color:#c0392b; }
.yellow { color:#d35400; }
.green  { color:#27ae60; }

/* ── iPhone 模擬框 ── */
.iphone {
    background:#f0f0f5; border:3px solid #c0c0c8; border-radius:36px;
    padding:40px 22px 28px; max-width:300px; margin:auto;
    box-shadow:0 0 0 7px #dcdce0, 0 8px 28px rgba(0,0,0,.15);
}
.notch  { width:90px; height:16px; background:#c0c0c8;
          border-radius:0 0 10px 10px; margin:-30px auto 18px; }
.bubble { background:#2980b9; border-radius:16px 16px 4px 16px;
          padding:11px 14px; color:#fff; font-size:.87rem;
          line-height:1.55; word-break:break-word; }

/* ── CMS 電子看板（保留黑底，這是刻意的視覺設計）── */
.cms       { background:#1a1a1a; border:2px solid #f39c12; border-radius:8px;
             padding:24px 28px; text-align:center;
             font-family:'Courier New',monospace; }
.cms-title { color:#e74c3c; font-size:1.5rem; font-weight:900;
             letter-spacing:.1em; margin-bottom:8px; }
.cms-body  { color:#f39c12; font-size:1rem; line-height:1.7; }
</style>
""", unsafe_allow_html=True)

# ── 常數 ──────────────────────────────────────────────────────────────────────
DATA_PATH         = os.path.join("warroom", "data_source", "signaling_crowd_density.csv")
ROAMING_THRESHOLD = 0.30
OLLAMA_URL        = os.environ.get("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL      = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")

# ── 欄位別名映射 ───────────────────────────────────────────────────────────────
_ALIASES = {
    "station_id"  : ["BS_ID","station_id","StationID","bs_id"],
    "station_name": ["Location_Name","station_name","StationName","name"],
    "user_count"  : ["User_Count","user_count","UserCount","current_users"],
    "roaming_pct" : ["Roaming_User_Pct","roaming_rate","RoamingRate",
                     "roaming_users","roaming_pct"],
    "growth_rate" : ["Growth_Rate","growth_rate","GrowthRate"],
    "timestamp"   : ["Timestamp","timestamp","Time"],
    "stay_time"   : ["Stay_Time_Avg","stay_time","StayTime"],
}

def _col(df, key):
    for a in _ALIASES.get(key, []):
        if a in df.columns: return a
    return None

def _pct(v) -> float:
    if pd.isna(v): return 0.0
    s = str(v).strip().rstrip("%")
    try:
        n = float(s); return n/100.0 if n > 1.0 else n
    except ValueError: return 0.0

# ── 資料載入 ───────────────────────────────────────────────────────────────────
@st.cache_data(show_spinner="📡 載入信令資料…")
def load_data(path: str):
    df = pd.read_csv(path)
    rmap = {}
    for key in _ALIASES:
        c = _col(df, key)
        if c and c != key: rmap[c] = key
    df = df.rename(columns=rmap)
    df["roaming_rate"] = df["roaming_pct"].apply(_pct) if "roaming_pct" in df.columns else 0.0
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values("timestamp")
        latest = df.groupby("station_id").last().reset_index()
    else:
        latest = df.copy()
    return df, latest

# ── Ollama 連線檢查 ───────────────────────────────────────────────────────────
@st.cache_resource(show_spinner="🤖 檢查 Ollama 連線…")
def check_ollama(url: str, model: str):
    """回傳 (ok: bool, msg: str)"""
    try:
        res  = urllib.request.urlopen(f"{url}/api/tags", timeout=4)
        data = json.loads(res.read())
        names = [m["name"] for m in data.get("models", [])]
        base  = model.split(":")[0]
        if any(n.startswith(base) for n in names):
            return True, f"✅ 已連線，模型 `{model}` 就緒"
        avail = ", ".join(f"`{n}`" for n in names) or "（無）"
        return False, f"⚠️ 找不到 `{model}`\n已有：{avail}\n請執行：`ollama pull {model}`"
    except urllib.error.URLError:
        return False, "⚠️ 無法連線 Ollama\n請安裝並啟動：https://ollama.com/download/windows"
    except Exception as e:
        return False, f"⚠️ 檢查失敗：{e}"

# ── Ollama 推論 ───────────────────────────────────────────────────────────────
def call_ollama(prompt: str) -> str:
    payload = json.dumps({
        "model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.4, "top_p": 0.9, "num_predict": 1200},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())["response"].strip()

# ── Mock 告警（Ollama 不可用時的 fallback）───────────────────────────────────
def mock_alerts(name: str) -> dict:
    return {
        "zh_tw": f"【交通管制】{name}周邊人流壅塞，請改乘替代路線或延後出行，依現場指引疏散。",
        "en":    f"[ALERT] Heavy crowd near {name}. Use alternative routes or delay travel. Follow staff instructions.",
        "ja":    f"【交通規制】{name}付近が混雑しています。代替ルートをご利用または出発時間を変更ください。",
        "ko":    f"【교통 통제】{name} 인근 혼잡. 대체 노선 이용 또는 출발 시간 조정을 권장합니다.",
        "th":    f"【ประกาศจราจร】บริเวณ{name}มีผู้คนหนาแน่น กรุณาใช้เส้นทางอื่นหรือเดินทางในเวลาอื่น",
        "vi":    f"【Thông báo giao thông】Khu vực {name} đông đúc. Vui lòng sử dụng tuyến đường thay thế hoặc trì hoãn việc đi lại.",
        "fr":    f"【Alerte circulation】Forte densité de foule près de {name}. Veuillez emprunter des itinéraires alternatifs ou différer votre déplacement.",
    }

# ── 告警生成 ──────────────────────────────────────────────────────────────────
def gen_alerts(ollama_ok: bool, sid, name, user_count, roaming_rate,
               growth_rate, timestamp, multilingual) -> dict:
    if not ollama_ok:
        return mock_alerts(name)
    langs  = "繁體中文、English、日本語、한국어、ภาษาไทย、Tiếng Việt、Français" if multilingual else "繁體中文"
    prompt = (
        f"<|im_start|>system\n"
        f"你是城市交通指揮中心緊急通報撰稿員。\n"
        f"請嚴格按照以下格式輸出，每種語言獨立一段，標籤不可省略：\n\n"
        f"【繁體中文】（繁體中文通報內容，50-80字）\n"
        f"【English】（English alert content, 50-80 words）\n"
        f"【日本語】（日本語の通報内容、50〜80字）\n"
        f"【한국어】（한국어 통보 내용, 50-80자）\n"
        f"【ภาษาไทย】（เนื้อหาแจ้งเตือนภาษาไทย 50-80 คำ）\n"
        f"【Tiếng Việt】（Nội dung thông báo tiếng Việt, 50-80 từ）\n"
        f"【Français】（Contenu de l'alerte en français, 50-80 mots）\n\n"
        f"內容須涵蓋：壅塞位置、改道建議、行動指引。口吻簡潔堅定，適合手機簡訊。\n"
        f"<|im_end|>\n"
        f"<|im_start|>user\n"
        f"站點：{name}（{sid}）\n"
        f"時間：{timestamp}\n"
        f"目前人數：{user_count:,} 人\n"
        f"漫遊率：{roaming_rate*100:.1f}%（已超過 30% 門檻）\n"
        f"人流增幅：{growth_rate*100:+.1f}%\n\n"
        f"請產出語言：{langs}\n"
        f"<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )
    try:
        text = call_ollama(prompt)
        return _parse(text, multilingual)
    except Exception as e:
        st.warning(f"Ollama 推論失敗：{e}，使用 Mock 替代。")
        return mock_alerts(name)

def _parse(text: str, multilingual: bool) -> dict:
    pats = {
        "zh_tw": r"【(?:繁體中文|中文|ZH[-_]TW|zh_tw|Chinese)】(.*?)(?=【[^】]+】|$)",
        "en"   : r"【(?:English|英文|EN|en)】(.*?)(?=【[^】]+】|$)",
        "ja"   : r"【(?:日本語|日文|JA|ja|Japanese)】(.*?)(?=【[^】]+】|$)",
        "ko"   : r"【(?:한국어|韓文|KO|ko|Korean)】(.*?)(?=【[^】]+】|$)",
        "th"   : r"【(?:ภาษาไทย|泰文|Thai|TH|th)】(.*?)(?=【[^】]+】|$)",
        "vi"   : r"【(?:Tiếng Việt|越南文|Vietnamese|VI|vi)】(.*?)(?=【[^】]+】|$)",
        "fr"   : r"【(?:Français|法文|French|FR|fr)】(.*?)(?=【[^】]+】|$)",
    }
    result, found = {}, False
    for lang, pat in pats.items():
        m = re.search(pat, text, re.DOTALL | re.IGNORECASE)
        if m:
            result[lang] = m.group(1).strip()
            found = True

    if not found:
        segments = [s.strip() for s in re.split(r'\n{2,}', text) if s.strip()]
        lang_keys = ["zh_tw","en","ja","ko","th","vi","fr"] if multilingual else ["zh_tw"]
        for i, key in enumerate(lang_keys):
            result[key] = segments[i] if i < len(segments) else segments[0] if segments else text

    if not multilingual:
        return {"zh_tw": result.get("zh_tw", text), "en":"", "ja":"", "ko":"",
                "th":"", "vi":"", "fr":""}

    for lang in ["zh_tw","en","ja","ko","th","vi","fr"]:
        if lang not in result:
            result[lang] = ""
    return result

# ══════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ══════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.markdown("## 🛰️ 模組 5 控制台")
    st.markdown("---")

    # 模型設定
    st.markdown("**⚙️ Ollama 設定**")
    ollama_url_input   = st.text_input("API 位址", value=OLLAMA_URL)
    ollama_model_input = st.text_input("模型名稱", value=OLLAMA_MODEL,
                                        help="ollama pull qwen2.5:3b")
    if st.button("🔄 重新檢查連線", use_container_width=True):
        st.cache_resource.clear()
        st.rerun()

    # 資料狀態
    st.markdown("---")
    st.markdown("**📡 信令資料**")
    try:
        df_all, df_latest = load_data(DATA_PATH)
        st.success("✅ 資料已載入")
        st.markdown(f"總筆數：`{len(df_all)}`　站點數：`{len(df_latest)}`")
        if "timestamp" in df_all.columns:
            st.caption(
                f"{df_all['timestamp'].min().strftime('%m/%d %H:%M')} → "
                f"{df_all['timestamp'].max().strftime('%m/%d %H:%M')}"
            )
        data_ok = True
    except Exception as e:
        st.error(f"❌ 載入失敗：{e}")
        data_ok = False

    # LLM 狀態
    st.markdown("---")
    st.markdown("**🤖 Ollama 狀態**")
    ollama_ok, ollama_msg = check_ollama(OLLAMA_URL, OLLAMA_MODEL)
    if ollama_ok:
        st.success(ollama_msg)
    else:
        st.warning(ollama_msg)

    st.markdown("---")
    st.caption("SOP 第 6 條：漫遊率 ≥ 30% → 多語化觸發")

# ══════════════════════════════════════════════════════════════════════════════
# MAIN PANEL
# ══════════════════════════════════════════════════════════════════════════════
st.markdown(
    "<h1 style='color:#c0392b;letter-spacing:.04em;margin-bottom:4px'>"
    "🚨 模組 5｜多語化全通路通報指揮台</h1>",
    unsafe_allow_html=True,
)

if not data_ok:
    st.error("資料未載入，請確認 `warroom/data_source/signaling_crowd_density.csv` 存在。")
    st.stop()

# ── 區塊一：信令監控 ──────────────────────────────────────────────────────────
st.markdown('<div class="sec-hdr">📡 區塊一：信令監控與警報狀態</div>',
            unsafe_allow_html=True)

triggered = df_latest[df_latest["roaming_rate"] >= ROAMING_THRESHOLD].copy()

c1, c2, c3 = st.columns(3)
with c1:
    col = "red" if len(triggered) else "green"
    st.markdown(f"<div style='text-align:center'><div class='kpi {col}'>{len(triggered)}</div>"
                "<div>🔴 SOP 第6條觸發站點</div></div>", unsafe_allow_html=True)
with c2:
    st.markdown(f"<div style='text-align:center'><div class='kpi yellow'>{len(df_latest)}</div>"
                "<div>🛰️ 監控站點總數</div></div>", unsafe_allow_html=True)
with c3:
    mr = df_latest["roaming_rate"].max() * 100
    col = "red" if mr >= 30 else "yellow"
    st.markdown(f"<div style='text-align:center'><div class='kpi {col}'>{mr:.1f}%</div>"
                "<div>📊 最高漫遊率</div></div>", unsafe_allow_html=True)

st.markdown("<br>", unsafe_allow_html=True)

if len(triggered):
    st.markdown("**🔴 已觸發多語化告警的站點：**")
    for _, r in triggered.sort_values("roaming_rate", ascending=False).iterrows():
        uc = int(r.get("user_count", 0))
        st.markdown(
            f'<div class="card-red"><b class="red">⚠ {r["station_name"]}</b>'
            f'&ensp;<span style="color:#555;font-size:.82rem">{r["station_id"]}</span><br>'
            f'漫遊率 <b class="red">{r["roaming_rate"]*100:.1f}%</b>'
            f'&ensp;｜&ensp;人數 <b>{uc:,}</b></div>', unsafe_allow_html=True)
else:
    st.markdown('<div class="card-yellow">✅ 無站點觸發 SOP 第6條（漫遊率均 &lt; 30%）</div>',
                unsafe_allow_html=True)

with st.expander("📋 最新快照完整表格", expanded=False):
    show = [c for c in ["station_id","station_name","user_count",
                        "roaming_rate","growth_rate","stay_time"] if c in df_latest.columns]
    tbl = df_latest[show].copy()
    if "roaming_rate" in tbl: tbl["roaming_rate"] = tbl["roaming_rate"].map(lambda x: f"{x*100:.1f}%")
    if "growth_rate"  in tbl: tbl["growth_rate"]  = tbl["growth_rate"].map(lambda x: f"{x*100:+.1f}%")
    st.dataframe(tbl, use_container_width=True, hide_index=True)

st.markdown("---")
# ── 區塊二：多語化告警生成 ────────────────────────────────────────────────────
st.markdown('<div class="sec-hdr">🌐 區塊二：多語化告警生成</div>', unsafe_allow_html=True)

opts = df_latest.sort_values("roaming_rate", ascending=False).copy()
opts["label"] = opts.apply(
    lambda r: f"🔴 {r['station_name']} ({r['roaming_rate']*100:.1f}%)"
              if r["roaming_rate"] >= ROAMING_THRESHOLD
              else f"🟢 {r['station_name']} ({r['roaming_rate']*100:.1f}%)", axis=1)

sel_label    = st.selectbox("選擇站點", opts["label"].tolist(), help="🔴 已觸發  |  🟢 正常")
sel          = opts[opts["label"] == sel_label].iloc[0]
sid          = sel["station_id"]
sname        = sel["station_name"]
s_roaming    = float(sel["roaming_rate"])
s_count      = int(sel.get("user_count", 0))
s_growth     = float(sel.get("growth_rate", 0))
s_ts         = str(sel.get("timestamp", "2026-05-20 22:00"))
multilingual = s_roaming >= ROAMING_THRESHOLD

mc1, mc2, mc3, mc4 = st.columns(4)
mc1.metric("站點", sname)
mc2.metric("目前人數", f"{s_count:,}")
mc3.metric("漫遊率", f"{s_roaming*100:.1f}%",
           delta="⚠ 觸發多語" if multilingual else "正常",
           delta_color="inverse" if multilingual else "normal")
mc4.metric("人流增幅", f"{s_growth*100:+.1f}%")

if multilingual:
    st.markdown(
        f'<div class="card-red">📌 <b>SOP 第 6 條觸發</b>｜漫遊率 {s_roaming*100:.1f}% ≥ 30%'
        f'，將產出 <b>繁中／英文／日文／韓文／泰文／越南文／法文</b> 七語版。</div>', unsafe_allow_html=True)
else:
    st.markdown(
        f'<div class="card-yellow">ℹ️ SOP 第 6 條未觸發｜漫遊率 {s_roaming*100:.1f}% &lt; 30%'
        f'，僅產出<b>繁體中文</b>。</div>', unsafe_allow_html=True)

# Session state
for k, default in [("alerts",{}),("published",False),("last_sid",None)]:
    if k not in st.session_state: st.session_state[k] = default

if st.session_state.last_sid != sid:
    st.session_state.alerts = {}; st.session_state.published = False
    st.session_state.last_sid = sid

if st.button("⚡ 生成多語告警", type="primary", use_container_width=True):
    with st.spinner("🤖 Ollama 推論中，請稍候…"):
        alerts = gen_alerts(ollama_ok, sid, sname, s_count, s_roaming, s_growth, s_ts, multilingual)
    st.session_state.alerts = alerts; st.session_state.published = False
    if not ollama_ok: st.info("ℹ️ Ollama 未連線，已使用 Mock 預設文字")

alerts = st.session_state.alerts
if alerts:
    lang_lbl   = {
        "zh_tw":"🇹🇼 繁體中文", "en":"🇺🇸 English",
        "ja":"🇯🇵 日本語",      "ko":"🇰🇷 한국어",
        "th":"🇹🇭 ภาษาไทย",    "vi":"🇻🇳 Tiếng Việt",
        "fr":"🇫🇷 Français",
    }
    show_langs = ["zh_tw"] if not multilingual else ["zh_tw","en","ja","ko","th","vi","fr"]
    st.markdown("**✏️ 警告文字（可直接編輯後發布）：**")
    edited, ecols = {}, st.columns(len(show_langs))
    for i, lang in enumerate(show_langs):
        with ecols[i]:
            st.markdown(f"**{lang_lbl[lang]}**")
            edited[lang] = st.text_area(
                lang_lbl[lang], value=alerts.get(lang,""), height=155,
                key=f"ta_{lang}_{sid}", label_visibility="collapsed")
    st.session_state.alerts = {**alerts, **edited}

st.markdown("---")
# ── 區塊三：全通路一鍵模擬發布 ───────────────────────────────────────────────
st.markdown('<div class="sec-hdr">📣 區塊三：全通路一鍵模擬發布</div>', unsafe_allow_html=True)

has_text = bool(st.session_state.alerts.get("zh_tw","").strip())
bc1, bc2 = st.columns([2,3])
with bc1:
    pub = st.button("🚀 一鍵發布通報", type="primary",
                    use_container_width=True, disabled=not has_text)
    if not has_text: st.caption("⬆️ 請先生成告警文字")
with bc2:
    st.markdown("**發布渠道：**\n- 📱 手機 Cell Broadcast 簡訊（全區廣播）\n"
                "- 🖥️ CMS 電子看板（道路及站點）")

if pub: st.session_state.published = True

if st.session_state.published and has_text:
    fa = st.session_state.alerts
    zh = fa.get("zh_tw","")
    st.success("✅ 通報已成功發布！")
    st.markdown(
        f"<div style='text-align:center;color:#27ae60;font-size:1.2rem;font-weight:700'>"
        f"📡 發送成功　｜　⏱ {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')}</div>",
        unsafe_allow_html=True)
    st.markdown("<br>", unsafe_allow_html=True)

    sc1, sc2 = st.columns(2, gap="large")

    # ── 語言選擇器（兩邊共用）──────────────────────────────────────────────
    disp_langs = (
        [("zh_tw","🇹🇼 繁中"),("en","🇺🇸 EN"),("ja","🇯🇵 日"),
         ("ko","🇰🇷 韓"),("th","🇹🇭 泰"),("vi","🇻🇳 越"),("fr","🇫🇷 法")]
        if multilingual else [("zh_tw","🇹🇼 繁中")]
    )
    cms_meta = {
        "zh_tw": ("🇹🇼 繁體中文", "交通管制通報"),
        "en":    ("🇺🇸 English",   "TRAFFIC ALERT"),
        "ja":    ("🇯🇵 日本語",    "交通規制情報"),
        "ko":    ("🇰🇷 한국어",    "교통 통제 알림"),
        "th":    ("🇹🇭 ภาษาไทย",  "ประกาศจราจร"),
        "vi":    ("🇻🇳 Tiếng Việt","CẢNH BÁO GIAO THÔNG"),
        "fr":    ("🇫🇷 Français",  "ALERTE CIRCULATION"),
    }
    lang_options  = [lbl for _, lbl in disp_langs]
    lang_keys     = [k   for k, _  in disp_langs]
    selected_lang = st.radio(
        "📺 顯示語言",
        options=lang_options,
        index=0,
        horizontal=True,
        key="cms_lang_selector",
    )
    active_lang = lang_keys[lang_options.index(selected_lang)]

    with sc1:
        st.markdown("**📱 Cell Broadcast 模擬**")
        msg = fa.get(active_lang, "（無內容）")
        st.markdown(
            f'<div class="iphone"><div class="notch"></div>'
            f'<div style="color:#8e8e93;font-size:.73rem;text-align:center;margin-bottom:8px">緊急廣播通知</div>'
            f'<div class="bubble">{msg}</div>'
            f'<div style="color:#636366;font-size:.7rem;text-align:right;margin-top:6px">'
            f'{pd.Timestamp.now().strftime("%H:%M")}</div></div>',
            unsafe_allow_html=True)

    with sc2:
        st.markdown("**🖥️ CMS 電子看板模擬**")
        flag_name, board_title = cms_meta.get(active_lang, ("","交通管制通報"))
        content = fa.get(active_lang, "")
        st.markdown(
            f'<div class="cms">'
            f'<div style="color:#888;font-size:.75rem;margin-bottom:4px">{flag_name}</div>'
            f'<div class="cms-title">⚠ {board_title} ─ {sname}</div>'
            f'<div class="cms-body">'
            f'<p style="margin:5px 0">{content if content else "（尚無內容）"}</p>'
            f'<p style="color:#555;font-size:.78rem;margin-top:12px">'
            f'發布：{pd.Timestamp.now().strftime("%Y-%m-%d %H:%M")} ｜ 交控中心'
            f'</p></div></div>',
            unsafe_allow_html=True,
        )

# 發布日誌
if "pub_log" not in st.session_state: st.session_state.pub_log = []
if pub and has_text:
    st.session_state.pub_log.append({
        "時間": pd.Timestamp.now().strftime("%H:%M:%S"),
        "站點": sname, "漫遊率": f"{s_roaming*100:.1f}%",
        "語言數": len([l for l in ["zh_tw","en","ja","ko","th","vi","fr"] if fa.get(l,"").strip()]),
        "狀態": "✅ 成功",
    })
if st.session_state.pub_log:
    st.markdown("---")
    st.markdown('<div class="sec-hdr">📋 本次作業發布紀錄</div>', unsafe_allow_html=True)
    st.dataframe(pd.DataFrame(st.session_state.pub_log),
                 use_container_width=True, hide_index=True)

st.markdown(
    "<br><hr><p style='text-align:center;color:#484f58;font-size:.78rem'>"
    "模組 5 ─ 多語化全通路通報 Prototype　｜　SOP 第 6 條　｜　Qwen 2.5</p>",
    unsafe_allow_html=True)
