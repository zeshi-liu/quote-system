const orderLines = [
  { id: "l1", raw: "党参", name: "党参", spec: "选货", qty: "10.00", unit: "kg", matched: true },
  { id: "l2", raw: "黄芪", name: "黄芪", spec: "统片", qty: "8.00", unit: "kg", matched: true },
  { id: "l3", raw: "炙甘草片", name: "炙甘草", spec: "炙甘草", qty: "5.00", unit: "kg", matched: true },
  { id: "l4", raw: "陈皮", name: "陈皮", spec: "丝", qty: "6.00", unit: "kg", matched: true },
];

const state = {
  role: "sales",
  screen: "sales-dashboard",
  stack: [],
  selectedSupplierSlot: "B",
  selectedProductId: "p1",
  productQuery: "",
  quoteActivated: false,
  quote: {
    version: 1,
    status: "draft",
    exportedFormats: [],
    sentAt: "",
    confirmedAt: "",
    lines: [],
  },
  draftSource: "image",
  draftImported: false,
  draftLines: [
    { id: "d1", raw: "白芍", name: "白芍", spec: "切片", qty: "12.00", unit: "kg" },
    { id: "d2", raw: "麦冬", name: "麦冬", spec: "统", qty: "4.00", unit: "kg" },
  ],
  hospitalSource: "image",
  hospitalImported: false,
  hospitalDraftLines: [
    { id: "h1", raw: "党参", name: "党参", spec: "选货", qty: "5.00", unit: "kg" },
  ],
  hospitalOrders: [
    { id: "CG-20260716-000112", source: "sales", status: "报价处理中", date: "07-16", count: 4 },
    { id: "CG-20260712-000086", source: "hospital", status: "已完成", date: "07-12", count: 7 },
  ],
  selectedHospitalOrder: "CG-20260716-000112",
  supplierTasks: {
    A: {
      name: "瑞康饮片有限公司",
      status: "submitted",
      linkVersion: 1,
      submissionNo: 1,
      expires: "07-18 10:20",
      quotes: {
        l1: { status: "quoted", price: 11.8, remark: "" },
        l2: { status: "quoted", price: 14.2, remark: "" },
        l3: { status: "unavailable", price: null, remark: "暂时无货" },
        l4: { status: "quoted", price: 9.8, remark: "" },
      },
      draft: {},
      history: [],
    },
    B: {
      name: "本草源饮片有限公司",
      status: "waiting_quote",
      linkVersion: 1,
      submissionNo: 0,
      expires: "07-18 10:22",
      quotes: {},
      draft: {},
      history: [],
    },
  },
};

const products = [
  { id: "p1", name: "党参", aliases: "潞党参、台党参", variants: ["选货 · 甘肃 · kg", "统货 · 甘肃 · kg"] },
  { id: "p2", name: "黄芪", aliases: "绵黄芪、北芪", variants: ["统片 · 甘肃 · kg", "选片 · 内蒙古 · kg"] },
  { id: "p3", name: "炙甘草", aliases: "炙草、蜜甘草", variants: ["炙甘草 · 内蒙古 · kg"] },
  { id: "p4", name: "陈皮", aliases: "广陈皮", variants: ["丝 · 广东 · kg", "块 · 广东 · kg"] },
  { id: "p5", name: "麦冬", aliases: "川麦冬、杭麦冬", variants: ["统 · 四川 · kg"] },
];

const sourceBatches = [
  { no: "PL-20260701-RKYP-001", sourceNo: "RK-0701", manufacturer: "瑞康饮片有限公司", date: "2026-07-01", type: "Excel", rows: 982 },
  { no: "PL-20260618-BCY-001", sourceNo: "BCY-0618", manufacturer: "本草源饮片有限公司", date: "2026-06-18", type: "手工", rows: 518 },
  { no: "PL-20260520-RKYP-001", sourceNo: "RK-0520", manufacturer: "瑞康饮片有限公司", date: "2026-05-20", type: "Excel", rows: 964 },
];

const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modalContent");
const toast = document.querySelector("#toast");
let toastTimer;

function money(value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function showModal(html) {
  modalContent.innerHTML = html;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}

function navigate(screen, options = {}) {
  if (screen === "pricing" && state.quoteActivated && state.quote.status !== "draft") {
    state.screen = "quote-preview";
    showToast(`V${state.quote.version} 已冻结，请创建新版本后修改`);
    render();
    return;
  }
  if (!options.replace && state.screen !== screen) state.stack.push(state.screen);
  state.screen = screen;
  window.history.replaceState(null, "", `#${screen}`);
  render();
}

function goBack() {
  let target = state.stack.pop() || defaultScreen(state.role);
  if (target === "pricing" && state.quote.status !== "draft") target = "sales-quotes";
  state.screen = target;
  window.history.replaceState(null, "", `#${state.screen}`);
  render();
}

function defaultScreen(role) {
  if (role === "hospital") return "hospital-home";
  if (role === "supplier") return "supplier-form";
  return "sales-dashboard";
}

function setRole(role, slot = "B") {
  state.role = role;
  state.stack = [];
  if (role === "supplier") state.selectedSupplierSlot = slot;
  state.screen = defaultScreen(role);
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.classList.toggle("active", button.dataset.role === role);
  });
  window.history.replaceState(null, "", `#${state.screen}`);
  render();
}

function appHeader(title, options = {}) {
  const back = options.back
    ? '<button class="header-button back" data-action="back" aria-label="返回">‹</button>'
    : "";
  const action = options.action
    ? `<button class="header-button" data-action="${options.action.name}">${options.action.label}</button>`
    : options.actionHtml || "";
  return `
    <header class="app-header">
      <div class="header-side">${back}</div>
      <h1>${title}</h1>
      <div class="header-side end">${action}</div>
    </header>
  `;
}

function salesTabs(active) {
  const tabs = [
    ["sales-dashboard", "工", "工作台"],
    ["sales-orders", "单", "采购单"],
    ["sales-quotes", "价", "报价单"],
    ["products", "库", "商品库"],
  ];
  return `<nav class="bottom-tabs">${tabs
    .map(
      ([screen, icon, label]) => `
        <button class="tab-button ${active === screen ? "active" : ""}" data-screen="${screen}">
          <span class="tab-icon">${icon}</span><span>${label}</span>
        </button>`
    )
    .join("")}</nav>`;
}

function hospitalTabs(active) {
  const tabs = [
    ["hospital-home", "首", "首页"],
    ["hospital-orders", "单", "采购单"],
    ["hospital-profile", "我", "我的"],
  ];
  return `<nav class="bottom-tabs">${tabs
    .map(
      ([screen, icon, label]) => `
        <button class="tab-button ${active === screen ? "active" : ""}" data-screen="${screen}">
          <span class="tab-icon">${icon}</span><span>${label}</span>
        </button>`
    )
    .join("")}</nav>`;
}

function shell({ title, body, back = false, tabs = "", action, noTabs = false }) {
  return `
    <div class="miniapp ${noTabs || !tabs ? "no-tabs" : ""}">
      ${appHeader(title, { back, action })}
      <main class="page-scroll">${body}</main>
      ${tabs}
    </div>
  `;
}

function statusBadge(status) {
  const map = {
    submitted: ["已报价", "ok"],
    waiting_quote: ["待报价", "warning"],
    requote_pending: ["重新报价中", "danger"],
    cancelled: ["已取消", ""],
    draft: ["草稿", "warning"],
    exported: ["已导出", "info"],
    sent: ["已发送", "info"],
    confirmed: ["已确认", "ok"],
  };
  const [label, tone] = map[status] || [status, ""];
  return `<span class="badge ${tone}">${label}</span>`;
}

