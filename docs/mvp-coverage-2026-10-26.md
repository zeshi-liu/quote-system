# PRD v3 工程覆盖与验收边界

需求基线：[PRD v3](quote-system-prd-v3.md)，技术与业务口径沿用已确认的五部分设计。本表记录工程实现，不能代替第 18 节完整 MVP 的真实交付验收。当前开发分支为 `codex/mvp-completion`，草稿 [PR #5](https://github.com/zeshi-liu/quote-system/pull/5) 依赖尚未合并的 PR #2/#3/#4；本轮未自动合并主分支。

## 功能与证据映射

“本地通过”指隔离虚构数据、PGlite 串行、组件或脚本测试；“标准 PG”必须查看下方对应文件树的 GitHub 实际结果。未配置的真实服务明确失败或显示未配置，不返回演示成功。

| PRD 条目 | 工程入口与已实现规则 | 可重复验证 | 尚需验收 |
| --- | --- | --- | --- |
| 6.1、3 角色与身份 | `auth/`、医院身份适配、PC Cookie/CSRF、mini 角色分流；预建账号、限时个人密码设置、可撤销会话，管理员仅 PC | `pc-auth.test.ts`、`flow.test.ts`、`hospital.test.ts`、`master-data.test.ts` | 真实 AppID、手机号授权及微信绑定/解绑、微信工具和真机 |
| 6.2–6.5 双入口采购 | 医院只见本人正常需求；医院提交不可变原始快照，销售代录来源标签；原单、手工、商品库、解析候选，逐行核对、200 行上限、固定 kg | `hospital.test.ts`、`source-files.test.ts`、`line-limits.test.ts`、双端组件测试 | 拍照、相册、多图和长表真机操作；真实样单 |
| 7.9 采购修订与作废 | `PurchaseLifecycleService`；下一修订、不回退旧版，完整来源保留；旧链接及报价失效；已有应收/确认或导出结果未明不能绕过 | `purchase-lifecycle.test.ts`、`extensions-http.test.ts` | 两端真实网络中断及多人操作 |
| 6.6–6.8、7.1/7.10 厂家 | 两任务位、48 小时链接、只存 token 哈希、重生成旧链接失效、H5 逐行完整提交、有效至日、重询保留历史，严格原规格/kg | `flow.test.ts`、H5 及 mini 回归 | 手机浏览器厂家填写及断网恢复 |
| 6.9、7.2–7.7 计价 | 最低有效价、主动采用后到报价、三种加价/手工价、选中行/批量/撤销、最终价确认、亏损原因、金额精度及日志 | `money.test.ts`、`flow.test.ts`、双端领域/组件测试 | 两名销售实际长表使用手感 |
| 6.15、7.8 同院历史 | 按采购根单取确认优先/否则最新有效已发送代表版；缺货空价保留，当前价差及比例只读展示，不自动采用 | `archive.test.ts`、共享 archive-client 及 PC/mini PriceHistory 测试 | 商品规格 ID 优先、同商品同规格文本、同商品降级及明确差异已贯通；真实资料匹配仍需销售验收 |
| 6.10、7.11 报价交付 | `delivery/`、两端 QuoteDelivery；默认模板/冻结 logo 元数据、PDF 多页/Excel、持久队列/租约/栅栏、首次成功冻结、已导出/发送/确认分离、真实确认时间补录 | `delivery.test.ts`、`render.test.ts`、`template-export.test.ts`、`worker.test.ts`、`extensions-http.test.ts` | 正式公司模板、真实 WPS/Excel、COS 文件、云端 worker |
| 7.7/7.11 全缺货 | 原采购行保留、单价/金额为空、总额“不适用（全部缺货）”；医院知悉后销售完成，不建应收 | 交付、档案、历史、统计测试 | 医院实际业务样单 |
| 6.16 档案 | PC/mini 分页与筛选、原单/修订/提交/报价/文件/发送确认/审计/回款完整链路，医院交接后新销售旧单只读 | `archive.test.ts`、共享 archive-client、两端查询组件测试 | 正式资料的检索与浏览 |
| 7.18、7.21 历史纸单 | 专用入口、可暂存缺资料；药品/采购量/日期/原账期/金额/核实依据齐全才生效；逐行结果/日期未知留空；累计已收允许日期未知，金额更正留痕且不低于有效已收 | `historical.test.ts`、`HistoricalOrders`、共享 historical-client 测试 | 销售用真实纸单核实资料与金额 |
| 6.17、7.15 回款 | 确认金额建立唯一应收、分次登记、阻止超额、作废关联重录、余额实时重算、当前负责人写/管理员只读 | `receivables.test.ts`、台账与共享 receivables-client 测试 | 真实业务流程验收；系统不代转账 |
| 6.13、7.15/7.19 账期与异常 | 医院默认 90 天仅销售维护、新单快照；单笔留痕调整；异常暂停催收/原负责人核实解除，不自动冲销退款 | `finance-control.test.ts`、`FinanceWorkspace`、共享 finance-client 测试 | 真实账期样例与线下处理流程 |
| 6.17 提醒 | 北京时间到期当天起、逾期每日，09:00 当日评估、去重；发送前重查余额/当前责任/异常/授权；微信未知不自动重发 | `finance-control.test.ts`、reminder worker、订阅接口/组件 | 类目/模板/授权额度、真实接收与失败情况、云端调度 |
| 6.18、7.16 五类分析 | 两端医院次数、需求/确认量、周/月趋势、药品规格排名、明确缺货；最新冻结需求按原接收期，确认另口径、未知覆盖、空期间补零；持久快照与权限失效、下钻一致 | `analytics.test.ts`、共享 analytics-client、PC/mini 图表组件 | 实际数据量、手机图表触摸与业务对账 |
| 6.11–6.14 基础资料 | 管理员 PC 账号/医院/采购员/厂家/商品别名规格/默认模板；销售只读资料及权限内账期维护；来源价隔离 | `master-data.test.ts`、`AdminWorkspace`/`CatalogPanel` 测试 | 正式基础资料初始化 |
| 6.12 来源批次 | 私有原件、表格/手工预览映射、异常行、关联商品规格、唯一系统批次号；确认不可覆盖，只能整体作废，原校对依据保留 | `master-data.test.ts`、`source-files.test.ts`、`SourceBatches` 测试 | 真实厂家 XLS/XLSX/CSV 样本 |
| 3.6、6.19 专项交接 | 管理员限定例外：持久短凭证预览精确范围、执行时锁后重查、当前责任/提醒转交、旧署名金额不变，完成后停用并撤销会话 | `master-data.test.ts`、`HandoffDraft` 和管理员组件测试 | 两人实际交接演练 |
| 10 文件与解析 | 私有文件、20MB/图片20张、引用绑定、原件不可覆盖；CSV/XLS/XLSX 安全解析，禁公式/宏/外链；OCR 真实适配、总预算/租约代次、未知人工核对、候选不自动冻结 | `source-files.test.ts`、`SourceFiles`、source-client 测试 | 真实 COS、OCR 权限/样单/准确率与费用 |
| 10.4 请求与权限 | 同单锁、持久幂等、版本检查、回执重授权；结果未知保留原 key/输入/原文件，PC 跨标签页占用锁；原生 PG 并发测试与离线结果分开 | API 各领域测试、`business-pending.test.ts`、source/历史/回款恢复测试 | 真实网络/云端故障与会话联调 |
| 6.4 首页与站内角标 | PC A 待办与 mini 工作台共用六阶段/回款全量统计；两端新采购/厂家提交角标、精确事件已读持久化 | `dashboard.test.ts`、PC/mini 工作台测试 | 手机手感、正式数据和两端提示使用习惯 |
| 第五部分部署设计 | `deploy/`、部署手册、非 root/资源限制、私有 COS、迁移/首管理员、导出/解析/提醒 workers、每小时加密异机备份、隔离恢复、新鲜度与安全阶段日志、可配置失败告警 | `deployment-scripts.test.ts`；YAML 静态及命令检查 | Docker/systemd 实际启动、云资源/域名/HTTPS、真实外发告警、恢复点/服务恢复目标演练 |

## 验证状态

- 最终功能代码及首版覆盖文档的文件树 `057c19dfe78783809786f9299fad91e160b0992e` 已通过 [标准 PostgreSQL 17.11 CI](https://github.com/zeshi-liu/quote-system/actions/runs/40313328246)，对应 GitHub `638f74beaba0290d868942fd88c9ef95b09dcd27`。API 280 项（279 通过、1 项 PGlite 专用跳过、0 失败），UI 338/338、类型检查与全部构建通过。随后仅补充本段验收记录，不改变功能代码；最新文档提交的 Checks 仍可在 PR 查看。
- 当前代码 `04a5f27` 已执行完整本地回归：API 280 项（272 通过、8 项原生 PostgreSQL 专用跳过、0 失败），界面 338/338 通过，全部类型检查与 API/小程序微信包/mini H5/厂家 H5/PC 构建通过。构建仅保留 Vite CJS 弃用提示。新工作台及明确拒绝/未知响应的恢复保护已完成独立复审，未发现未关闭的 P1/P2。下方标准 PG 结果对应本轮同一功能代码。
- PGlite 单连接不能证明行锁竞争；普通 HTTP 200、静态页面、适配器 fixture、构建成功均不能证明外部服务或正式环境成功。
- 本机浏览器已检查虚构账号登录与 PC 待办汇总；后续采购冻结按钮处浏览器控制连接持续超时，未取得这轮完整人工浏览器闭环证据。此前各阶段已注明日期的浏览器证据保留，不能外推到本轮最终树。

## 可重复检查

仓库根目录，Node.js 24、pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm test:offline
pnpm test:ui
pnpm typecheck
pnpm build
```

标准 PostgreSQL 使用独立 `quote_core_test`，设置 `TEST_DATABASE_URL` 后运行 `pnpm test`。测试以随机 schema 隔离，不能给正式业务库的连接串。启动、试用账号与真实小程序准备见 [试用指南](mini-core-trial-guide.md)，正式环境按 [部署手册](deployment-runbook-v1.md) 的预检、迁移、最小权限、失败记录及隔离恢复步骤执行。

## 仍需外部条件和真实验收

1. 注册后的 AppID/主体权限、服务端秘密、微信手机号能力、订阅模板与逐次授权。小程序管理员入口不开放，医院不看价格/厂家/回款；无授权不承诺每日微信通知。
2. 腾讯云地域/配置/预算、域名/HTTPS、私有 COS 与 OCR 最小权限凭据、备份桶/加密接收者/维护人、运维告警目标；本轮不购买、不部署、不外发真实消息。
3. 实际两名销售的微信真机长表、键盘、触摸/滚动、文件下载分享与图表；云端标准 PG 并发和资源负载、Docker/systemd、真实备份/隔离恢复。最多约 2 小时数据恢复点与 4 小时服务恢复均为待演练目标。

这些条件补齐后逐项联调，第 18 节交付定义全部取得真实证据后才可宣告完整 MVP 上线验收完成。
