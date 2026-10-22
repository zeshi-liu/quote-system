# 中药饮片报价系统

面向中药饮片销售员的报价协作系统。最新已确认需求包括销售 PC Web 与微信小程序协同、厂家外部 H5 报价、历史订单查询、回款台账与提醒，以及医院需求数据分析。需求已整合至 PRD v3；前五部分开发设计已确认，核心页面原型正逐项审阅。仓库保留旧原型，生产应用尚未实现。

## 主要文档

- [PRD v3（当前需求基线）](docs/quote-system-prd-v3.md)：已整合本轮确认需求，详细设计待确认项集中在第 19 节。
- [需求增补与决策记录（2026-10-15）](docs/requirement-consensus-2026-10-15.md)：保留决策来源，已确认条目已合并至 PRD；建议及待确认事项另行标记。
- [开发设计说明书第一部分](docs/development-design-v1.md)：整体架构与软件技术栈已确认；两人试用采用单机自建 PostgreSQL，具体云资源及费用仍待核价。
- [开发设计说明书第二部分](docs/database-transaction-design-v1.md)：数据库关系、金额精度、同单锁与幂等、导出占用和查询快照方案已确认。
- [开发设计说明书第三部分](docs/api-identity-permission-design-v1.md)：接口契约、账号登录绑定、会话和角色/订单权限已确认；尚未创建数据库或应用工程。
- [开发设计说明书第四部分](docs/state-time-boundary-design-v1.md)：状态允许操作、有效期、自然日账期、每日 09:00 提醒及图表日期分组已确认。
- [开发设计说明书第五部分](docs/deployment-cost-design-v1.md)：两人单机自建路线、资源限制、备份恢复目标和发布步骤已确认；预算和采购未确认，真实部署及演练尚未进行。下一步进入核心页面原型。
- [核心页面原型设计 v3](docs/core-prototype-design-v3.md)：销售 PC 首页、采购校对、厂家询价、H5、计价、预览导出、发送确认及历史档案已确认，历史纸单补录与核实已确认，回款台账与分次登记已确认，更正与异常处理已确认，医院分析已确认，销售小程序工作台与查询导航已确认，手机采购录入与校对已确认，当前审阅手机厂家询价。
- [需求共识](docs/requirement-consensus-2026-07-05.md)
- [中保真原型说明](docs/ui-ux-prototype-spec.md)

## 可点击原型

v3 原型入口为 [销售 PC 待办工作台](prototype-v3/index.html)，首页 A 布局已确认。点击“新建采购单”或“校对采购单”进入已采用原单与明细并排的 [采购新建与校对页](prototype-v3/purchase-review.html)，[本次厂家询价页](prototype-v3/supplier-inquiry.html)、[厂家 H5 表单](prototype-v3/manufacturer-h5.html)、[销售计价工作台](prototype-v3/pricing-workbench.html) 及 [报价预览与导出](prototype-v3/quote-export.html) 也已确认。[发送医院与确认](prototype-v3/send-confirm.html) 已确认。[历史订单查询与详情](prototype-v3/order-archive.html) 已确认。[历史纸单补录与核实](prototype-v3/historical-backfill.html) 已确认。[回款台账与分次登记](prototype-v3/receivables.html) 已确认。[回款更正、账期与异常处理](prototype-v3/receivable-adjustments.html) 已确认。[医院数据分析](prototype-v3/hospital-analytics.html) 已确认。[销售小程序工作台与查询导航](prototype-v3/sales-mini.html) 已确认。[手机采购录入与校对](prototype-v3/sales-mini-purchase.html) 已确认。当前审阅 [手机厂家询价](prototype-v3/sales-mini-inquiry.html)，体验两个厂家任务、链接重置/重询、逐行有效比价及计价门槛；其他移动报价/财务操作、登录绑定与分析内页后续逐项审阅。本轮为浏览器中的虚构布局稿，不是已运行的小程序或真实 PC 同步。[首页比较稿](prototype-v3/layout-options.html) 和 [采购校对比较稿](prototype-v3/purchase-review-options.html) 保留作选择依据。可直接用浏览器打开本地 HTML；各页数据为独立虚构样例，尚未接后端。

现有原型对应 2026-07-16 的原始 v2.1，仅演示原报价流程，尚未包含本次修订新增的销售 PC、历史订单档案、回款和分析页面。

直接打开 [`prototype/index.html`](prototype/index.html) 即可使用，无需安装依赖或启动服务。

原型包含三个可切换场景：

- 销售员微信小程序。
- 医院采购员轻量端。
- 厂家本次报价 H5。

原型数据保存在浏览器当前页面内，刷新后自动重置。