function renderSalesDashboard() {
  const waiting = Object.values(state.supplierTasks).filter((task) => task.status !== "submitted").length;
  return shell({
    title: "工作台",
    tabs: salesTabs("sales-dashboard"),
    action: { name: "sales-profile", label: "王销售" },
    body: `
      <button class="hero-action full" data-screen="sales-new-order">
        <span><h2>新建采购单</h2><p>拍照、Excel、商品库或自定义录入</p></span>
        <span class="hero-plus">＋</span>
      </button>

      <div class="metric-grid">
        <button class="metric" data-screen="sales-new-order"><span>待校对</span><strong>2</strong><small>今日新增</small></button>
        <button class="metric" data-screen="inquiry"><span>厂家报价中</span><strong>${waiting}</strong><small>含重新报价</small></button>
        <button class="metric" data-screen="inquiry"><span>可计价</span><strong>1</strong><small>至少一家已报</small></button>
      </div>

      <div class="section-title"><h3>待处理</h3><button class="text-button" data-screen="sales-orders">全部采购单</button></div>
      <div class="task-list">
        <button class="task-card" data-screen="inquiry">
          <span class="task-marker amber"></span>
          <span><strong>市中医院 · 可提前计价</strong><small>厂家 A 已报价，厂家 B 待报价</small></span>
          <span class="chevron">›</span>
        </button>
        <button class="task-card" data-screen="sales-new-order">
          <span class="task-marker red"></span>
          <span><strong>市二院 · 采购单待校对</strong><small>销售代录 · 图片解析 2 行</small></span>
          <span class="chevron">›</span>
        </button>
        <button class="task-card" data-screen="${state.quoteActivated ? "pricing" : "inquiry"}">
          <span class="task-marker"></span>
          <span><strong>${state.quoteActivated ? `BJ-20260716-HOSP01-001 · V${state.quote.version}` : "市中医院 · 等待进入计价"}</strong><small>${state.quoteActivated ? `当前状态：${statusBadge(state.quote.status)}` : "本次厂家报价是唯一计价来源"}</small></span>
          <span class="chevron">›</span>
        </button>
      </div>

      <div class="section-title"><h3>资料入口</h3><small>低频维护</small></div>
      <div class="surface">
        <div class="button-row">
          <button class="secondary" data-screen="products">查询商品库</button>
          <button class="secondary" data-screen="source-batches">厂家来源批次</button>
        </div>
        <div class="notice">来源批次价格仅供商品资料查询，不参与本次最低价、基准价或推荐价计算。</div>
      </div>
    `,
  });
}

function renderSalesOrders() {
  return shell({
    title: "采购单",
    tabs: salesTabs("sales-orders"),
    action: { name: "new-sales-order", label: "新建" },
    body: `
      <div class="search-bar"><span class="search-symbol">⌕</span><input placeholder="搜索医院或采购单号" /></div>
      <div class="tag-row"><span class="tag ok">全部 12</span><span class="tag">待校对 2</span><span class="tag">报价中 3</span><span class="tag">已完成 7</span></div>
      <div class="section-title"><h3>最近采购单</h3></div>
      <div class="order-list">
        <button class="order-card" data-screen="inquiry"><span class="task-marker amber"></span><span><strong>市中医院</strong><small>CG-20260716-000108 · 4 个品类 · 医院提交</small></span><span class="badge warning">厂家报价中</span></button>
        <button class="order-card" data-screen="sales-new-order"><span class="task-marker red"></span><span><strong>市二院</strong><small>CG-20260716-000116 · 2 个品类 · 销售代录</small></span><span class="badge danger">待校对</span></button>
        <button class="order-card"><span class="task-marker"></span><span><strong>县人民医院</strong><small>CG-20260715-000094 · 9 个品类 · 医院提交</small></span><span class="badge ok">已完成</span></button>
      </div>
    `,
  });
}

function sourceOptions(selected, prefix) {
  const options = [
    ["image", "图片", "拍照或相册"],
    ["excel", "Excel", "上传采购表"],
    ["product", "商品库", "搜索点选"],
    ["custom", "自定义", "手动新增"],
  ];
  return `<div class="source-grid">${options
    .map(
      ([value, title, note]) => `<button class="source-option ${selected === value ? "selected" : ""}" data-action="choose-source" data-source="${value}" data-prefix="${prefix}"><strong>${title}</strong><small>${note}</small></button>`
    )
    .join("")}</div>`;
}

function editableLines(lines, kind) {
  return `<div class="line-editor">${lines
    .map(
      (line, index) => `
        <div class="line-item">
          <div class="line-item-head"><span><strong>${index + 1}. ${escapeHtml(line.name || line.raw)}</strong><small>${line.spec ? escapeHtml(line.spec) : "规格未填写"}</small></span><button class="text-button" data-action="delete-draft-line" data-kind="${kind}" data-line-id="${line.id}">删除</button></div>
          <div class="line-fields">
            <input aria-label="品名" data-draft-kind="${kind}" data-line-id="${line.id}" data-field="name" value="${escapeHtml(line.name)}" />
            <input aria-label="数量" inputmode="decimal" data-draft-kind="${kind}" data-line-id="${line.id}" data-field="qty" value="${escapeHtml(line.qty)}" />
            <select aria-label="单位" data-draft-kind="${kind}" data-line-id="${line.id}" data-field="unit"><option ${line.unit === "kg" ? "selected" : ""}>kg</option><option ${line.unit === "g" ? "selected" : ""}>g</option><option ${line.unit === "袋" ? "selected" : ""}>袋</option></select>
          </div>
        </div>`
    )
    .join("")}</div>`;
}

function renderSalesNewOrder() {
  const sourceCopy = state.draftSource === "image" ? "选择图片并模拟 OCR" : state.draftSource === "excel" ? "选择 Excel 并解析" : state.draftSource === "product" ? "从商品库加入白芍" : "新增自定义品类";
  return shell({
    title: "新建采购单",
    back: true,
    noTabs: true,
    body: `
      <div class="tag-row"><span class="tag info">销售代录</span><span class="tag">草稿</span></div>
      <div class="section-title"><h3>医院与采购员</h3></div>
      <div class="form-section field-grid">
        <label class="field"><span>医院</span><select><option>市二院</option><option>市中医院</option></select></label>
        <label class="field"><span>采购员</span><select><option>陈老师</option><option>李主任</option></select></label>
      </div>

      <div class="section-title"><h3>录入方式</h3><small>可组合使用</small></div>
      ${sourceOptions(state.draftSource, "sales")}
      <button class="secondary full" style="margin-top:8px" data-action="simulate-import" data-kind="sales">${sourceCopy}</button>
      ${state.draftImported ? '<div class="notice ok">解析完成：识别 2 行，单位缺失已默认填入 kg。</div>' : ""}

      <div class="section-title"><h3>采购明细</h3><button class="text-button" data-action="add-draft-line" data-kind="sales">＋ 自定义</button></div>
      ${editableLines(state.draftLines, "sales")}

      <div class="bottom-action">
        <button class="secondary" data-action="save-draft">保存草稿</button>
        <button class="primary" data-action="freeze-draft">确认并冻结</button>
      </div>
    `,
  });
}

function taskStatusText(task) {
  if (task.status === "submitted") return `第 ${task.submissionNo} 次提交 · 全部 ${orderLines.length} 行已完成`;
  if (task.status === "requote_pending") return `旧报价已退出计算 · 链接 v${task.linkVersion}`;
  return `链接 v${task.linkVersion} · ${task.expires} 到期`;
}

