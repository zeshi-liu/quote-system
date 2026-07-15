const state = {
  screen: "dashboard",
  wizardStep: 1,
  manufacturerMode: "file",
  purchaseConfirmed: false,
  quoteStatus: "草稿",
  version: 1,
  exportCount: 0,
  selectedQuoteLine: 0,
  unmatchedResolved: false,
  bulkApplied: false,
  manualRows: [
    ["党参", "党参", "", "kg", "12.00", "11.80", "11.80", ""],
    ["黄芪", "黄芪", "", "kg", "14.50", "14.20", "14.20", ""],
  ],
  purchaseRows: [
    { raw: "党参", item: "党参", spec: "", qty: "10", unit: "kg", ocr: "0.94", match: "已匹配" },
    { raw: "炙甘草片", item: "未匹配", spec: "", qty: "5", unit: "kg", ocr: "0.63", match: "未匹配" },
    { raw: "黄芪", item: "黄芪", spec: "", qty: "8", unit: "kg", ocr: "0.88", match: "别名匹配" },
    { raw: "陈皮", item: "陈皮", spec: "", qty: "", unit: "kg", ocr: "0.71", match: "已匹配" },
  ],
  quoteRows: [
    { risk: "正常", raw: "党参", item: "党参", qty: 10, unit: "kg", a: 12.0, b: 11.8, min: 11.8, history: 12.5, base: 11.8, quote: 12.9, batchA: "FQ-0704-A", batchB: "FQ-0703-B" },
    { risk: "未匹配", raw: "炙甘草片", item: "未匹配", qty: 5, unit: "kg", a: null, b: null, min: null, history: null, base: null, quote: "", batchA: "-", batchB: "-" },
    { risk: "低于基准", raw: "黄芪", item: "黄芪", qty: 8, unit: "kg", a: 14.5, b: 14.2, min: 14.2, history: 15.0, base: 14.2, quote: 13.8, batchA: "FQ-0704-A", batchB: "FQ-0703-B" },
    { risk: "数量为空", raw: "陈皮", item: "陈皮", qty: "", unit: "kg", a: 9.8, b: null, min: 9.8, history: 10.5, base: 9.8, quote: 10.8, batchA: "FQ-0704-A", batchB: "-" },
    { risk: "无厂家价", raw: "麦冬", item: "麦冬", qty: 6, unit: "kg", a: null, b: null, min: null, history: 18.0, base: null, quote: 19.5, batchA: "-", batchB: "-" },
  ],
};

const screenNames = new Set(["dashboard", "manufacturer", "purchase", "quotes", "workbench", "preview", "hospitals", "masters"]);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function money(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(2);
}

function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
}

function showScreen(screen, options = {}) {
  const { updateHash = true } = options;
  if (!screenNames.has(screen)) return;
  state.screen = screen;
  $$(".screen").forEach((el) => el.classList.toggle("active", el.id === `screen-${screen}`));
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.screen === screen));
  if (screen === "workbench") renderQuoteTable();
  if (screen === "preview") renderPreview();
  if (updateHash && window.location.hash !== `#${screen}`) {
    window.history.replaceState(null, "", `#${screen}`);
  }
}

function routeToScreen(route) {
  if (screenNames.has(route)) return route;
  if (route === "manufacturer-manual") return "manufacturer";
  return "";
}

function applyRoute(route) {
  const screen = routeToScreen(route);
  if (!screen) return false;
  showApp();
  showScreen(screen, { updateHash: false });
  if (route === "manufacturer-manual") {
    setManufacturerMode("manual");
    setWizardStep(2);
  }
  return true;
}

function renderManualRows() {
  const body = $("#manualQuoteTable tbody");
  if (!body) return;
  body.innerHTML = state.manualRows
    .map(
      (row) => `<tr>${row.map((cell) => `<td><input value="${cell}" /></td>`).join("")}</tr>`
    )
    .join("");
}

function renderPurchaseRows() {
  const body = $("#purchaseTable tbody");
  if (!body) return;
  body.innerHTML = state.purchaseRows
    .map((row, index) => {
      const lowOcr = Number(row.ocr) < 0.8;
      const unmatched = row.match === "未匹配";
      return `
        <tr class="${unmatched ? "row-risk" : ""}">
          <td><input value="${row.raw}" /></td>
          <td><input value="${row.item}" /></td>
          <td><input value="${row.spec}" /></td>
          <td><input value="${row.qty}" /></td>
          <td><input value="${row.unit}" /></td>
          <td><span class="badge ${lowOcr ? "warning" : "ok"}">${row.ocr}</span></td>
          <td><span class="badge ${unmatched ? "danger" : "ok"}">${row.match}</span></td>
          <td><button class="text-btn" data-purchase-row="${index}">删除</button></td>
        </tr>
      `;
    })
    .join("");
}

