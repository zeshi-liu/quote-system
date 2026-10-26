# 回款台账与分次登记 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development，按任务实施，需求审查通过后再做质量审查。使用已确认设计，不重复审批。

**Goal:** 销售在 PC 和小程序查询订单应收，登记实际分次回款，并能留痕作废误录后重录，两端档案余额一致。

**Architecture:** 复用唯一订单应收；有效回款求和派生已收和余额，不维护可编辑余额。同单写入先用户/医院权限锁、订单根锁、应收锁，再单独查询有效合计；沿用持久幂等和未知结果查询。PC Cookie/CSRF 与 mini Bearer 使用同一服务权限。

**Tech Stack:** NestJS / PostgreSQL / Decimal、Vue3 / uni-app / TypeScript，复用当前工程及已批准回款原型。

## 依据、边界与实施选择

- 已批准依据：PRD v3 §§3.5、5.8、6.17、7.15、9 回款验收；第二部分事务设计§§3–5；第三部分接口§5.3；第四部分实际回款日期规则；`prototype-v3/receivables.html`、`receivable-adjustments.html` 中回款作废重录。
- 本批落实正常单已存在应收的查询、分次登记、误录作废及关联重录；报价完成仍可回款。应收为 0 的正常单显示已结清，全缺货不进入台账。历史补录、账期调整、催收异常/通知及凭证上传为明确后续批次，不造示例记录或已发送通知。
- 采用已确认的实时有效回款求和方案；不另建手工余额或拿审计 JSON 代替账本。原金额、日期、备注、记录人及记录时间不可覆盖或删除，作废只写状态和作废依据。作废不表示实际退款。
- 普通回款必须有真实日期，不晚于北京时间当前日；记录时间独立。金额满足 `0 < amount <= remaining`，使用两位小数精确字符串。不同端并发也不得超收。
- 只有当前订单负责销售员可写；医院现负责人只读旧单，管理员仅 PC 全量只读，无关销售/医院/厂家拒绝。每个 receivable/payment/corrects ID 重新追溯同单。
- 保留父级档案分支，基线 `98a5464090d552c6e4d43931484fde6845672a70`，新分支 `codex/receivables`。PR #3 尚未合并，本批不自动合并。

## Task 1：回款记录与一致 API

Files: 新增 `apps/api/migrations/005_payments.sql`、`apps/api/src/receivables/service.ts`、`queries.ts`、`apps/api/test/receivables.test.ts`、`packages/contracts/src/receivables.ts`；修改 app/controller、CoreStore、archive queries/projections/service 和 contracts exports。

- [x] 写失败集成用例并运行 `TEST_DB_MODE=pglite pnpm exec tsx --test apps/api/test/receivables.test.ts`，先验证缺失端点确实失败。
- [x] 迁移 payment_records：UUID 主键，应收外键，正 NUMERIC(12,2) 金额，实际 DATE、录入时间和署名快照，active/void 状态，作废原因/人/时间、可空同单更正引用；禁止删除及改变原始业务字段。为有效求和建索引。不在普通请求中接受自选 historical_opening；未来历史类型的更正必须从被更正记录确定类型，不能伪造支付日期或重复累计。
- [x] GET `/sales/receivables` 及 `/:id`：医院、接收日期、keyword、归属、paymentState(unpaid/partial/settled)、dueState(upcoming/due/overdue)、分页 1/20（上限50）；单 SQL 返回总数和本页，按到期日/单号/id 稳定排序，账号和日期时点在权限等待后获取。列表只查实际应收，detail 返回全部有效/作废记录、当前余额和可写权。
- [x] POST `/sales/receivables/:id/payments`：strict amount、paidDate、可选 remark、correctsPaymentRecordId；POST `/:id/payments/:paymentId/void`：strict reason。二者必须 Idempotency-Key，结果包含 orderId 供未知结果重查再次授权。
- [x] CoreStore 仅为这两个明确回款操作放行 completed；voided 仍拒绝，不泛化完成订单可写。根锁后锁应收，重新求和、精确校验余额，再写记录、审计和 rowVersion。重复同键同内容回执不再记账；同键不同内容409；重复作废不扣两次；跨单或非已作废的更正引用拒绝。
- [x] 复用查询投影，档案列表/详情的 paid/balance/state 和 payments 改用真实记录；审计允许清晰显示登记/作废及金额日期和理由，不泄露会话或文件密钥。使用有效金额判断到期/逾期，而非原应收。
- [x] 断言示例：应收100→登记40→有效已收40/未收60→重复请求仍40→登记70拒绝→登记60结清→作废40保留原记录、余额40→重录35余额5。0、负数、三位小数、未来/无效日期、空原因、结清追加、跨单ID、A/B/C/admin/PC CSRF全部覆盖。
- [x] 原生 PostgreSQL 下两个不同请求并发登记各80、应收100时仅一笔成功；同时作废/新增仍无负余额；PGlite 串行验证不替代此原生测试。测试不得使用睡眠猜时序，必要时使用确定性的 SQL 锁屏障。
- [x] 完整 API 回归、类型检查通过并提交。独立需求审查→修复复审→质量审查通过后，进入 Task 2。