function manufacturerSlot(slot) {
  const task = state.supplierTasks[slot];
  const submitted = task.status === "submitted";
  return `
    <div class="manufacturer-slot">
      <div class="slot-head">
        <div class="slot-title"><span class="slot-letter">${slot}</span><span><strong>${task.name}</strong><small>${taskStatusText(task)}</small></span></div>
        ${statusBadge(task.status)}
      </div>
      <div class="slot-meta"><span>有效期 48 小时</span><span>含税、含抽点</span></div>
      <div class="button-row">
        <button class="secondary" data-action="copy-link" data-slot="${slot}">复制链接</button>
        <button class="secondary" data-action="open-supplier" data-slot="${slot}">${submitted ? "查看本次提交" : "打开 H5"}</button>
        <button class="${submitted ? "danger-button" : "secondary"}" data-action="regenerate-link" data-slot="${slot}">${submitted ? "重新报价" : "重新生成"}</button>
      </div>
    </div>
  `;
}

function submittedTaskCount() {
  return Object.values(state.supplierTasks).filter((task) => task.status === "submitted").length;
}

function renderInquiry() {
  const submitted = submittedTaskCount();
  const enterLabel = submitted === 1 ? "提前进入计价" : submitted === 2 ? "进入计价" : "等待厂家报价";
  return shell({
    title: "本次厂家询价",
    back: true,
    noTabs: true,
    action: { name: "inquiry-history", label: "记录" },
    body: `
      <div class="progress-steps"><span class="progress-step done"></span><span class="progress-step active"></span><span class="progress-step"></span><span class="progress-step"></span></div>
      <div class="page-intro"><div><h2>市中医院采购单</h2><p>CG-20260716-000108 · 4 个品类 · 医院提交</p></div><span class="badge warning">厂家报价中</span></div>
      <div class="surface">
        <div class="tag-row"><span class="tag ok">采购单已冻结</span><span class="tag">数量/单位已确认</span></div>
        <button class="text-button" data-action="show-order-lines">查看冻结明细</button>
      </div>

      <div class="section-title"><h3>厂家 A / B</h3><small>${submitted}/2 已完整提交</small></div>
      <div class="task-list">${manufacturerSlot("A")}${manufacturerSlot("B")}</div>

      ${submitted === 1 ? '<div class="notice warning">另一厂家尚未提交。销售员可以二次确认后提前进入计价，未报价任务仍继续运行。</div>' : ""}
      ${submitted === 0 ? '<div class="notice danger">当前没有有效完整提交，不能进入计价。</div>' : ""}

      <div class="bottom-action single">
        <button class="primary" data-action="enter-pricing" ${submitted === 0 ? "disabled" : ""}>${enterLabel}</button>
      </div>
    `,
  });
}

function getValidQuote(slot, lineId) {
  const task = state.supplierTasks[slot];
  const quote = task.status === "submitted" ? task.quotes[lineId] : null;
  return quote?.status === "quoted" && Number(quote.price) > 0 ? Number(quote.price) : null;
}

function syncQuoteLines() {
  orderLines.forEach((orderLine) => {
    let line = state.quote.lines.find((item) => item.id === orderLine.id);
    if (!line) {
      line = {
        ...orderLine,
        baseSlot: "",
        baseMode: "auto",
        baseInvalid: false,
        markupMethod: "",
        markupParameter: "",
        recommended: "",
        final: "",
        confirmed: false,
        belowReason: "",
      };
      state.quote.lines.push(line);
    }
    const prices = ["A", "B"]
      .map((slot) => ({ slot, price: getValidQuote(slot, line.id) }))
      .filter((item) => item.price !== null)
      .sort((a, b) => a.price - b.price);
    if (!prices.length) {
      line.baseInvalid = Boolean(line.baseSlot);
      line.baseSlot = "";
      return;
    }
    if (line.baseMode === "manual") {
      const selectedStillValid = prices.some((item) => item.slot === line.baseSlot);
      line.baseInvalid = !selectedStillValid;
      if (!selectedStillValid) line.baseSlot = "";
    } else {
      line.baseSlot = prices[0].slot;
      line.baseInvalid = false;
    }
  });
}

function basePrice(line) {
  if (state.quote.status !== "draft" && Number(line.frozenBasePrice) > 0) return Number(line.frozenBasePrice);
  return line.baseSlot ? getValidQuote(line.baseSlot, line.id) : null;
}

function minPrice(line) {
  if (state.quote.status !== "draft" && Number(line.frozenMinPrice) > 0) return Number(line.frozenMinPrice);
  const prices = [getValidQuote("A", line.id), getValidQuote("B", line.id)].filter((value) => value !== null);
  return prices.length ? Math.min(...prices) : null;
}

function supplierBox(slot, line) {
  const task = state.supplierTasks[slot];
  const current = task.status === "submitted" ? task.quotes[line.id] : null;
  const price = getValidQuote(slot, line.id);
  const label = price !== null ? `¥${money(price)}` : current?.status === "unavailable" ? "无法供货" : task.status === "requote_pending" ? "重报中" : "待报价";
  return `
    <div class="supplier-price ${line.baseSlot === slot ? "selected" : ""}">
      <button data-action="select-base" data-slot="${slot}" data-line-id="${line.id}" ${price === null ? "disabled" : ""}>
        <span>厂家 ${slot}</span><strong>${label}</strong><small>${line.baseSlot === slot ? "当前基准" : "选择基准"}</small>
      </button>
    </div>
  `;
}

function priceCard(line) {
  const base = basePrice(line);
  const minimum = minPrice(line);
  const belowCost = base !== null && Number(line.final) > 0 && Number(line.final) < base;
  return `
    <article class="price-card ${line.baseInvalid || base === null ? "invalid" : ""}">
      <div class="price-card-head">
        <div><h3>${escapeHtml(line.name)} <small>${escapeHtml(line.spec)}</small></h3><small>${line.qty} ${line.unit} · 原始品名：${escapeHtml(line.raw)}</small></div>
        ${line.confirmed ? '<span class="badge ok">已确认</span>' : base === null ? '<span class="badge danger">无有效价</span>' : '<span class="badge warning">待确认</span>'}
      </div>
      ${line.baseInvalid ? '<div class="notice danger">原基准报价已失效，请选择当前有效厂家后再导出。</div>' : ""}
      <div class="supplier-compare">
        ${supplierBox("A", line)}
        ${supplierBox("B", line)}
        <div class="supplier-price"><span>本次最低</span><strong>${minimum === null ? "--" : `¥${money(minimum)}`}</strong><small>仅本次报价</small></div>
      </div>
      <div class="history-strip">
        <div class="history-item"><span>06-20 · V2</span><strong>¥${money((minimum || 12) + 1.1)}</strong><span>同规格</span></div>
        <div class="history-item"><span>05-12 · V1</span><strong>¥${money((minimum || 12) + 1.4)}</strong><span>同规格</span></div>
        <div class="history-item"><span>04-08 · V3</span><strong>¥${money((minimum || 12) + 1.25)}</strong><span>同规格</span></div>
      </div>
      <div class="markup-grid">
        <select aria-label="加价方式" data-quote-line="${line.id}" data-field="markupMethod">
          <option value="" ${!line.markupMethod ? "selected" : ""}>选择加价方式</option>
          <option value="fixed" ${line.markupMethod === "fixed" ? "selected" : ""}>固定金额</option>
          <option value="percentage" ${line.markupMethod === "percentage" ? "selected" : ""}>按比例</option>
          <option value="multiplier" ${line.markupMethod === "multiplier" ? "selected" : ""}>高开倍率</option>
          <option value="manual" ${line.markupMethod === "manual" ? "selected" : ""}>手工改价</option>
        </select>
        <input aria-label="加价参数" inputmode="decimal" placeholder="参数为空" data-quote-line="${line.id}" data-field="markupParameter" value="${escapeHtml(line.markupParameter)}" />
      </div>
      <div class="button-row" style="margin-top:8px"><button class="text-button" data-action="calculate-line" data-line-id="${line.id}">计算推荐价</button><button class="text-button" data-action="apply-recommended" data-line-id="${line.id}" ${line.recommended === "" ? "disabled" : ""}>填入最终价</button></div>
      <div class="price-result">
        <div class="result-box"><span>推荐价</span><strong>${line.recommended === "" ? "--" : `¥${money(line.recommended)}`}</strong></div>
        <label class="result-box"><span>最终报价</span><input inputmode="decimal" placeholder="销售员填写" data-quote-line="${line.id}" data-field="final" value="${escapeHtml(line.final)}" /></label>
      </div>
      ${belowCost ? `<div class="notice danger">最终报价低于基准价 ¥${money(base)}，确认时必须填写原因。</div>` : ""}
      <div class="button-row" style="justify-content:flex-end;margin-top:8px"><button class="secondary" data-action="confirm-line" data-line-id="${line.id}">${line.confirmed ? "重新确认" : "确认最终报价"}</button></div>
    </article>
  `;
}