function riskBadge(row) {
  if (state.unmatchedResolved && row.risk === "未匹配") return `<span class="badge ok">已处理</span>`;
  if (row.risk === "正常") return `<span class="badge ok">正常</span>`;
  if (row.risk === "低于基准" || row.risk === "未匹配") return `<span class="badge danger">${row.risk}</span>`;
  return `<span class="badge warning">${row.risk}</span>`;
}

function renderQuoteTable() {
  const body = $("#quoteTable tbody");
  if (!body) return;
  body.innerHTML = state.quoteRows
    .map((row, index) => {
      const priceValue = row.quote === "" ? "" : money(row.quote);
      const markup = row.base && row.quote ? `${(((row.quote - row.base) / row.base) * 100).toFixed(1)}%` : "-";
      return `
        <tr class="${row.risk !== "正常" ? "row-risk" : ""}" data-quote-row="${index}">
          <td>${riskBadge(row)}</td>
          <td>${row.raw}</td>
          <td>${state.unmatchedResolved && row.risk === "未匹配" ? "炙甘草" : row.item}</td>
          <td>${row.qty || "-"}</td>
          <td>${row.unit}</td>
          <td>${money(row.a)}<br><small>${row.batchA}</small></td>
          <td>${money(row.b)}<br><small>${row.batchB}</small></td>
          <td>${money(row.min)}</td>
          <td>${money(row.history)}</td>
          <td>${row.history ? money(row.history + 0.4) : "-"}</td>
          <td>${money(row.base)}</td>
          <td><input data-price-index="${index}" value="${priceValue}" /></td>
          <td>${markup}</td>
          <td><button class="text-btn" data-select-row="${index}">详情</button></td>
        </tr>
      `;
    })
    .join("");
  renderReferencePanel();
  updateRiskSummary();
}

function renderReferencePanel() {
  const row = state.quoteRows[state.selectedQuoteLine] || state.quoteRows[0];
  const active = $(".tabs button.selected")?.dataset.refTab || "factory";
  const content = $("#referenceContent");
  if (!content) return;
  if (active === "factory") {
    content.innerHTML = `
      <div class="info-card"><strong>厂家 A</strong><br>批次 ${row.batchA}<br>生效 2026-07-04 09:00<br>厂家价 ${money(row.a)} · 含税含抽点</div>
      <div class="info-card"><strong>厂家 B</strong><br>批次 ${row.batchB}<br>生效 2026-07-03 18:30<br>厂家价 ${money(row.b)} · 含税含抽点</div>
    `;
  } else if (active === "history") {
    content.innerHTML = `
      <div class="info-card">2026-06-20 · V1 · ${money(row.history || 0)} · 已确认</div>
      <div class="info-card">2026-05-12 · V2 · ${row.history ? money(row.history + 0.8) : "-"} · 已发送</div>
      <div class="info-card">暂无更多同规格历史记录</div>
    `;
  } else if (active === "log") {
    content.innerHTML = `
      <div class="info-card">王销售 · 09:42<br>本次报价从 ${money(row.base)} 调整到 ${money(row.quote)}。</div>
      <div class="info-card">系统 · 09:36<br>按最新厂家最低价生成建议基准价。</div>
    `;
  } else {
    content.innerHTML = `
      <div class="info-card">原始品名：${row.raw}<br>标准品名：${row.item}<br>匹配方式：${row.risk === "未匹配" ? "未匹配" : "标准名/别名匹配"}</div>
      <button class="secondary" data-action="resolveUnmatched">加入别名库并处理未匹配</button>
    `;
  }
}

function updateRiskSummary() {
  const unresolvedUnmatched = state.unmatchedResolved ? 0 : 1;
  const text = `未匹配 ${unresolvedUnmatched} / 无厂家价 1 / 低于基准价 1 / 数量为空 1`;
  $("#riskSummary") && ($("#riskSummary").textContent = text);
  $("#previewRisk") && ($("#previewRisk").textContent = text);
}

