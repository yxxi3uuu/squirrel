(() => {
  "use strict";

  const state = {
    timestamps: [],
    currentTs: null,
    selected: null, // { entityId, entityType, name, color, metricLabel }
    playTimer: null,
    showTable: false,
    lastHistory: null,
  };

  const el = {
    select: document.getElementById("timestamp-select"),
    prevBtn: document.getElementById("prev-btn"),
    nextBtn: document.getElementById("next-btn"),
    playBtn: document.getElementById("play-btn"),
    loading: document.getElementById("loading-indicator"),
    alertPanel: document.getElementById("alert-panel"),
    roadGrid: document.getElementById("road-grid"),
    stationGrid: document.getElementById("station-grid"),
    chartTitle: document.getElementById("chart-title"),
    chartEmpty: document.getElementById("chart-empty"),
    chartContainer: document.getElementById("chart-container"),
    chartTableContainer: document.getElementById("chart-table-container"),
    tableToggleBtn: document.getElementById("table-toggle-btn"),
  };

  const STATUS_META = {
    info: { label: "正常", icon: "●", cls: "status-good" },
    yellow: { label: "壅擠（B級）", icon: "▲", cls: "status-warning" },
    red: { label: "癱瘓（A級）", icon: "■", cls: "status-critical" },
  };

  function saturationLevel(score) {
    if (score === null || score === undefined) return "info";
    if (score >= 0.95) return "red";
    if (score >= 0.85) return "yellow";
    return "info";
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Request failed: ${url} (${res.status})`);
    }
    return res.json();
  }

  function setLoading(isLoading) {
    el.loading.hidden = !isLoading;
    document.querySelectorAll(".board, .alert-panel").forEach((node) => {
      node.classList.toggle("is-loading", isLoading);
    });
  }

  // ---------- init ----------

  async function init() {
    state.timestamps = await fetchJSON("/api/timestamps");
    el.select.innerHTML = "";
    for (const ts of state.timestamps) {
      const opt = document.createElement("option");
      opt.value = ts;
      opt.textContent = ts;
      el.select.appendChild(opt);
    }
    state.currentTs = state.timestamps[state.timestamps.length - 1];
    el.select.value = state.currentTs;

    el.select.addEventListener("change", () => loadDashboard(el.select.value));
    el.prevBtn.addEventListener("click", () => step(-1));
    el.nextBtn.addEventListener("click", () => step(1));
    el.playBtn.addEventListener("click", togglePlay);
    el.tableToggleBtn.addEventListener("click", toggleTableView);

    await loadDashboard(state.currentTs);
  }

  function step(direction) {
    const idx = state.timestamps.indexOf(state.currentTs);
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= state.timestamps.length) return;
    el.select.value = state.timestamps[nextIdx];
    loadDashboard(state.timestamps[nextIdx]);
  }

  function togglePlay() {
    if (state.playTimer) {
      clearInterval(state.playTimer);
      state.playTimer = null;
      el.playBtn.textContent = "▶ 自動播放";
      el.playBtn.setAttribute("aria-pressed", "false");
      return;
    }
    el.playBtn.textContent = "⏸ 停止播放";
    el.playBtn.setAttribute("aria-pressed", "true");
    state.playTimer = setInterval(() => {
      const idx = state.timestamps.indexOf(state.currentTs);
      const nextIdx = idx + 1 >= state.timestamps.length ? 0 : idx + 1;
      el.select.value = state.timestamps[nextIdx];
      loadDashboard(state.timestamps[nextIdx]);
    }, 2200);
  }

  // ---------- dashboard load ----------

  async function loadDashboard(ts) {
    setLoading(true);
    try {
      const data = await fetchJSON(`/api/dashboard?timestamp=${encodeURIComponent(ts)}`);
      state.currentTs = data.timestamp;
      renderAlertPanel(data.newly_triggered, data.summary);
      renderRoadGrid(data.snapshot.road_segments, data.triggers);
      renderStationGrid(data.snapshot.stations, data.triggers);
      if (state.selected) {
        await loadHistory(
          state.selected.entityId,
          state.selected.entityType,
          state.selected.name,
          state.selected.color,
          state.selected.metricLabel,
          false
        );
      }
    } finally {
      setLoading(false);
    }
  }

  // ---------- alert panel ----------

  function renderAlertPanel(newlyTriggered, summary) {
    el.alertPanel.innerHTML = "";
    for (const trigger of newlyTriggered) {
      const card = document.createElement("div");
      card.className = `alert-card severity-${trigger.severity || "yellow"}`;

      const icon = document.createElement("span");
      icon.className = "alert-icon";
      icon.textContent = trigger.severity === "red" ? "\u{1F6D1}" : "⚠️";
      card.appendChild(icon);

      const body = document.createElement("div");
      body.className = "alert-body";

      const title = document.createElement("span");
      title.className = "alert-title";
      title.textContent = `${trigger.sop_clause} ${trigger.clause_name} — ${trigger.entity_name}`;
      body.appendChild(title);

      const basis = document.createElement("span");
      basis.textContent = trigger.basis;
      body.appendChild(basis);

      if (trigger.actions && trigger.actions.length) {
        const actions = document.createElement("div");
        actions.className = "alert-actions";
        actions.textContent = `建議動作：${trigger.actions.join("；")}`;
        body.appendChild(actions);
      }

      card.appendChild(body);
      el.alertPanel.appendChild(card);
    }

    if (summary) {
      const summaryBox = document.createElement("div");
      summaryBox.className = "alert-summary";
      const label = document.createElement("span");
      label.className = "alert-summary-label";
      label.textContent = "LLM 趨勢異常摘要與預警提示";
      summaryBox.appendChild(label);
      const text = document.createElement("div");
      text.textContent = summary;
      summaryBox.appendChild(text);
      el.alertPanel.appendChild(summaryBox);
    }
  }

  // ---------- grids ----------

  function statusBadge(level) {
    const meta = STATUS_META[level];
    const badge = document.createElement("span");
    badge.className = `status-badge ${meta.cls}`;
    badge.textContent = `${meta.icon} ${meta.label}`;
    return badge;
  }

  function makeCard({ name, valueText, sub, badgeLevel, onSelect, entityId }) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "entity-card";
    card.dataset.entityId = entityId;
    if (state.selected && state.selected.entityId === entityId) {
      card.classList.add("selected");
    }

    const nameEl = document.createElement("div");
    nameEl.className = "entity-name";
    nameEl.textContent = name;
    card.appendChild(nameEl);

    const valueEl = document.createElement("div");
    valueEl.className = "entity-value";
    valueEl.textContent = valueText;
    card.appendChild(valueEl);

    if (badgeLevel) {
      card.appendChild(statusBadge(badgeLevel));
    }

    const subEl = document.createElement("div");
    subEl.className = "entity-sub";
    subEl.textContent = sub;
    card.appendChild(subEl);

    card.addEventListener("click", onSelect);
    return card;
  }

  function renderRoadGrid(roadSegments, triggers) {
    el.roadGrid.innerHTML = "";
    const triggeredIds = new Set(
      triggers.filter((t) => t.sop_clause === "第 1 條").map((t) => t.entity_id)
    );
    const ids = Object.keys(roadSegments).sort();
    for (const segmentId of ids) {
      const seg = roadSegments[segmentId];
      const level = saturationLevel(seg.saturation_score);
      const scoreText =
        seg.saturation_score === null || seg.saturation_score === undefined
          ? "—"
          : seg.saturation_score.toFixed(2);
      const sub = `速度 ${seg.avg_speed ?? "—"} km/h・車流 ${seg.vehicle_count ?? "—"}・${seg.lane_status ?? "—"}`;
      const card = makeCard({
        name: `${segmentId} ${seg.name}`,
        valueText: scoreText,
        sub,
        badgeLevel: level,
        entityId: segmentId,
        onSelect: () => selectEntity(segmentId, "road_segment", seg.name, "--series-road", "Saturation Score"),
      });
      if (triggeredIds.has(segmentId) && (segmentId === "RD_TPE_001" || segmentId === "RD_TPE_002")) {
        card.title = "城市應變觸發路段：達 B 級以上會額外提示長綠燈時制";
      }
      el.roadGrid.appendChild(card);
    }
  }

  function renderStationGrid(stations, triggers) {
    el.stationGrid.innerHTML = "";
    const clause3Triggered = triggers.some((t) => t.sop_clause === "第 3 條");
    const ids = Object.keys(stations).sort();
    for (const stationId of ids) {
      const st = stations[stationId];
      const isClause3 = stationId === "BS_MRT_BL17";
      const badgeLevel = isClause3 && clause3Triggered ? "yellow" : null;
      const sub = `Growth_Rate ${st.growth_rate.toFixed(2)}・漫遊 ${(st.roaming_user_pct * 100).toFixed(0)}%`;
      const card = makeCard({
        name: `${stationId} ${st.name}`,
        valueText: st.user_count.toLocaleString("zh-Hant"),
        sub,
        badgeLevel,
        entityId: stationId,
        onSelect: () => selectEntity(stationId, "station", st.name, "--series-station", "User Count"),
      });
      el.stationGrid.appendChild(card);
    }
  }

  // ---------- selection + history chart ----------

  async function selectEntity(entityId, entityType, name, colorVar, metricLabel) {
    state.selected = { entityId, entityType, name, color: colorVar, metricLabel };
    document.querySelectorAll(".entity-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.entityId === entityId);
    });
    await loadHistory(entityId, entityType, name, colorVar, metricLabel, true);
  }

  async function loadHistory(entityId, entityType, name, colorVar, metricLabel, resetTableView) {
    const data = await fetchJSON(`/api/history?entity_id=${encodeURIComponent(entityId)}`);
    state.lastHistory = data;
    if (resetTableView) state.showTable = false;

    el.chartTitle.textContent = `${name}（${entityId}） — ${metricLabel} 歷史趨勢`;
    el.chartEmpty.hidden = true;
    el.tableToggleBtn.hidden = false;
    el.tableToggleBtn.textContent = state.showTable ? "切換圖表檢視" : "切換表格檢視";

    if (state.showTable) {
      el.chartContainer.hidden = true;
      el.chartTableContainer.hidden = false;
      renderTable(el.chartTableContainer, data.points, metricLabel);
    } else {
      el.chartTableContainer.hidden = true;
      el.chartContainer.hidden = false;
      const seriesColor = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
      renderLineChart(el.chartContainer, data.points, {
        seriesColor,
        metricLabel,
        thresholds:
          entityType === "road_segment"
            ? [
                { value: 0.85, color: "var(--status-warning)", label: "B 級 0.85" },
                { value: 0.95, color: "var(--status-critical)", label: "A 級 0.95" },
              ]
            : [],
      });
    }
  }

  function toggleTableView() {
    state.showTable = !state.showTable;
    if (state.selected) {
      loadHistory(
        state.selected.entityId,
        state.selected.entityType,
        state.selected.name,
        state.selected.color,
        state.selected.metricLabel,
        false
      );
    }
  }

  function renderTable(container, points, metricLabel) {
    container.innerHTML = "";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thTs = document.createElement("th");
    thTs.textContent = "時間點";
    const thVal = document.createElement("th");
    thVal.textContent = metricLabel;
    headRow.appendChild(thTs);
    headRow.appendChild(thVal);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const point of points) {
      const row = document.createElement("tr");
      const tdTs = document.createElement("td");
      tdTs.textContent = point.timestamp;
      const tdVal = document.createElement("td");
      tdVal.className = "value-cell";
      tdVal.textContent = point.value === null || point.value === undefined ? "—" : point.value;
      row.appendChild(tdTs);
      row.appendChild(tdVal);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ---------- SVG line chart ----------

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, value);
    }
    return node;
  }

  function renderLineChart(container, rawPoints, { seriesColor, metricLabel, thresholds }) {
    container.innerHTML = "";
    const points = rawPoints.filter((p) => p.value !== null && p.value !== undefined);
    if (points.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chart-empty";
      empty.textContent = "此時間範圍內沒有資料";
      container.appendChild(empty);
      return;
    }

    const width = 800;
    const height = 260;
    const margin = { top: 16, right: 48, bottom: 28, left: 44 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const values = points.map((p) => p.value);
    const thresholdValues = (thresholds || []).map((t) => t.value);
    const domainMax = Math.max(...values, ...thresholdValues) * 1.1 || 1;
    const domainMin = Math.min(0, Math.min(...values));

    const xAt = (i) =>
      margin.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const yAt = (v) =>
      margin.top + plotH - ((v - domainMin) / (domainMax - domainMin || 1)) * plotH;

    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `${metricLabel} 歷史趨勢圖`,
    });

    // gridlines (horizontal, hairline, solid)
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const v = domainMin + ((domainMax - domainMin) * i) / gridSteps;
      const y = yAt(v);
      svg.appendChild(
        svgEl("line", {
          x1: margin.left,
          x2: width - margin.right,
          y1: y,
          y2: y,
          stroke: "var(--gridline)",
          "stroke-width": 1,
        })
      );
      const label = svgEl("text", {
        x: margin.left - 8,
        y: y + 4,
        "text-anchor": "end",
        fill: "var(--text-muted)",
        "font-size": 10,
      });
      label.textContent = formatMetricValue(v, metricLabel);
      svg.appendChild(label);
    }

    // SOP threshold reference lines
    for (const t of thresholds || []) {
      const y = yAt(t.value);
      svg.appendChild(
        svgEl("line", {
          x1: margin.left,
          x2: width - margin.right,
          y1: y,
          y2: y,
          stroke: t.color,
          "stroke-width": 1,
          "stroke-dasharray": "3,3",
          opacity: 0.7,
        })
      );
      const label = svgEl("text", {
        x: width - margin.right + 4,
        y: y + 3,
        fill: t.color,
        "font-size": 10,
        "font-weight": 600,
      });
      label.textContent = t.label;
      svg.appendChild(label);
    }

    // x-axis ticks (label every ~Nth point to avoid crowding)
    const labelEvery = Math.max(1, Math.ceil(points.length / 6));
    points.forEach((p, i) => {
      if (i % labelEvery !== 0 && i !== points.length - 1) return;
      const label = svgEl("text", {
        x: xAt(i),
        y: height - margin.bottom + 16,
        "text-anchor": "middle",
        fill: "var(--text-muted)",
        "font-size": 10,
      });
      label.textContent = p.timestamp.slice(11);
      svg.appendChild(label);
    });

    // baseline
    svg.appendChild(
      svgEl("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: margin.top + plotH,
        y2: margin.top + plotH,
        stroke: "var(--baseline)",
        "stroke-width": 1,
      })
    );

    // line path
    const pathD = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
      .join(" ");
    svg.appendChild(
      svgEl("path", {
        d: pathD,
        fill: "none",
        stroke: seriesColor,
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );

    // endpoint marker + direct value label (line chart rule: value at the end)
    const lastIdx = points.length - 1;
    const lastX = xAt(lastIdx);
    const lastY = yAt(points[lastIdx].value);
    svg.appendChild(
      svgEl("circle", {
        cx: lastX,
        cy: lastY,
        r: 5,
        fill: seriesColor,
        stroke: "var(--surface-1)",
        "stroke-width": 2,
      })
    );
    const endLabel = svgEl("text", {
      x: lastX,
      y: lastY - 12,
      "text-anchor": "end",
      fill: "var(--text-primary)",
      "font-size": 11,
      "font-weight": 600,
    });
    endLabel.textContent = formatMetricValue(points[lastIdx].value, metricLabel);
    svg.appendChild(endLabel);

    // hover layer: crosshair + hit target
    const crosshair = svgEl("line", {
      x1: margin.left,
      x2: margin.left,
      y1: margin.top,
      y2: margin.top + plotH,
      stroke: "var(--text-muted)",
      "stroke-width": 1,
      opacity: 0,
    });
    svg.appendChild(crosshair);
    const hoverDot = svgEl("circle", {
      r: 5,
      fill: seriesColor,
      stroke: "var(--surface-1)",
      "stroke-width": 2,
      opacity: 0,
    });
    svg.appendChild(hoverDot);

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    container.appendChild(tooltip);

    const hitArea = svgEl("rect", {
      x: margin.left,
      y: margin.top,
      width: plotW,
      height: plotH,
      fill: "transparent",
    });
    hitArea.style.cursor = "crosshair";

    function showAtIndex(i) {
      const p = points[i];
      crosshair.setAttribute("x1", xAt(i));
      crosshair.setAttribute("x2", xAt(i));
      crosshair.setAttribute("opacity", 1);
      hoverDot.setAttribute("cx", xAt(i));
      hoverDot.setAttribute("cy", yAt(p.value));
      hoverDot.setAttribute("opacity", 1);

      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${(xAt(i) / width) * rect.width}px`;
      tooltip.style.top = `${(yAt(p.value) / height) * rect.height}px`;
      tooltip.innerHTML = "";
      const tsLine = document.createElement("div");
      tsLine.textContent = p.timestamp;
      const valLine = document.createElement("div");
      valLine.className = "tooltip-value";
      valLine.textContent = `${metricLabel}: ${formatMetricValue(p.value, metricLabel)}`;
      tooltip.appendChild(tsLine);
      tooltip.appendChild(valLine);
      tooltip.style.opacity = 1;
    }

    function hideHover() {
      crosshair.setAttribute("opacity", 0);
      hoverDot.setAttribute("opacity", 0);
      tooltip.style.opacity = 0;
    }

    hitArea.addEventListener("pointermove", (evt) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((evt.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      let nearestDist = Infinity;
      points.forEach((_, i) => {
        const dist = Math.abs(xAt(i) - relX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      });
      showAtIndex(nearest);
    });
    hitArea.addEventListener("pointerleave", hideHover);
    svg.appendChild(hitArea);

    container.appendChild(svg);
  }

  function formatMetricValue(value, metricLabel) {
    if (metricLabel === "Saturation Score") return value.toFixed(2);
    return Math.round(value).toLocaleString("zh-Hant");
  }

  init().catch((err) => {
    console.error(err);
    el.alertPanel.textContent = "初始化失敗，請確認後端 API 是否正常啟動。";
  });
})();