function renderPricing() {
  if (state.quote.status === "draft") syncQuoteLines();
  const validCount = state.quote.lines.filter((line) => basePrice(line) !== null).length;
  const confirmedCount = state.quote.lines.filter((line) => line.confirmed).length;
  return shell({
    title: `计价工作台 · V${state.quote.version}`,
    back: true,
    noTabs: true,
    action: { name: "save-quote", label: "保存" },
    body: `
      <div class="progress-steps"><span class="progress-step done"></span><span class="progress-step done"></span><span class="progress-step active"></span><span class="progress-step"></span></div>
      <div class="page-intro"><div><h2>市中医院</h2><p>BJ-20260716-HOSP01-001 · 4 个品类</p></div>${statusBadge(state.quote.status)}</div>
      <div class="tag-row"><span class="tag ok">有效基准 ${validCount}/4</span><span class="tag ${confirmedCount === 4 ? "ok" : "warning"}">最终价确认 ${confirmedCount}/4</span></div>
      <div class="button-row" style="margin-top:10px"><button class="secondary" data-action="show-bulk-markup">批量加价</button><button class="secondary" data-action="apply-all-recommended">推荐价填入最终价</button><button class="secondary" data-action="confirm-all-lines">确认全部</button></div>
      ${submittedTaskCount() === 1 ? '<div class="notice warning">当前仅一家完整报价。第二家后到报价只更新最低价和推荐候选，不覆盖已确认最终价。</div>' : ""}
      <div class="section-title"><h3>逐行计价</h3><small>历史价仅参考</small></div>
      <div class="price-list">${state.quote.lines.map(priceCard).join("")}</div>
      <div class="bottom-action">
        <button class="secondary" data-screen="inquiry">厂家报价</button>
        <button class="primary" data-screen="quote-preview">预览报价单</button>
      </div>
    `,
  });
}

function renderSalesQuotes() {
  const currentTarget = state.quoteActivated ? (state.quote.status === "draft" ? "pricing" : "quote-preview") : "inquiry";
  return shell({
    title: "报价单",
    tabs: salesTabs("sales-quotes"),
    body: `
      <div class="search-bar"><span class="search-symbol">⌕</span><input placeholder="搜索医院或报价单号" /></div>
      <div class="order-list">
        <button class="order-card" data-screen="${currentTarget}"><span class="task-marker amber"></span><span><strong>BJ-20260716-HOSP01-001 · V${state.quote.version}</strong><small>市中医院 · ${state.quoteActivated ? "本次计价" : "至少一家已报价"}</small></span>${state.quoteActivated ? statusBadge(state.quote.status) : '<span class="badge warning">待计价</span>'}</button>
        <button class="order-card"><span class="task-marker"></span><span><strong>BJ-20260712-HOSP02-003 · V2</strong><small>县人民医院 · ¥8,462.20</small></span><span class="badge ok">已确认</span></button>
      </div>
    `,
  });
}

function exportBlockers() {
  return state.quote.lines.flatMap((line) => {
    const errors = [];
    const base = basePrice(line);
    if (base === null || line.baseInvalid) errors.push(`${line.name}：无当前有效基准厂家价`);
    if (!(Number(line.final) > 0)) errors.push(`${line.name}：最终报价未填写`);
    if (!line.confirmed) errors.push(`${line.name}：最终报价未确认`);
    if (base !== null && Number(line.final) < base && !line.belowReason) errors.push(`${line.name}：低于基准价但未填写原因`);
    return errors;
  });
}

function quoteTotal() {
  return state.quote.lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.final || 0), 0);
}

function renderQuotePreview() {
  if (state.quote.status === "draft") syncQuoteLines();
  const blockers = exportBlockers();
  const exported = state.quote.exportedFormats.length > 0;
  return shell({
    title: "报价预览",
    back: true,
    noTabs: true,
    body: `
      <div class="page-intro"><div><h2>医院报价单</h2><p>首次成功导出后冻结当前版本</p></div>${statusBadge(state.quote.status)}</div>
      ${blockers.length ? `<div class="notice danger"><strong>暂不能导出</strong><br>${blockers.slice(0, 4).join("<br>")}${blockers.length > 4 ? `<br>另有 ${blockers.length - 4} 项` : ""}</div>` : '<div class="notice ok">导出前校验通过。Excel 与 PDF 可使用同一版本。</div>'}
      <section class="quote-paper">
        <div class="quote-paper-head"><h2>中药饮片报价单</h2><small>以上报价均为含税价格</small></div>
        <div class="quote-meta"><span>医院：市中医院</span><span>版本：V${state.quote.version}</span><span>单号：BJ-20260716-HOSP01-001</span><span>日期：2026-07-16</span></div>
        ${state.quote.lines
          .map(
            (line) => `<div class="quote-line"><span><strong>${escapeHtml(line.name)} · ${escapeHtml(line.spec)}</strong><small>${line.qty} ${line.unit}</small></span><span class="quote-line-price"><strong>¥${money(line.final)}</strong><small>金额 ¥${money(Number(line.qty || 0) * Number(line.final || 0))}</small></span></div>`
          )
          .join("")}
        <div class="quote-total"><span>合计</span><strong>¥${money(quoteTotal())}</strong></div>
      </section>
      <div class="section-title"><h3>版本记录</h3></div>
      <div class="surface">
        <div class="tag-row">${state.quote.exportedFormats.map((format) => `<span class="tag info">已导出 ${format.toUpperCase()}</span>`).join("") || '<span class="tag">暂无导出</span>'}${state.quote.sentAt ? '<span class="tag info">已发送医院</span>' : ""}${state.quote.confirmedAt ? '<span class="tag ok">医院已确认</span>' : ""}</div>
      </div>
      <div class="button-row" style="margin-top:12px">
        <button class="secondary" data-action="export-quote" data-format="xlsx" ${blockers.length ? "disabled" : ""}>导出 Excel</button>
        <button class="secondary" data-action="export-quote" data-format="pdf" ${blockers.length ? "disabled" : ""}>导出 PDF</button>
        ${exported && !state.quote.sentAt ? '<button class="primary" data-action="mark-sent">标记已发送</button>' : ""}
        ${state.quote.sentAt && !state.quote.confirmedAt ? '<button class="primary" data-action="confirm-version">登记医院确认</button><button class="secondary" data-action="new-version">创建新版本</button>' : ""}
      </div>
      ${state.quote.status !== "draft" ? '<div class="notice">当前版本已冻结。如需修改，必须创建 V' + (state.quote.version + 1) + '。</div>' : ""}
    `,
  });
}

