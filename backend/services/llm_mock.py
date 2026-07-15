"""
LLM Mock 文字生成 + Prompt 模板

雛型階段：直接用格式化字串輸出 cms_text 與 commander_brief，
不呼叫任何外部 API，確保 demo 穩定。

接 Claude / OpenAI API 時，把 generate_text() 的實作換掉，
保持呼叫介面不變即可。

Prompt 模板（參考規格書第7節）：
  System: 限制 LLM 只做措辭轉換，不重新判斷 SOP 數字與條款
  User:   傳入單一 TriggerDecision 的 JSON
  Output: {"cms_text": "...", "commander_brief": "..."}
"""

import json
from typing import Dict

from shared.schemas import TriggerDecision

SYSTEM_PROMPT = """你是台北市交通應變指揮中心的AI幕僚。
以下所有數字與結論都已經由程式規則運算完成（見TriggerDecision物件），
你的工作只是把結構化資料轉換成人類看得懂的文字，
不要自己重新判斷或修改任何SOP條款或數字。

輸出兩段文字：
1. cms_text：給電子看板/簡訊用，40字以內，只講事故地點、改道建議、預計延誤分鐘數
2. commander_brief：給交通指揮官看的簡短說明，可以引用SOP條款編號，100字以內

請只輸出 JSON，不要有其他文字：{"cms_text": "...", "commander_brief": "..."}"""


def generate_text(decision: TriggerDecision) -> Dict[str, str]:
    """
    目前為 mock 實作，直接從 TriggerDecision 欄位組合文字。
    替換為 LLM API 呼叫時，修改此函式即可。
    """
    if not decision.triggered:
        return {
            "cms_text": decision.cms_text or "",
            "commander_brief": (
                f"[{decision.sop_clause or '無觸發'}] "
                f"{decision.basis[:80]}"
            ),
        }

    cms = decision.cms_text or f"{decision.entity_name} 發生事故，請注意行車安全"
    clause = decision.sop_clause or "未知條款"
    brief_parts = [f"【{clause}】{decision.clause_name}"]
    if decision.ete_minutes is not None:
        brief_parts.append(f"預計 {decision.ete_minutes} 分鐘恢復")
    if decision.primary_route:
        brief_parts.append(f"主疏散：{decision.primary_route}")
    brief_parts.append(decision.basis[:60] + "...")

    return {
        "cms_text": cms,
        "commander_brief": " | ".join(brief_parts),
    }


def build_llm_user_prompt(decision: TriggerDecision) -> str:
    """
    產生送給 LLM 的 User 部分 prompt（供未來接入真實 LLM 使用）。
    """
    return f"TriggerDecision：{decision.model_dump_json(indent=2)}"
