# Module 3: Interactive Strategic Advisory

Module 3 is a SOP-grounded advisory chatbot. It answers command-center what-if
questions such as:

> 若 BL17 人數增至 40,000 人，應觸發哪些法條與動作？

## Responsibility

Module 3 should:

- accept commander questions from the dashboard chat panel
- retrieve relevant SOP / legal / operational rules from `sop/` and `docs/`
- ask the LLM to answer only from retrieved context
- return a stable JSON response for the frontend

Module 3 should not depend on `data/snapshot.py` as its primary input. Snapshot
data may be added later as optional context, but what-if advisory questions must
work from user-provided assumptions and SOP context.

## Flow

```text
Dashboard chat
  -> app.py /chat
  -> module3_advisor.answer_advisory_question()
  -> module3_advisor.sop_retriever.retrieve_sop_context()
  -> llm.clients.chat()
  -> JSON response
```