## Task 2：PC 与小程序真实台账

Files: 新增 `packages/receivables-client/` 的共享状态与测试，`apps/pc/src/components/Receivables.vue`，`apps/mini/src/components/Receivables.vue`；修改 PC App、mini index 及相关 scripts/lock/contracts 使用方，档案面板真实回款记录展示。

- [ ] 先写失败状态测试：金额/日期/原因校验、筛选和页码、无权只读、记录和复核内容绑定、同 key 重试及未知结果保持原输入和 key；未知不得按失败换 key 录第二笔。
- [ ] 两端增加回款入口、真实分页筛选、详情应收/有效已收/未收/到期、有效与已作废记录和原署名，保持现有档案四主分栏。新建回款有金额、实际日期、备注，先复核后提交；超额提示核对金额或订单，不能截断。
- [ ] 作废须先选择有效记录，必填原因，复核原金额/日期/余额变化；成功后新建重录可以关联原作废记录，保留两次动作。不得将作废当退款，不提供覆盖/删除。不能只靠隐藏按钮防越权。
- [ ] PC 接入真实 Cookie/CSRF mutating POST，管理员/非订单负责人只读；mini 沿用真实销售身份。未知结果通过 `/operations/:key` 轮询/手动核对，显示已提交结果或明确未找到后沿用同 key 复试。读取失败不保留另一订单，切换/离页取消旧响应影响。
- [ ] 保存后重新读取详情及余额；档案入口重新加载能读同一账本。到期/逾期与结清独立显示；不提供未接入通知、异常或附件的成功演示。
- [ ] 前端回归、全工程类型检查、API/PC/MP/H5 构建通过；独立规格审查→修复→质量审查。只在虚构隔离数据中浏览器验证，不操作真实收款或对外通知。

## Task 3：交付及验证分层

- [ ] 更新实际启动、功能边界与结果记录；本地 PGlite、浏览器、标准 PostgreSQL CI、真实微信/COS/云分别报告。
- [ ] 同步 `codex/receivables` 并建立基于 `codex/order-archive` 的草稿 PR；CI 同时覆盖新 branch/stacked PR，最终文件树核对一致。不自动合并。
- [ ] 最终集成审查通过，列出本批事实与后续通知/账期/补录边界，保留工作树供继续开发。

## 计划自检

已覆盖同单完成后回款写入的窄放行、同单锁与应收锁顺序、幂等重查授权、两端支付未知结果、历史档案实时投影、金额与到期分开、误录作废不可篡改与独立原生并发验收。依据已有批准设计开展开发，不改变 PRD 版本或将本机验证当作真机/生产验收。
