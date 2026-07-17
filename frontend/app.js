const state = {
  record: null,
};

const $ = (selector) => document.querySelector(selector);

const statusLabels = {
  recommended: "主要方案",
  backup: "備援",
  excluded: "排除",
};

const elements = {
  timestampSelect: $("#timestampSelect"),
  refreshButton: $("#refreshButton"),
  levelBadge: $("#levelBadge"),
  summaryTitle: $("#summaryTitle"),
  summaryText: $("#summaryText"),
  primaryRoute: $("#primaryRoute"),
  eteMetric: $("#eteMetric"),
  confidenceMetric: $("#confidenceMetric"),
  validationMetric: $("#validationMetric"),
  decisionId: $("#decisionId"),
  timeline: $("#timeline"),
  routeTable: $("#routeTable"),
  sopCards: $("#sopCards"),
  formulaLine: $("#formulaLine"),
  baseMinutes: $("#baseMinutes"),
  adjustMinutes: $("#adjustMinutes"),
  totalMinutes: $("#totalMinutes"),
  confidenceRing: $("#confidenceRing"),
  confidenceLabel: $("#confidenceLabel"),
  confidenceText: $("#confidenceText"),
  warningList: $("#warningList"),
  rawFacts: $("#rawFacts"),
  quickQuestions: $("#quickQuestions"),
  askForm: $("#askForm"),
  questionInput: $("#questionInput"),
  answerBox: $("#answerBox"),
  toast: $("#toast"),
};

async function loadDecision() {
  const timestamp = elements.timestampSelect.value;
  showToast("讀取決策資料");
  try {
    const response = await fetch(`/api/decisions/demo?timestamp=${encodeURIComponent(timestamp)}&event_id=TPE_2026_ACC_001`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    state.record = await response.json();
    renderDecision(state.record);
    showToast("決策資料已更新");
  } catch (error) {
    elements.summaryTitle.textContent = "讀取失敗";
    elements.summaryText.textContent = error.message;
    showToast("讀取失敗，請確認 API server");
  }
}

function renderDecision(record) {
  const recommended = record.route_candidates.find((route) => route.status === "recommended");
  elements.levelBadge.textContent = record.classification.level;
  elements.summaryTitle.textContent = `${record.snapshot.affected_road.name} ${record.event.status}`;
  elements.summaryText.textContent = record.explanation.summary;
  elements.primaryRoute.textContent = recommended ? recommended.name : "需人工接管";
  elements.eteMetric.textContent = `${Math.round(record.ete.total_minutes)} 分鐘`;
  elements.confidenceMetric.textContent = `${Math.round(record.confidence.score * 100)}%`;
  elements.validationMetric.textContent = record.validation_issues.length === 0 ? "通過" : `${record.validation_issues.length} 件`;
  elements.decisionId.textContent = record.decision_id;

  renderTimeline(record.evidence_chain);
  renderRouteTable(record.route_candidates);
  renderSopCards(record.rule_hits);
  renderEte(record.ete);
  renderConfidence(record);
  renderRawFacts(record);
  elements.answerBox.textContent = record.explanation.recommended_route_explanation;
}

function renderTimeline(steps) {
  elements.timeline.innerHTML = steps.map((step) => `
    <li>
      <span class="step-number">${step.order}</span>
      <div>
        <strong>${escapeHtml(step.title)}</strong>
        <p>${escapeHtml(step.detail)}</p>
      </div>
    </li>
  `).join("");
}

function renderRouteTable(routes) {
  elements.routeTable.innerHTML = routes.map((route) => `
    <tr>
      <td>${route.rank}</td>
      <td><strong>${escapeHtml(route.name)}</strong><br><span class="muted">${escapeHtml(route.segment_id)}</span></td>
      <td>${formatNumber(route.capacity_vph)} vph</td>
      <td>${formatDecimal(route.current_saturation)}</td>
      <td>${formatDecimal(route.predicted_saturation)}</td>
      <td><span class="status-chip status-${route.status}">${statusLabels[route.status] || route.status}</span></td>
      <td>${route.exclusion_reasons.length ? escapeHtml(route.exclusion_reasons.join("、")) : "符合採用條件"}</td>
    </tr>
  `).join("");
}

function renderSopCards(ruleHits) {
  elements.sopCards.innerHTML = ruleHits.map((hit) => `
    <article class="sop-card">
      <strong>${escapeHtml(hit.sop_id)}｜${escapeHtml(hit.title)}</strong>
      <p>${escapeHtml(hit.condition)}</p>
      <p>觀測值：${escapeHtml(JSON.stringify(hit.observed))}，結果：${escapeHtml(hit.result)}</p>
    </article>
  `).join("");
}

function renderEte(ete) {
  elements.formulaLine.textContent = ete.formula;
  elements.baseMinutes.textContent = `${Math.round(ete.base_minutes)} 分鐘`;
  elements.adjustMinutes.textContent = `${Math.round(ete.congestion_adjustment_minutes)} 分鐘`;
  elements.totalMinutes.textContent = `${Math.round(ete.total_minutes)} 分鐘`;
}

function renderConfidence(record) {
  const percent = Math.round(record.confidence.score * 100);
  elements.confidenceRing.textContent = `${percent}%`;
  elements.confidenceRing.style.setProperty("--ring-deg", `${Math.round(record.confidence.score * 360)}deg`);
  elements.confidenceLabel.textContent = `信心等級 ${record.confidence.label}`;
  elements.confidenceText.textContent = record.explanation.confidence_explanation;
  const warnings = record.explanation.warnings.length ? record.explanation.warnings : ["目前沒有驗證錯誤。"];
  elements.warningList.innerHTML = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

function renderRawFacts(record) {
  const facts = [
    ["事件", record.event.event_id],
    ["地點", record.event.location],
    ["嚴重度", record.event.severity],
    ["快照時間", record.snapshot.timestamp],
    ["受影響路段", `${record.snapshot.affected_road.segment_id} ${record.snapshot.affected_road.name}`],
    ["飽和度", record.snapshot.affected_road.saturation_score],
    ["車道狀態", record.snapshot.affected_road.lane_status],
    ["車流量", record.snapshot.affected_road.vehicle_count],
  ];
  elements.rawFacts.innerHTML = facts.map(([label, value]) => `
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(String(value ?? "--"))}</dd>
  `).join("");
}

async function ask(question) {
  const timestamp = elements.timestampSelect.value;
  elements.answerBox.textContent = "查詢中";
  try {
    const response = await fetch("/api/decisions/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp,
        event_id: "TPE_2026_ACC_001",
        question,
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    elements.answerBox.textContent = payload.answer;
  } catch (error) {
    elements.answerBox.textContent = error.message;
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 1500);
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-TW");
}

function formatDecimal(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  return Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

elements.refreshButton.addEventListener("click", loadDecision);
elements.timestampSelect.addEventListener("change", loadDecision);
elements.quickQuestions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-question]");
  if (!button) {
    return;
  }
  elements.questionInput.value = button.dataset.question;
  ask(button.dataset.question);
});
elements.askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(elements.questionInput.value);
});

loadDecision();
