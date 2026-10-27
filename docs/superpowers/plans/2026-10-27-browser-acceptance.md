# 浏览器业务验收与显示修复实施计划

> 使用 superpowers:subagent-driven-development；独立显示问题按 dispatching-parallel-agents 分工，先失败测试再修复，需求审查通过后做质量审查。用户已授权持续完成可开发功能，本次沿用 PRD v3 和已确认页面流程，不新增业务范围。

**Goal:** 跑通实际页面上的采购原单、询价计价、文件、确认、回款及分析闭环，修复实测暴露的时间与状态显示问题。

**Architecture:** 复用现有 Vue/uni-app 与持久幂等后端。医院实际确认改为页面内显式复核，核对快照后才调用原接口；金额、权限、有效期仍以服务端为准。文件时间只改展示，保留 UTC 原始时间与原件。

**Tech Stack:** 现有 Vue 3/TypeScript、uni-app、NestJS/PostgreSQL；浏览器采用隔离 PGlite 和虚构医院/厂家，外部微信、COS/OCR 和云端验收另列。

## Task 1：PC 交付状态与医院确认复核

Files: `apps/pc/src/components/QuoteDelivery.vue`、`apps/pc/src/components/SalesWorkbench.vue`、`apps/pc/src/workbench-integration.test.mjs`，新增 `apps/pc/src/delivery-review.test.mjs`。

- [x] 用真实组件回归复现：导出排队后首次成功刷新，子页已导出但父订单仍计价中；保存计价成功仍显示“有未保存修改”。
- [x] `refresh()` 成功后在子 busy 解除后发出 `changed`，让父页重新查询；读取失败不伪造已更新。保存计价成功更新成功提示；厂家任务和导出任务显示中文状态。

```ts
async function refresh(){
 await run(async()=>{await load();needsRefresh=true;});
}
```

- [x] 将医院确认改为页面内复核：首击只冻结当前版本 ID、expectedVersion、确认时间/原因和显示金额；展示医院、报价号/V、金额或全缺货、实际确认及补录说明；“返回修改”不写入，最终“确认登记”才向原 `/confirm` 接口派发一次。
- [x] 复核期间禁用旧表单、版本切换与外层导航，允许返回；不能把自身 busy 反馈到提交守卫造成死锁。页面、账号或订单/版本上下文变更时清空复核，禁止跨单晚到提交。取消、重复点击、结果未知继续沿用现有原 key/输入保护。
- [x] 先验证失败，再最小修复；运行 `pnpm exec tsx --test apps/pc/src/delivery-review.test.mjs apps/pc/src/workbench-integration.test.mjs` 和 PC 类型检查，自查后仅提交本项文件。

## Task 2：原始文件北京时间

Files: `apps/pc/src/components/SourceFiles.vue`、`apps/mini/src/components/SourceFiles.vue`，可复用现有时间函数或在 `packages/source-client/src/` 增加纯展示函数及对应测试。

- [x] 复现 `2026-10-26T16:41:00Z` 被直接截为 `2026-10-26 16:41` 的错误，期望为 `2026-10-27 00:41:00 北京时间`，浏览器/进程时区不影响结果；未知时间显示未知。
- [x] 两端文件列表调用同口径格式函数，只改显示，不修改时间值、文件引用、上传、原键恢复或日期字段。
- [x] 覆盖跨午夜及无效时间，先失败再修复；运行 source-client/双端原单局部测试及类型检查，自查后仅提交本项文件。

## Task 3：真实页面与文件验收

- [x] 在最终基线上已通过浏览器完成 CSV 原单上传、真实解析、字段映射、两行追加、逐行校对、保存及冻结。
- [x] 两家独立 H5 提交；一家有价一缺货、另一家未交时禁止导出；后到低价主动采用后保留最终价并重置确认；同院三单参考、缺货与价差只读展示。
- [x] 生成 PDF/Excel，真实 PDF 通过页面下载；明确缺货行与 162.50 元总额保留。
- [x] 按 PDF 技能核对原始接口输出（内存渲染通过；落盘 Esafenet 文件未绕过，批准阅读器验收保留）；用修复后的页面完成医院确认、唯一应收、部分支付、更正、余额以及分析下钻；检查 mini H5 同账号数据、档案与管理员只读。
- [x] 记录截图和实际证据；PGlite/浏览器、标准 PostgreSQL CI、真实微信和云端验收分别记录。

## Task 4：复审、验证与同步

- [x] 每项需求审查→质量审查→修复复审；运行有意义的局部回归、全 UI、类型和全部构建；如未改后端，不无效重复后端离线测试，标准 PG CI 仍覆盖完整套件。
- [x] 功能修复已同步既有 PR #5，并核对同一文件树的标准 PG/界面/类型/构建 CI 通过；验收文档随本计划同步，最新文档检查以 PR Checks 为准。保留原主分支与本地提交备份，不自动合并。

实际操作及未验收范围见 `docs/browser-acceptance-2026-10-27.md`。两项修复需求和质量审查均通过；未操作的历史纸单核实、专项交接及外部服务不在本次页面通过范围。

2026-10-27 功能修复文件树 `45d3178bbbe10118796727ffd76360d457031544`（GitHub 提交 `dab1830fb11769241290ed308dd4055b38fb01ff`）已通过[标准 PostgreSQL 17.11 完整 CI](https://github.com/zeshi-liu/quote-system/actions/runs/40431804029)：API 280 项（279 通过、1 项 PGlite 专用跳过、0 失败），UI 370/370、类型及所有构建通过。之后仅同步本次验收文档；最新文档提交仍运行同一检查，以 PR Checks 对应提交为准。
