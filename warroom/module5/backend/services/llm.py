"""LLM 呼叫服務 — 多語通報生成（支援 Ollama / Bedrock / Mock）"""

import json, urllib.request, urllib.error, os

LLM_MODE     = os.environ.get("LLM_MODE",     "ollama")
OLLAMA_URL   = os.environ.get("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")

LANG_META = {
    "zh_tw": ("🇹🇼 繁體中文", "交通管制通報",       "【繁體中文】"),
    "en":    ("🇺🇸 English",  "TRAFFIC ALERT",       "【English】"),
    "ja":    ("🇯🇵 日本語",   "交通規制情報",         "【日本語】"),
    "ko":    ("🇰🇷 한국어",   "교통 통제 알림",       "【한국어】"),
    "th":    ("🇹🇭 ภาษาไทย", "ประกาศจราจร",          "【ภาษาไทย】"),
    "vi":    ("🇻🇳 Tiếng Việt","CẢNH BÁO GIAO THÔNG","【Tiếng Việt】"),
    "fr":    ("🇫🇷 Français", "ALERTE CIRCULATION",   "【Français】"),
}

def check_ollama() -> dict:
    if LLM_MODE == "bedrock":
        return {"ok": True, "models": [BEDROCK_MODEL_ID],
                "message": f"Bedrock 模式 · {BEDROCK_MODEL_ID}"}
    if LLM_MODE == "mock":
        return {"ok": True, "models": ["mock"],
                "message": "Mock 模式 · 預設文字"}
    try:
        res  = urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=4)
        data = json.loads(res.read())
        names = [m["name"] for m in data.get("models", [])]
        base  = OLLAMA_MODEL.split(":")[0]
        ok    = any(n.startswith(base) for n in names)
        return {"ok": ok, "models": names,
                "message": f"模型 {OLLAMA_MODEL} 就緒" if ok
                           else f"找不到 {OLLAMA_MODEL}，請執行 ollama pull {OLLAMA_MODEL}"}
    except urllib.error.URLError:
        return {"ok": False, "models": [],
                "message": "無法連線 Ollama，請安裝並啟動 https://ollama.com/download/windows"}
    except Exception as e:
        return {"ok": False, "models": [], "message": str(e)}


def generate_alerts(sid: str, name: str, user_count: int,
                    roaming_rate: float, growth_rate: float,
                    timestamp: str, multilingual: bool) -> dict:
    langs = "繁體中文、English、日本語、한국어、ภาษาไทย、Tiếng Việt、Français" \
            if multilingual else "繁體中文"

    system_msg = (
        "你是城市交通指揮中心緊急通報撰稿員。\n"
        "請嚴格按照以下格式輸出，每種語言獨立一段，標籤不可省略：\n\n"
        "【繁體中文】（繁體中文通報內容，50-80字）\n"
        "【English】（English alert content, 50-80 words）\n"
        "【日本語】（日本語の通報内容、50〜80字）\n"
        "【한국어】（한국어 통보 내용, 50-80자）\n"
        "【ภาษาไทย】（เนื้อหาแจ้งเตือนภาษาไทย）\n"
        "【Tiếng Việt】（Nội dung thông báo tiếng Việt）\n"
        "【Français】（Contenu de l'alerte en français）\n\n"
        "內容須涵蓋：壅塞位置、改道建議、行動指引。口吻簡潔堅定。\n"
    )

    user_msg = (
        f"站點：{name}（{sid}）\n"
        f"時間：{timestamp}\n"
        f"目前人數：{user_count:,} 人\n"
        f"漫遊率：{roaming_rate*100:.1f}%\n"
        f"人流增幅：{growth_rate*100:+.1f}%\n"
        f"請產出語言：{langs}\n"
    )

    if LLM_MODE == "bedrock":
        return _generate_bedrock(system_msg, user_msg, multilingual)

    # Ollama
    prompt = (
        f"<|im_start|>system\n{system_msg}<|im_end|>\n"
        f"<|im_start|>user\n{user_msg}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )

    payload = json.dumps({
        "model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.4, "top_p": 0.9, "num_predict": 1200},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = json.loads(resp.read())["response"].strip()

    return _parse(raw, multilingual)


def _parse(text: str, multilingual: bool) -> dict:
    import re
    pats = {
        "zh_tw": r"【(?:繁體中文|中文)】(.*?)(?=【[^】]+】|$)",
        "en":    r"【(?:English|英文)】(.*?)(?=【[^】]+】|$)",
        "ja":    r"【(?:日本語|日文)】(.*?)(?=【[^】]+】|$)",
        "ko":    r"【(?:한국어|韓文)】(.*?)(?=【[^】]+】|$)",
        "th":    r"【(?:ภาษาไทย|泰文)】(.*?)(?=【[^】]+】|$)",
        "vi":    r"【(?:Tiếng Việt|越南文)】(.*?)(?=【[^】]+】|$)",
        "fr":    r"【(?:Français|法文)】(.*?)(?=【[^】]+】|$)",
    }
    result, found = {}, False
    for lang, pat in pats.items():
        m = re.search(pat, text, re.DOTALL | re.IGNORECASE)
        if m:
            result[lang] = m.group(1).strip()
            found = True
    if not found:
        segs = [s.strip() for s in re.split(r'\n{2,}', text) if s.strip()]
        keys = list(pats.keys()) if multilingual else ["zh_tw"]
        for i, k in enumerate(keys):
            result[k] = segs[i] if i < len(segs) else segs[0] if segs else text
    if not multilingual:
        return {"zh_tw": result.get("zh_tw", text)}
    for k in pats:
        result.setdefault(k, "")
    return result


def mock_alerts(name: str) -> dict:
    return {
        "zh_tw": f"【交通管制】{name}周邊人流壅塞，請改乘替代路線或延後出行，依現場指引疏散。",
        "en":    f"[ALERT] Heavy crowd near {name}. Use alternative routes or delay travel.",
        "ja":    f"【交通規制】{name}付近が混雑しています。代替ルートをご利用ください。",
        "ko":    f"【교통 통제】{name} 인근 혼잡. 대체 노선 이용을 권장합니다.",
        "th":    f"【ประกาศจราจร】บริเวณ{name}มีผู้คนหนาแน่น กรุณาใช้เส้นทางอื่น",
        "vi":    f"【Thông báo】Khu vực {name} đông đúc. Vui lòng sử dụng tuyến đường thay thế.",
        "fr":    f"【Alerte】Forte densité près de {name}. Veuillez emprunter des itinéraires alternatifs.",
    }


def _generate_bedrock(system_msg: str, user_msg: str, multilingual: bool) -> dict:
    """使用 AWS Bedrock Claude 生成多語通報。"""
    import boto3
    client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

    response = client.converse(
        modelId=BEDROCK_MODEL_ID,
        system=[{"text": system_msg}],
        messages=[{"role": "user", "content": [{"text": user_msg}]}],
        inferenceConfig={"temperature": 0.4, "maxTokens": 1500},
    )

    raw = response["output"]["message"]["content"][0]["text"].strip()
    return _parse(raw, multilingual)