function renderProducts() {
  const query = state.productQuery.trim();
  const list = products.filter((product) => !query || `${product.name}${product.aliases}`.includes(query));
  return shell({
    title: "商品库",
    tabs: salesTabs("products"),
    action: { name: "source-batches", label: "来源批次" },
    body: `
      <div class="search-bar"><span class="search-symbol">⌕</span><input data-field="productQuery" value="${escapeHtml(state.productQuery)}" placeholder="搜索品名、别名或规格" /></div>
      <button class="secondary full" style="margin-top:-4px;margin-bottom:12px" data-action="apply-product-search">搜索商品</button>
      <div class="notice">商品库用于标准化品名和规格；厂家全品类来源价格仅资料参考。</div>
      <div class="product-list">${list
        .map(
          (product) => `<button class="product-row" data-action="open-product" data-product-id="${product.id}"><span><strong>${product.name}</strong><small>别名：${product.aliases}<br>${product.variants.length} 个规格</small></span><span class="chevron">›</span></button>`
        )
        .join("") || '<div class="empty-state"><span class="empty-symbol">⌕</span><h3>未找到商品</h3><p>采购单仍可使用自定义品名，后续由销售员校对。</p></div>'}</div>
    `,
  });
}

function renderProductDetail() {
  const product = products.find((item) => item.id === state.selectedProductId) || products[0];
  return shell({
    title: product.name,
    back: true,
    noTabs: true,
    body: `
      <div class="page-intro"><div><h2>${product.name}</h2><p>别名：${product.aliases}</p></div><span class="badge ok">启用</span></div>
      <div class="section-title"><h3>商品规格</h3></div>
      <div class="surface">${product.variants.map((variant) => `<div class="quote-line"><span><strong>${variant.split(" · ")[0]}</strong><small>${variant}</small></span><span class="badge">常用</span></div>`).join("")}</div>
      <div class="section-title"><h3>厂家来源历史</h3><button class="text-button" data-screen="source-batches">全部批次</button></div>
      <div class="notice warning">以下价格仅资料参考，不参与本次报价。</div>
      <table class="reference-table"><thead><tr><th>厂家/批次</th><th>日期</th><th>参考价</th></tr></thead><tbody><tr><td>瑞康饮片<br><small>PL-20260701...</small></td><td>07-01</td><td>¥11.60</td></tr><tr><td>本草源饮片<br><small>PL-20260618...</small></td><td>06-18</td><td>¥12.10</td></tr><tr><td>瑞康饮片<br><small>PL-20260520...</small></td><td>05-20</td><td>¥11.90</td></tr></tbody></table>
    `,
  });
}

function renderSourceBatches() {
  return shell({
    title: "厂家来源批次",
    back: true,
    noTabs: true,
    action: { name: "new-source-batch", label: "新建" },
    body: `
      <div class="notice warning">来源批次独立保存、不可覆盖，仅用于资料查询。</div>
      <div class="batch-list">${sourceBatches
        .map(
          (batch) => `<button class="batch-row" data-action="source-batch-detail"><span><strong>${batch.manufacturer}</strong><small>${batch.no}<br>厂家原始批次 ${batch.sourceNo} · ${batch.type}</small></span><span><strong>${batch.rows} 行</strong><small>${batch.date}</small></span></button>`
        )
        .join("")}</div>
    `,
  });
}

function renderHospitalHome() {
  return shell({
    title: "市中医院",
    tabs: hospitalTabs("hospital-home"),
    action: { name: "hospital-profile", label: "李主任" },
    body: `
      <button class="hero-action full" data-screen="hospital-new-order"><span><h2>提交采购单</h2><p>图片、Excel、商品库或自定义录入</p></span><span class="hero-plus">＋</span></button>
      <div class="section-title"><h3>我的采购单</h3><button class="text-button" data-screen="hospital-orders">查看全部</button></div>
      ${hospitalOrderList(state.hospitalOrders)}
      <div class="notice">医院端只显示采购单状态，不展示厂家报价、销售加价或报价文件。</div>
    `,
  });
}

function hospitalOrderList(orders) {
  return `<div class="order-list">${orders
    .map(
      (order) => `<button class="order-card" data-action="open-hospital-order" data-order-id="${order.id}"><span class="task-marker ${order.status === "已完成" ? "" : "amber"}"></span><span><strong>${order.id}</strong><small>${order.date} · ${order.count} 个品类</small></span><span><span class="tag ${order.source === "sales" ? "info" : "ok"}">${order.source === "sales" ? "销售代录" : "医院提交"}</span><small style="margin-top:4px">${order.status}</small></span></button>`
    )
    .join("")}</div>`;
}

function renderHospitalOrders() {
  return shell({
    title: "我的采购单",
    tabs: hospitalTabs("hospital-orders"),
    action: { name: "new-hospital-order", label: "新建" },
    body: `<div class="tag-row"><span class="tag ok">全部</span><span class="tag">处理中</span><span class="tag">已完成</span></div><div class="section-title"><h3>采购记录</h3></div>${hospitalOrderList(state.hospitalOrders)}`,
  });
}

function renderHospitalNewOrder() {
  const sourceCopy = state.hospitalSource === "image" ? "拍照或选择图片" : state.hospitalSource === "excel" ? "选择 Excel" : state.hospitalSource === "product" ? "从商品库点选" : "新增自定义品类";
  return shell({
    title: "新建采购单",
    back: true,
    noTabs: true,
    body: `
      <div class="tag-row"><span class="tag ok">医院提交</span><span class="tag">草稿</span></div>
      <div class="section-title"><h3>录入方式</h3><small>可组合使用</small></div>
      ${sourceOptions(state.hospitalSource, "hospital")}
      <button class="secondary full" style="margin-top:8px" data-action="simulate-import" data-kind="hospital">${sourceCopy}</button>
      ${state.hospitalImported ? '<div class="notice ok">已生成结构化明细，请核对名称、数量和单位。</div>' : ""}
      <div class="section-title"><h3>采购明细</h3><button class="text-button" data-action="add-draft-line" data-kind="hospital">＋ 自定义</button></div>
      ${editableLines(state.hospitalDraftLines, "hospital")}
      <div class="bottom-action single"><button class="primary" data-action="submit-hospital-order">提交采购单</button></div>
    `,
  });
}

