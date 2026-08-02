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
    # 匹配語言標籤後的內容，直到下一個語言標籤或結尾
    lang_markers = {
        "zh_tw": r"【(?:繁體中文|中文)】",
        "en":    r"【(?:English|英文)】",
        "ja":    r"【(?:日本語|日文)】",
        "ko":    r"【(?:한국어|韓文)】",
        "th":    r"【(?:ภาษาไทย|泰文)】",
        "vi":    r"【(?:Tiếng Việt|越南文)】",
        "fr":    r"【(?:Français|法文)】",
    }
    # 建立所有語言標籤的 alternation 用於 lookahead
    all_lang_pats = "|".join(lang_markers.values())
    result, found = {}, False
    for lang, marker in lang_markers.items():
        pat = marker + r"(.*?)(?=" + all_lang_pats + r"|$)"
        m = re.search(pat, text, re.DOTALL | re.IGNORECASE)
        if m:
            result[lang] = m.group(1).strip()
            found = True
    if not found:
        segs = [s.strip() for s in re.split(r'\n{2,}', text) if s.strip()]
        keys = list(lang_markers.keys()) if multilingual else ["zh_tw"]
        for i, k in enumerate(keys):
            result[k] = segs[i] if i < len(segs) else segs[0] if segs else text
    if not multilingual:
        return {"zh_tw": result.get("zh_tw", text)}
    for k in lang_markers:
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


def translate_cms_text(cms_text: str, multilingual: bool = True) -> dict:
    """將 SOP-2/5 的 CMS 文字整合並翻譯成多語版本。

    若輸入包含多段 CMS（用換行分隔），先用 LLM 整合成一段精簡通知，
    去除重複資訊，再翻譯成七種語言。
    """
    # 先整合多段 CMS（如果有多行表示同時觸發 SOP-2 + SOP-5）
    merged = _merge_cms_texts(cms_text)

    if not multilingual:
        return {"zh_tw": f"【交通管制】{merged}"}

    system_msg = (
        "你是城市交通指揮中心緊急通報翻譯員。\n"
        "將以下中文交通管制告警文字忠實翻譯成七種語言。\n"
        "繁體中文版本前面要加上【交通管制】標題。\n"
        "請嚴格按照以下格式輸出，每種語言獨立一段，標籤不可省略：\n\n"
        "【繁體中文】【交通管制】（中文內容）\n"
        "【English】【TRAFFIC ALERT】（英文翻譯）\n"
        "【日本語】【交通規制】（日文翻譯）\n"
        "【한국어】【교통 통제】（韓文翻譯）\n"
        "【ภาษาไทย】【ประกาศจราจร】（泰文翻譯）\n"
        "【Tiếng Việt】【Cảnh báo giao thông】（越南文翻譯）\n"
        "【Français】【Alerte circulation】（法文翻譯）\n\n"
        "翻譯原則：\n"
        "- 保持簡潔緊急的口吻\n"
        "- 路名保持原文（不翻譯地名）\n"
        "- 不要出現 SOP、ETE 等內部術語\n"
        "- 延誤時間用各語言的自然表達\n"
    )

    user_msg = f"請翻譯以下交通管制告警文字：\n{merged}"

    if LLM_MODE == "bedrock":
        return _generate_bedrock(system_msg, user_msg, multilingual)

    if LLM_MODE == "mock":
        return _mock_translate_cms(merged)

    # Ollama
    prompt = (
        f"<|im_start|>system\n{system_msg}<|im_end|>\n"
        f"<|im_start|>user\n{user_msg}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )

    payload = json.dumps({
        "model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.3, "top_p": 0.9, "num_predict": 1200},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = json.loads(resp.read())["response"].strip()

    return _parse(raw, multilingual)


def _merge_cms_texts(cms_text: str) -> str:
    """整合多段 CMS 文字，去除重複資訊。

    如果只有一段，直接回傳；多段時用 LLM 合併成一段精簡通知。
    """
    lines = [l.strip() for l in cms_text.strip().split("\n") if l.strip()]
    if len(lines) <= 1:
        return lines[0] if lines else cms_text

    # 多段 CMS，使用 LLM 整合
    merge_system = (
        "你是交通管制通報編輯。將以下多段交通告警合併成一段精簡通知，"
        "去除重複的路段名稱和延誤時間，保留所有關鍵資訊（封閉路段、改道建議、"
        "號誌故障、警力指揮等），80字以內。"
        "不要加任何標題前綴，直接輸出合併後的通報內容。"
    )
    merge_user = "\n".join(f"- {l}" for l in lines)

    if LLM_MODE == "bedrock":
        try:
            return _call_bedrock_merge(merge_system, merge_user)
        except Exception:
            return _mock_merge(lines)

    if LLM_MODE == "mock":
        return _mock_merge(lines)

    # Ollama
    try:
        return _call_ollama_merge(merge_system, merge_user)
    except Exception:
        return _mock_merge(lines)


def _call_bedrock_merge(system_msg: str, user_msg: str) -> str:
    """用 Bedrock 合併多段 CMS。"""
    import boto3
    client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
    response = client.converse(
        modelId=BEDROCK_MODEL_ID,
        system=[{"text": system_msg}],
        messages=[{"role": "user", "content": [{"text": user_msg}]}],
        inferenceConfig={"temperature": 0.2, "maxTokens": 200},
    )
    return response["output"]["message"]["content"][0]["text"].strip()


def _call_ollama_merge(system_msg: str, user_msg: str) -> str:
    """用 Ollama 合併多段 CMS。"""
    prompt = (
        f"<|im_start|>system\n{system_msg}<|im_end|>\n"
        f"<|im_start|>user\n{user_msg}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )
    payload = json.dumps({
        "model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.2, "num_predict": 200},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["response"].strip()


def _mock_merge(lines: list) -> str:
    """Mock 合併：用分號串接，去除明顯重複的延誤資訊。"""
    # 簡易去重：如果多段都提到同一個延誤時間，只保留最長的那個
    if len(lines) == 2:
        # 嘗試合併：取第一段完整 + 第二段去掉重複路段名
        return "；".join(lines)
    return "；".join(lines)


def _mock_translate_cms(cms_text: str) -> dict:
    """Mock CMS 翻譯"""
    return {
        "zh_tw": f"【交通管制】{cms_text}",
        "en": f"【TRAFFIC ALERT】{cms_text}",
        "ja": f"【交通規制】{cms_text}",
        "ko": f"【교통 통제】{cms_text}",
        "th": f"【ประกาศจราจร】{cms_text}",
        "vi": f"【Cảnh báo giao thông】{cms_text}",
        "fr": f"【Alerte circulation】{cms_text}",
    }