function renderPreview() {
  const body = $("#previewTable tbody");
  if (!body) return;
  body.innerHTML = state.quoteRows
    .map((row, index) => {
      const name = state.unmatchedResolved && row.risk === "未匹配" ? "炙甘草" : row.item;
      const amount = row.qty && row.quote ? Number(row.qty) * Number(row.quote) : "";
      return `
        <tr>
          <td>${index + 1}</td><td>${name}</td><td>${row.spec || ""}</td><td>${row.qty || ""}</td><td>${row.unit}</td><td>${money(row.quote)}</td><td>${money(amount)}</td><td>${row.risk === "无厂家价" ? "手工报价" : ""}</td>
        </tr>
      `;
    })
    .join("");
  $("#previewVersion").textContent = `V${state.version}`;
  $("#previewStatus").textContent = state.quoteStatus;
  $("#exportRecord").textContent = state.exportCount ? `已导出 ${state.exportCount} 次` : "暂无导出";
  updateRiskSummary();
}

function setWizardStep(step) {
  state.wizardStep = Math.max(1, Math.min(4, step));
  $$(".wizard-step").forEach((el) => el.classList.toggle("active", Number(el.dataset.step) === state.wizardStep));
  $$(".step").forEach((el) => el.classList.toggle("active", Number(el.dataset.stepLabel) === state.wizardStep));
}

function setManufacturerMode(mode) {
  state.manufacturerMode = mode;
  $$("[data-mode]").forEach((btn) => btn.classList.toggle("selected", btn.dataset.mode === mode));
  $(".file-mode")?.classList.toggle("hidden", mode !== "file");
  $(".manual-mode")?.classList.toggle("hidden", mode !== "manual");
}

function showModal(html) {
  $("#modalContent").innerHTML = html;
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

function showBatchConfirm() {
  showModal(`
    <h3>创建新的厂家报价批次</h3>
    <p>厂家：厂家 A<br>批次日期：2026-07-04<br>生效时间：2026-07-04 09:00<br>来源：${state.manufacturerMode === "file" ? "文件导入" : "手动录入"}</p>
    <div class="notice info">新批次不会覆盖旧批次，历史所有批次均可追溯。系统查询“厂家最新价”时按生效时间、批次日期、创建时间取最新有效批次。</div>
    <div class="modal-actions">
      <button class="secondary" data-action="closeModal">取消</button>
      <button class="primary" data-action="confirmBatch">确认创建新批次</button>
    </div>
  `);
}

function showBulkMarkup() {
  showModal(`
    <h3>批量加价预览</h3>
    <p>影响行数：3<br>跳过行数：2（无厂家价 1，未匹配 1）<br>平均涨幅：10.0%<br>预计总金额变化：+ 1,032.00</p>
    <div class="modal-actions">
      <button class="secondary" data-action="closeModal">取消</button>
      <button class="primary" data-action="applyBulk">确认应用</button>
    </div>
  `);
}

function showExportRisk() {
  const blocking = state.unmatchedResolved ? 0 : 1;
  const canExport = blocking === 0;
  showModal(`
    <h3>导出前风险检查</h3>
    ${blocking ? `<div class="notice warning">阻断项：未匹配品类 ${blocking} 行。请先处理后再导出。</div>` : ""}
    <div class="notice ${canExport ? "info" : "warning"}">
      需确认项：无厂家价但已手工报价 1 行；低于建议基准价 1 行；数量为空 1 行。
    </div>
    <div class="modal-actions">
      <button class="secondary" data-action="closeModal">返回处理</button>
      <button class="primary" ${canExport ? "" : "disabled"} data-action="confirmExport">确认导出 Excel</button>
    </div>
  `);
}

function showNewVersion() {
  showModal(`
    <h3>创建报价单新版本</h3>
    <p>当前版本：V${state.version}<br>新版本：V${state.version + 1}</p>
    <label>修改原因<textarea id="revisionReason" rows="4">医院反馈部分品类价格偏高，需要调整报价。</textarea></label>
    <div class="notice info">新版本会继承当前报价明细，旧版本保留为历史版本。</div>
    <div class="modal-actions">
      <button class="secondary" data-action="closeModal">取消</button>
      <button class="primary" data-action="confirmNewVersion">创建并编辑</button>
    </div>
  `);
}

function handleAction(action) {
  if (action === "login") {
    showApp();
    showScreen("dashboard");
  }
  if (action === "wizardNext") setWizardStep(state.wizardStep + 1);
  if (action === "wizardPrev") setWizardStep(state.wizardStep - 1);
  if (action === "restartManufacturerWizard") {
    setWizardStep(1);
    showScreen("manufacturer");
  }
  if (action === "addManufacturerRow") {
    state.manualRows.push(["麦冬", "麦冬", "", "kg", "", "", "", ""]);
    renderManualRows();
  }
  if (action === "pasteManufacturerRows") {
    state.manualRows.push(["陈皮", "陈皮", "", "kg", "9.80", "9.80", "9.80", "批量粘贴"]);
    state.manualRows.push(["麦冬", "麦冬", "", "kg", "18.20", "18.20", "18.20", "批量粘贴"]);
    renderManualRows();
  }
  if (action === "showBatchConfirm") showBatchConfirm();
  if (action === "confirmBatch") {
    closeModal();
    setWizardStep(4);
  }
  if (action === "savePurchase") {
    $("#purchaseStatus").textContent = "草稿已保存";
    $("#purchaseStatus").className = "badge info";
  }
  if (action === "confirmPurchase") {
    state.purchaseConfirmed = true;
    $("#purchaseStatus").textContent = "已确认";
    $("#purchaseStatus").className = "badge ok";
  }
  if (action === "createQuoteFromPurchase") {
    state.purchaseConfirmed = true;
    showScreen("workbench");
  }
  if (action === "saveQuote") {
    showModal(`
      <h3>草稿已保存</h3>
      <p>报价单 BJ-20260704-HOSP01-001 · V${state.version} 已保存，未改变当前报价状态。</p>
      <div class="modal-actions">
        <button class="primary" data-action="closeModal">知道了</button>
      </div>
    `);
  }
  if (action === "showBulkMarkup") showBulkMarkup();
  if (action === "applyBulk") {
    state.quoteRows.forEach((row) => {
      if (row.base && row.risk !== "未匹配") row.quote = Number((row.base * 1.1).toFixed(2));
    });
    state.bulkApplied = true;
    $("#undoBulk").classList.remove("hidden");
    closeModal();
    renderQuoteTable();
  }
  if (action === "undoBulk") {
    state.quoteRows[0].quote = 12.9;
    state.quoteRows[2].quote = 13.8;
    state.quoteRows[3].quote = 10.8;
    state.bulkApplied = false;
    $("#undoBulk").classList.add("hidden");
    renderQuoteTable();
  }
  if (action === "resolveUnmatched") {
    state.unmatchedResolved = true;
    renderPurchaseRows();
    renderQuoteTable();
    renderPreview();
  }
  if (action === "showExportRisk") showExportRisk();
  if (action === "confirmExport") {
    state.exportCount += 1;
    state.quoteStatus = "已导出";
    updateQuoteStatus();
    closeModal();
    showScreen("preview");
  }
  if (action === "markSent") {
    state.quoteStatus = "已发送";
    updateQuoteStatus();
  }
  if (action === "markConfirmed") {
    state.quoteStatus = "已确认";
    updateQuoteStatus();
  }
  if (action === "showNewVersion") showNewVersion();
  if (action === "confirmNewVersion") {
    state.version += 1;
    state.quoteStatus = "草稿";
    updateQuoteStatus();
    closeModal();
    showScreen("workbench");
  }
  if (action === "closeModal") closeModal();
}

function updateQuoteStatus() {
  const labels = ["quoteStatus", "quoteListStatus"];
  labels.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = state.quoteStatus;
    el.className = `badge ${state.quoteStatus === "已确认" ? "ok" : state.quoteStatus === "已发送" ? "info" : "warning"}`;
  });
  $("#versionLabel") && ($("#versionLabel").textContent = `V${state.version}`);
  renderPreview();
}