function renderHospitalOrderDetail() {
  const order = state.hospitalOrders.find((item) => item.id === state.selectedHospitalOrder) || state.hospitalOrders[0];
  const salesCreated = order.source === "sales";
  return shell({
    title: "采购单详情",
    back: true,
    noTabs: true,
    body: `
      <div class="page-intro"><div><h2>${order.id}</h2><p>${order.count} 个品类 · ${order.date}</p></div><span class="tag ${salesCreated ? "info" : "ok"}">${salesCreated ? "销售代录" : "医院提交"}</span></div>
      ${salesCreated ? '<div class="notice">该采购单由销售员为你代录，可查看但不能编辑。</div>' : ""}
      <div class="section-title"><h3>状态进度</h3></div>
      <div class="surface status-timeline">
        <div class="timeline-item done"><span class="timeline-dot"></span><span class="timeline-copy"><strong>已提交</strong><small>07-16 09:18</small></span></div>
        <div class="timeline-item done"><span class="timeline-dot"></span><span class="timeline-copy"><strong>报价处理中</strong><small>销售员正在处理</small></span></div>
        <div class="timeline-item"><span class="timeline-dot"></span><span class="timeline-copy"><strong>报价已发送</strong><small>等待销售员线下发送</small></span></div>
        <div class="timeline-item"><span class="timeline-dot"></span><span class="timeline-copy"><strong>已完成</strong><small>等待线下确认</small></span></div>
      </div>
      <div class="section-title"><h3>采购明细</h3></div>
      <div class="surface">${orderLines.slice(0, order.count).map((line) => `<div class="quote-line"><span><strong>${line.name}</strong><small>${line.spec}</small></span><span>${line.qty} ${line.unit}</span></div>`).join("")}</div>
    `,
  });
}

function renderHospitalProfile() {
  return shell({
    title: "我的",
    tabs: hospitalTabs("hospital-profile"),
    body: `<div class="surface"><div class="page-intro"><div><h2>李主任</h2><p>市中医院 · 采购员</p></div><span class="badge ok">已绑定微信</span></div><div class="quote-line"><span><strong>绑定手机号</strong><small>用于身份校验</small></span><span>138****2208</span></div><div class="quote-line"><span><strong>负责销售员</strong><small>采购单提交后由其处理</small></span><span>王销售</span></div></div>`,
  });
}

function supplierDraftLine(task, line) {
  const draft = task.draft[line.id] || {};
  const readonlyQuote = task.status === "submitted" ? task.quotes[line.id] : null;
  const current = readonlyQuote || draft;
  return `
    <div class="line-item">
      <div class="line-item-head"><span><strong>${line.name} · ${line.spec}</strong><small>${line.qty} ${line.unit}</small></span>${readonlyQuote ? '<span class="badge ok">已提交</span>' : ""}</div>
      <div class="supply-choice">
        <button class="choice-button ${current.status === "quoted" ? "selected" : ""}" data-action="supplier-status" data-line-id="${line.id}" data-status="quoted" ${readonlyQuote ? "disabled" : ""}>可供货</button>
        <button class="choice-button unavailable ${current.status === "unavailable" ? "selected" : ""}" data-action="supplier-status" data-line-id="${line.id}" data-status="unavailable" ${readonlyQuote ? "disabled" : ""}>无法供货</button>
      </div>
      <div class="field-grid">
        <label class="field"><span>含税含抽点单价</span><input inputmode="decimal" placeholder="0.00" data-supplier-line="${line.id}" data-field="price" value="${current.price ?? ""}" ${current.status !== "quoted" || readonlyQuote ? "disabled" : ""} /></label>
        <label class="field"><span>备注</span><input placeholder="选填" data-supplier-line="${line.id}" data-field="remark" value="${escapeHtml(current.remark || "")}" ${readonlyQuote ? "disabled" : ""} /></label>
      </div>
    </div>
  `;
}

function renderSupplierForm() {
  const slot = state.selectedSupplierSlot;
  const task = state.supplierTasks[slot];
  const readonly = task.status === "submitted";
  return shell({
    title: "本次采购报价",
    noTabs: true,
    action: { name: "supplier-help", label: "说明" },
    body: `
      <div class="h5-banner"><strong>${task.name}</strong><span>市中医院 · CG-20260716-000108</span></div>
      <div class="slot-meta"><span>截止 ${task.expires}</span><span>链接版本 v${task.linkVersion}</span></div>
      <div class="notice warning">本表价格必须为含税、含抽点单价。每行选择“可供货”或“无法供货”，全部完成后一次提交。</div>
      ${readonly ? '<div class="notice ok">该链接已提交，原始报价不可修改。</div>' : '<button class="secondary full" data-action="fill-supplier-example">填入示例报价</button>'}
      <div class="section-title"><h3>采购明细</h3><small>${orderLines.length} 行</small></div>
      <div class="line-editor">${orderLines.map((line) => supplierDraftLine(task, line)).join("")}</div>
      <div class="bottom-action single"><button class="primary" data-action="submit-supplier" ${readonly ? "disabled" : ""}>${readonly ? "已提交" : "确认并提交完整报价"}</button></div>
    `,
  });
}

function renderSupplierSuccess() {
  const task = state.supplierTasks[state.selectedSupplierSlot];
  return shell({
    title: "提交成功",
    noTabs: true,
    body: `<div class="success-state"><span class="success-symbol">✓</span><h2>本次报价已提交</h2><p>${task.name}<br>提交版本：第 ${task.submissionNo} 次<br>采购明细：${orderLines.length} 行</p><div class="notice">报价提交后不可修改。如需更正，请联系销售员重新生成链接。</div><button class="secondary" data-action="return-sales-demo">返回销售端演示</button></div>`,
  });
}

function render() {
  const screens = {
    "sales-dashboard": renderSalesDashboard,
    "sales-orders": renderSalesOrders,
    "sales-new-order": renderSalesNewOrder,
    inquiry: renderInquiry,
    pricing: renderPricing,
    "sales-quotes": renderSalesQuotes,
    "quote-preview": renderQuotePreview,
    products: renderProducts,
    "product-detail": renderProductDetail,
    "source-batches": renderSourceBatches,
    "hospital-home": renderHospitalHome,
    "hospital-orders": renderHospitalOrders,
    "hospital-new-order": renderHospitalNewOrder,
    "hospital-order-detail": renderHospitalOrderDetail,
    "hospital-profile": renderHospitalProfile,
    "supplier-form": renderSupplierForm,
    "supplier-success": renderSupplierSuccess,
  };
  const renderer = screens[state.screen] || screens[defaultScreen(state.role)];
  app.innerHTML = renderer();
}

function calculateRecommended(line) {
  const base = basePrice(line);
  const parameter = Number(line.markupParameter);
  if (base === null || !line.markupMethod || line.markupMethod === "manual") return "";
  if (!Number.isFinite(parameter) || parameter < 0) return "";
  if (line.markupMethod === "fixed") return Number((base + parameter).toFixed(2));
  if (line.markupMethod === "percentage") return Number((base * (1 + parameter / 100)).toFixed(2));
  if (line.markupMethod === "multiplier" && parameter >= 1) return Number((base * parameter).toFixed(2));
  return "";
}

function confirmQuoteLine(line) {
  const base = basePrice(line);
  if (base === null) return showToast(`${line.name} 没有当前有效基准价`);
  if (!(Number(line.final) > 0)) return showToast(`请填写 ${line.name} 的最终报价`);
  if (Number(line.final) < base && !line.belowReason) {
    showModal(`
      <h3>最终报价低于基准价</h3>
      <p>${line.name}：最终报价 ¥${money(line.final)}，基准价 ¥${money(base)}，差额 ¥${money(base - Number(line.final))}。</p>
      <label class="field" style="margin-top:12px"><span>原因</span><textarea id="belowReason" placeholder="填写低价原因"></textarea></label>
      <div class="modal-actions"><button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="confirm-below-cost" data-line-id="${line.id}">确认风险</button></div>
    `);
    return;
  }
  line.confirmed = true;
  showToast(`${line.name} 最终报价已确认`);
  render();
}

