# 报价交付闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 按任务使用新实施者与独立需求、质量审查，先写失败测试。

**Goal:** 将现有真实采购、询价、计价连接至 PDF/Excel 导出、线下发送登记、医院实际确认和唯一订单应收。

**Architecture:** API 事务只准备与绑定导出，PostgreSQL 持久任务由独立 worker 领取；渲染在限时限内存子进程中运行。医院文档仅含公开字段，首次成功绑定后按快照导出。小程序和 H5 调用同一服务，未注册微信不阻塞工程实施。

**Tech Stack:** NestJS / PostgreSQL / uni-app / PDFKit / ExcelJS / 腾讯 COS SDK。开发可显式使用私有本地文件目录；不得声称已完成 COS 和微信真实验收。

## 依据和本次边界

沿用 PRD v3 §§4.6–4.9、5.1、5.7、6.10、7.7、7.9–7.12，事务设计 §§5–7、身份权限 §6.2、时间边界 §§4.1/4.3及已批准原型。本批不包含回款编辑、历史补录、统计、医院在线确认或完整 PC 管理端。人工标记发送不发送微信消息。

固定约束：北京时间有效至日包含当天；两家明确缺货保留行，全缺货总额 null、不建应收；所有价格行基准有效、最终价已确认，低于基准须原因和本次导出风险确认。PDF/Excel 同一报价版本。医院确认可选任一合格已发送版，实际时间不早于首次成功导出、不晚于现在、在有效期内且严格早于基准失效；跨日补录或当前已过期/失效须原因。确认后其余未发送版作废并取消占用，唯一应收以最终总额建立，到期日为实际接收日加保存的自然日账期。

## Task 1：合同与数据库/业务 API

Files: `packages/contracts/src/delivery.ts`, `apps/api/migrations/002_delivery.sql`, `apps/api/src/delivery/service.ts`, `apps/api/src/delivery/export-store.ts`, `apps/api/test/delivery.test.ts`；修改 database、app、controller、pricing、suppliers、read-model。

- [x] 写失败集成测试：保存计价后 `POST /quotes/:q/versions/:v/export` 返回 202 且草稿占用；失败可重试但不冻结；成功冻结；PDF/XLSX 同一快照；全缺货不建应收；确认 V1 作废未发送 V2；失效前确认可补录，失效后不可新确认；并发确认只建立一笔应收、越权和重复键均不能绕过。
- [x] 运行 `TEST_DB_MODE=pglite pnpm test`，确认新增断言因缺失接口失败。
- [x] 编写 002 增量迁移；migrate 顺序读取全部数字前缀 SQL 并核对每个校验和，绝不修改 001。根锁后重读状态与时间。唯一确认指针、唯一订单应收、冻结内容数据库保护、同单幂等留痕。
- [x] API 契约固定：GET quote versions、GET version preview、POST export `{expectedVersion,format,lossAcknowledged}`、GET jobs、POST mark-sent `{expectedVersion,channel,remark}`、POST confirm `{expectedVersion,hospitalConfirmedAt,backfillReason}`、POST create-next `{expectedVersion,reason}`、POST void `{expectedVersion,reason}`、POST files download-url。
- [x] 导出准备保存公开 document + 私有证据和快照哈希，active_export_id 与 generation 栅栏；10 分钟总期限包含排队/重试。任务运行成功绑定须锁后重校验来源、修订、版本与时间；不可复活被作废/确认/超时任务。读任务和下载均重新验证订单权限。
- [x] 跑新增测试和原核心测试，通过后提交。

## Task 2：真实文件、独立 worker 与资源上限

Files: `apps/api/src/delivery/render.ts`, `storage.ts`, `worker.ts`, `render-child.ts`, `apps/api/test/render.test.ts`, `scripts/delivery-worker.ts`, package / CI 配置。

- [x] 先写 `renderQuote(document,format)` 失败测试，校验文件签名、XLSX 单元格、全缺货 null 与长中文行；先看到缺模块失败。
- [x] 使用共享 `QuoteDocument`；PDF 中文字体路径可配置且不捆绑 Apple 字体，动态分页/重复表头/页码；XLSX 写静态已舍入金额，公开字段不包含厂家价或亏损原因。
- [x] 独立 worker 获取数据库全局重任务租约，仅 1 个同时运行。子进程 `--max-old-space-size=1024`、执行最多 5 分钟；重试上限 3 次，30s/120s 抖动且不超过最初 10 分钟。故障恢复释放自己代次的占用；独立对象键包含任务/代次；仅清理超过 24h 且无绑定无活跃租约对象。
- [x] 本地存储仅非生产显式启用，文件服务走 5 分钟随机票据；生产使用私有 COS、签名 URL。文件命名医院+报价号+版本，下载只允许成功绑定文件，内容哈希核验。
- [x] 实际导出普通、长单和全缺货 PDF/XLSX，PDF 渲染 PNG 逐页抽查表头/中文/页脚，XLSX 重新打开核对金额与缺货空值，测试通过后提交。

## Task 3：销售小程序真实交付页面

Files: `apps/mini/src/components/QuoteDelivery.vue`, `apps/mini/src/delivery-domain.ts`, `delivery-domain.test.ts`、index.vue、api.ts。

- [x] 先写失败测试，确认时间带时区转换、过期/未知结果不得显示成功、全缺货金额文案。
- [x] 新组件显示版本选择、真实预览表、导出任务刷新、受控下载、线下发送登记、实际确认时间与补录原因、新版和作废。编辑前必须退出占用或等待任务；服务端成功回执才改变状态。
- [x] 沿用 `mutate` 原幂等键的未知结果核对；不自动轮询业务写接口，离页停止任务轮询；错误后保留用户输入。不依赖 AppID 的 H5 先联调，小程序包独立编译。
- [x] 浏览器跑采购至确认真实 API 流程，并下载真实两格式文件；确认后订单只读且应收正确。运行 typecheck、test:ui、build 后提交。

## Task 4：复核、说明与 GitHub

- [x] 分别安排独立需求审查、代码质量审查；修复有证据的问题后重跑相关回归。原生 PostgreSQL CI 验证锁等待、栅栏与唯一应收，不用本地 PGlite 替代。
- [x] 更新试用说明、环境变量与逐项证据；明确微信、COS、腾讯云 HTTPS、真实通知尚未验收。
- [ ] 同步 `codex/quote-delivery`、创建并附加草稿 PR，检查 CI；不擅自合并主分支。

## 计划自检

已逐项映射导出占用、文件快照、基准失效、补录时间、唯一应收、未发送版本作废、后台资源限制和权限。公开 `QuoteDocument` 与私有证据分离，金额为精确十进制字符串；版本号 `versionNo` 与乐观锁 `version` 分离。复用已确认设计，不引入业务口径变更。

## 独立审查后的实施修正

- 允许普通导出跨自然日，保留准备日期；只在实际有效期截止、原10分钟期限或依据变化时拒绝绑定，避免把“跨有效期截止”误解成一律禁止跨午夜。
- 旧采购修订不可作废历史报价；当前活动报价全部作废后可创建新V，原作废版不恢复。
- 含价格且舍入总额0.00可正常确认、应收余额为0；全缺货为null且不建应收。
- 未知导出回执先保存原任务引用再清pending；版本详情返回服务端latestJob，跨设备及失败结果同样可恢复。