document.addEventListener("click", (event) => {
  const screenButton = event.target.closest("[data-screen]");
  if (screenButton) {
    showScreen(screenButton.dataset.screen);
    return;
  }

  const modeButton = event.target.closest("[data-mode]");
  if (modeButton) {
    setManufacturerMode(modeButton.dataset.mode);
    return;
  }

  const refButton = event.target.closest("[data-ref-tab]");
  if (refButton) {
    $$("[data-ref-tab]").forEach((btn) => btn.classList.toggle("selected", btn === refButton));
    renderReferencePanel();
    return;
  }

  const selectRow = event.target.closest("[data-select-row]");
  if (selectRow) {
    state.selectedQuoteLine = Number(selectRow.dataset.selectRow);
    renderReferencePanel();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    handleAction(actionButton.dataset.action);
  }
});

document.addEventListener("input", (event) => {
  const priceInput = event.target.closest("[data-price-index]");
  if (!priceInput) return;
  const index = Number(priceInput.dataset.priceIndex);
  const value = Number(priceInput.value);
  state.quoteRows[index].quote = Number.isFinite(value) ? value : "";
  renderQuoteTable();
});

renderManualRows();
renderPurchaseRows();
renderQuoteTable();
renderPreview();

const initialRoute = window.location.hash.replace("#", "");
if (initialRoute) {
  applyRoute(initialRoute);
} else {
  showScreen("dashboard", { updateHash: false });
}

window.addEventListener("hashchange", () => {
  applyRoute(window.location.hash.replace("#", ""));
});