function resetSupplierForRequote(slot) {
  const task = state.supplierTasks[slot];
  if (task.status === "submitted") task.history.push({ submissionNo: task.submissionNo, quotes: structuredClone(task.quotes) });
  task.status = "requote_pending";
  task.linkVersion += 1;
  task.quotes = {};
  task.draft = {};
  if (state.quoteActivated && state.quote.status === "draft") syncQuoteLines();
}

function showBulkMarkupModal() {
  showModal(`
    <h3>批量加价</h3>
    <p>参数默认空。计算结果先写入推荐价，不会自动成为最终报价。</p>
    <div class="field-grid" style="margin-top:12px">
      <label class="field"><span>加价方式</span><select id="bulkMethod"><option value="">请选择</option><option value="fixed">固定金额</option><option value="percentage">按比例</option><option value="multiplier">高开倍率</option></select></label>
      <label class="field"><span>参数</span><input id="bulkParameter" inputmode="decimal" placeholder="请输入" /></label>
    </div>
    <div class="notice">作用范围：全部 4 行；无有效基准价的行将自动跳过。</div>
    <div class="modal-actions"><button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="apply-bulk-markup">计算推荐价</button></div>
  `);
}

function handleAction(action, element) {
  if (action === "back") return goBack();
  if (action === "close-modal") return closeModal();
  if (action === "new-sales-order") return navigate("sales-new-order");
  if (action === "new-hospital-order") return navigate("hospital-new-order");
  if (action === "source-batches") return navigate("source-batches");
  if (["sales-profile", "hospital-profile", "supplier-help"].includes(action)) return showToast("原型中仅展示主业务链路");
  if (action === "choose-source") {
    if (element.dataset.prefix === "hospital") state.hospitalSource = element.dataset.source;
    else state.draftSource = element.dataset.source;
    return render();
  }
  if (action === "simulate-import") {
    if (element.dataset.kind === "hospital") state.hospitalImported = true;
    else state.draftImported = true;
    showToast("已生成结构化采购明细");
    return render();
  }
  if (action === "add-draft-line") {
    const target = element.dataset.kind === "hospital" ? state.hospitalDraftLines : state.draftLines;
    target.push({ id: `${element.dataset.kind}-${Date.now()}`, raw: "自定义品类", name: "自定义品类", spec: "", qty: "1.00", unit: "kg" });
    return render();
  }
  if (action === "delete-draft-line") {
    const targetKey = element.dataset.kind === "hospital" ? "hospitalDraftLines" : "draftLines";
    state[targetKey] = state[targetKey].filter((line) => line.id !== element.dataset.lineId);
    return render();
  }
  if (action === "save-draft") return showToast("采购单草稿已保存");
  if (action === "freeze-draft") {
    showModal('<h3>确认冻结采购单</h3><p>冻结后才能创建厂家询价链接。生成任一链接后如需修改明细，必须创建采购单新版本。</p><div class="modal-actions"><button class="secondary" data-action="close-modal">取消</button><button class="primary" data-action="confirm-freeze">确认冻结</button></div>');
    return;
  }
  if (action === "confirm-freeze") {
    closeModal();
    showToast("采购单已冻结，可发起本次询价");
    return navigate("inquiry");
  }
  if (action === "copy-link") return showToast(`厂家 ${element.dataset.slot} 链接已复制，有效期 48 小时`);
  if (action === "open-supplier") return setRole("supplier", element.dataset.slot);
  if (action === "regenerate-link") {
    const slot = element.dataset.slot;
    const task = state.supplierTasks[slot];
    showModal(`<h3>${task.status === "submitted" ? "发起重新报价" : "重新生成链接"}</h3><p>${task.status === "submitted" ? "原提交将立即退出最低价、基准价和推荐价计算，但永久保留。" : "旧链接将立即失效，新链接重新计算 48 小时有效期。"}</p><div class="modal-actions"><button class="secondary" data-action="close-modal">取消</button><button class="danger-button" data-action="confirm-regenerate" data-slot="${slot}">确认重新生成</button></div>`);
    return;
  }
  if (action === "confirm-regenerate") {
    resetSupplierForRequote(element.dataset.slot);
    closeModal();
    showToast("新链接已生成，旧报价已退出计算");
    return render();
  }
  if (action === "show-order-lines") {
    showModal(`<h3>冻结采购明细</h3>${orderLines.map((line) => `<div class="quote-line"><span><strong>${line.name}</strong><small>${line.spec}</small></span><span>${line.qty} ${line.unit}</span></div>`).join("")}<div class="modal-actions"><button class="primary full" data-action="close-modal">关闭</button></div>`);
    return;
  }
  if (action === "inquiry-history") return showToast("历史链接和厂家提交版本均永久保留");
  if (action === "enter-pricing") {
    const submitted = submittedTaskCount();
    if (submitted === 0) return;
    if (submitted === 1) {
      showModal('<h3>提前进入计价</h3><p>当前仅一家厂家完成报价。另一厂家仍可继续提交，后到报价不会覆盖销售员已确认的最终价。</p><div class="modal-actions"><button class="secondary" data-action="close-modal">继续等待</button><button class="primary" data-action="confirm-enter-pricing">确认进入</button></div>');
      return;
    }
    action = "confirm-enter-pricing";
  }
  if (action === "confirm-enter-pricing") {
    state.quoteActivated = true;
    syncQuoteLines();
    closeModal();
    return navigate("pricing");
  }
  if (action === "select-base") {
    const line = state.quote.lines.find((item) => item.id === element.dataset.lineId);
    if (!line || getValidQuote(element.dataset.slot, line.id) === null) return;
    line.baseSlot = element.dataset.slot;
    line.baseMode = "manual";
    line.baseInvalid = false;
    line.confirmed = false;
    return render();
  }
  if (action === "calculate-line") {
    const line = state.quote.lines.find((item) => item.id === element.dataset.lineId);
    line.recommended = calculateRecommended(line);
    if (line.recommended === "") showToast("请选择加价方式并填写合法参数");
    else showToast(`${line.name} 推荐价已计算`);
    return render();
  }
  if (action === "apply-recommended") {
    const line = state.quote.lines.find((item) => item.id === element.dataset.lineId);
    if (line.recommended !== "") {
      line.final = line.recommended;
      line.confirmed = false;
    }
    return render();
  }
  if (action === "confirm-line") {
    const line = state.quote.lines.find((item) => item.id === element.dataset.lineId);
    return confirmQuoteLine(line);
  }
  if (action === "confirm-below-cost") {
    const line = state.quote.lines.find((item) => item.id === element.dataset.lineId);
    const reason = document.querySelector("#belowReason")?.value.trim();
    if (!reason) return showToast("请填写低价原因");
    line.belowReason = reason;
    line.confirmed = true;
    closeModal();
    showToast("低价风险已确认并记录");
    return render();
  }
  if (action === "show-bulk-markup") return showBulkMarkupModal();
  if (action === "apply-bulk-markup") {
    const method = document.querySelector("#bulkMethod")?.value || "";
    const parameter = document.querySelector("#bulkParameter")?.value || "";
    let applied = 0;
    state.quote.lines.forEach((line) => {
      line.markupMethod = method;
      line.markupParameter = parameter;
      line.recommended = calculateRecommended(line);
      if (line.recommended !== "") applied += 1;
    });
    if (!applied) return showToast("请选择方式并填写合法参数");
    closeModal();
    showToast(`已计算 ${applied} 行推荐价，未修改最终报价`);
    return render();
  }
  if (action === "apply-all-recommended") {
    let applied = 0;
    state.quote.lines.forEach((line) => {
      if (line.recommended !== "") {
        line.final = line.recommended;
        line.confirmed = false;
        applied += 1;
      }
    });
    showToast(applied ? `已填入 ${applied} 行，仍需销售员确认` : "当前没有可应用的推荐价");
    return render();
  }
  if (action === "confirm-all-lines") {
    const ready = state.quote.lines.filter((line) => basePrice(line) !== null && Number(line.final) > 0 && Number(line.final) >= basePrice(line));
    ready.forEach((line) => (line.confirmed = true));
    showToast(`已确认 ${ready.length} 行；异常行需单独处理`);
    return render();
  }
  if (action === "save-quote") return showToast("报价草稿已保存，版本号不变");
  if (action === "export-quote") {
    if (exportBlockers().length) return showToast("仍有导出阻断项");
    const format = element.dataset.format;
    if (state.quote.status === "draft") {
      state.quote.lines.forEach((line) => {
        line.frozenBasePrice = basePrice(line);
        line.frozenMinPrice = minPrice(line);
        line.frozenBaseSlot = line.baseSlot;
      });
    }
    if (!state.quote.exportedFormats.includes(format)) state.quote.exportedFormats.push(format);
    state.quote.status = "exported";
    showToast(`${format.toUpperCase()} 已导出，V${state.quote.version} 已冻结`);
    return render();
  }
  if (action === "mark-sent") {
    state.quote.status = "sent";
    state.quote.sentAt = "2026-07-16 11:08";
    showToast("已记录线下发送，当前版本进入医院历史");
    return render();
  }
  if (action === "confirm-version") {
    state.quote.status = "confirmed";
    state.quote.confirmedAt = "2026-07-16 14:26";
    showToast(`V${state.quote.version} 已登记为医院最终确认版本`);
    return render();
  }
  if (action === "new-version") {
    state.quote.version += 1;
    state.quote.status = "draft";
    state.quote.exportedFormats = [];
    state.quote.sentAt = "";
    state.quote.confirmedAt = "";
    state.quote.lines.forEach((line) => {
      line.confirmed = false;
      delete line.frozenBasePrice;
      delete line.frozenMinPrice;
      delete line.frozenBaseSlot;
    });
    syncQuoteLines();
    showToast(`已创建 V${state.quote.version} 草稿，V${state.quote.version - 1} 保持冻结`);
    return navigate("pricing");
  }
  if (action === "open-product") {
    state.selectedProductId = element.dataset.productId;
    return navigate("product-detail");
  }
  if (action === "apply-product-search") return render();
  if (action === "new-source-batch") {
    showModal('<h3>新建来源批次</h3><p>每次 Excel 导入或手工录入都会创建独立系统批次号，厂家原始批次号允许重复，旧批次不会覆盖。</p><div class="button-row" style="margin-top:12px"><button class="secondary" data-action="mock-source-created">上传 Excel</button><button class="secondary" data-action="mock-source-created">手工录入</button></div><div class="modal-actions"><button class="primary full" data-action="close-modal">关闭</button></div>');
    return;
  }
  if (action === "source-batch-detail") return showToast("已确认批次只可查看或整体作废");
  if (action === "mock-source-created") {
    closeModal();
    return showToast("已创建独立草稿批次，确认后不可编辑");
  }
  if (action === "open-hospital-order") {
    state.selectedHospitalOrder = element.dataset.orderId;
    return navigate("hospital-order-detail");
  }
  if (action === "submit-hospital-order") {
    state.hospitalOrders.unshift({ id: "CG-20260716-000118", source: "hospital", status: "报价处理中", date: "07-16", count: state.hospitalDraftLines.length });
    showToast("采购单已提交，医院端不能再编辑");
    return navigate("hospital-orders");
  }
  if (action === "supplier-status") {
    const task = state.supplierTasks[state.selectedSupplierSlot];
    if (task.status === "submitted") return;
    const draft = task.draft[element.dataset.lineId] || { price: "", remark: "" };
    draft.status = element.dataset.status;
    if (draft.status === "unavailable") draft.price = null;
    task.draft[element.dataset.lineId] = draft;
    return render();
  }
  if (action === "fill-supplier-example") {
    const task = state.supplierTasks[state.selectedSupplierSlot];
    const samples = { l1: 12.1, l2: 13.9, l3: 16.4, l4: 10.1 };
    orderLines.forEach((line) => {
      task.draft[line.id] = { status: "quoted", price: samples[line.id], remark: "" };
    });
    return render();
  }
  if (action === "submit-supplier") {
    const task = state.supplierTasks[state.selectedSupplierSlot];
    const invalid = orderLines.filter((line) => {
      const draft = task.draft[line.id];
      return !draft?.status || (draft.status === "quoted" && !(Number(draft.price) > 0));
    });
    if (invalid.length) return showToast(`还有 ${invalid.length} 行未完成报价/无法供货选择`);
    task.quotes = structuredClone(task.draft);
    task.draft = {};
    task.status = "submitted";
    task.submissionNo += 1;
    if (state.quoteActivated && state.quote.status === "draft") syncQuoteLines();
    return navigate("supplier-success", { replace: true });
  }
  if (action === "return-sales-demo") return setRole("sales");
}

document.addEventListener("click", (event) => {
  const roleButton = event.target.closest("[data-role]");
  if (roleButton) return setRole(roleButton.dataset.role);
  const screenButton = event.target.closest("[data-screen]");
  if (screenButton) return navigate(screenButton.dataset.screen);
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) return handleAction(actionButton.dataset.action, actionButton);
  if (event.target === modal) closeModal();
});

document.addEventListener("input", (event) => {
  const draftInput = event.target.closest("[data-draft-kind]");
  if (draftInput) {
    const target = draftInput.dataset.draftKind === "hospital" ? state.hospitalDraftLines : state.draftLines;
    const line = target.find((item) => item.id === draftInput.dataset.lineId);
    if (line) line[draftInput.dataset.field] = draftInput.value;
    return;
  }
  const quoteInput = event.target.closest("[data-quote-line]");
  if (quoteInput) {
    const line = state.quote.lines.find((item) => item.id === quoteInput.dataset.quoteLine);
    if (line) {
      line[quoteInput.dataset.field] = quoteInput.value;
      if (quoteInput.dataset.field === "final") line.confirmed = false;
    }
    return;
  }
  const supplierInput = event.target.closest("[data-supplier-line]");
  if (supplierInput) {
    const task = state.supplierTasks[state.selectedSupplierSlot];
    const draft = task.draft[supplierInput.dataset.supplierLine] || { status: "quoted", price: "", remark: "" };
    draft[supplierInput.dataset.field] = supplierInput.value;
    task.draft[supplierInput.dataset.supplierLine] = draft;
    return;
  }
  if (event.target.matches('[data-field="productQuery"]')) {
    state.productQuery = event.target.value;
  }
});

document.addEventListener("change", (event) => {
  const quoteInput = event.target.closest("[data-quote-line]");
  if (!quoteInput) return;
  const line = state.quote.lines.find((item) => item.id === quoteInput.dataset.quoteLine);
  if (line) {
    line[quoteInput.dataset.field] = quoteInput.value;
    line.confirmed = false;
  }
});

const hashScreen = window.location.hash.replace("#", "");
if (hashScreen) {
  state.screen = hashScreen;
  if (hashScreen.startsWith("hospital-")) state.role = "hospital";
  if (hashScreen.startsWith("supplier-")) state.role = "supplier";
  document.querySelectorAll("[data-role]").forEach((button) => button.classList.toggle("active", button.dataset.role === state.role));
}
render();
