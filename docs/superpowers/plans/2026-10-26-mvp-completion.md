# PRD v3 剩余可开发功能实施计划

> 使用 superpowers:subagent-driven-development。各任务先读取对应已确认规则、写失败测试，再实施；需求审查通过后进行独立质量审查。用户已于 2026-10-26 授权持续推进全部可开发范围，不重复索取已确认设计的批准。

**Goal:** 完成 PRD v3 中不依赖用户注册、购买云资源或提供真实凭据的工程功能，并把真实微信、OCR/COS/HTTPS 接入及恢复演练与代码验收分开记录。

**Architecture:** 沿用 NestJS/PostgreSQL、Vue PC、uni-app、厂家 H5。保留现有报价与回款账本；新增服务按领域隔离，HTTP 集成由主任务统一维护；同单金额与状态写入继续锁后校验、持久幂等和留痕。正常单、历史补录、医院端及管理员例外权限分别校验。

**Tech Stack:** 当前锁文件中的 TypeScript/Vue/uni-app/NestJS/pg/Decimal/ExcelJS。仅在已安装依赖无法实现 PRD 格式时增加必要解析依赖，先核实官方接口及许可，不关闭安装检查。

## 基线与工作区

- 基线 `f003a9606ccd94ea004bdd7dd0dd74f5ed6dab07`，已通过标准 PostgreSQL CI；新分支 `codex/mvp-completion`，复用当前已附加隔离工作树。原始工作区 main 不修改。
- 保留 PR #2/#3/#4，不自动合并；完成阶段检查后同步新的草稿 PR，最终树须与本地已测文件一致。
- 不把实现模板或适配器等同真实外部服务成功，不预埋真实数据、秘密或模拟的通知成功状态。

## Task 1：账期、催收异常、每日提醒后端

Files: `apps/api/migrations/006_finance_control.sql`；`apps/api/src/finance-control/`；`packages/contracts/src/finance-control.ts`；`apps/api/test/finance-control.test.ts`；`scripts/reminder-worker.ts`。

- [ ] 医院当前负责销售可维护默认账期（0–3650 自然日）；管理员/医院拒绝，旧单快照不改。当前订单负责人可调整单笔账期，expectedVersion、原因必填，原始快照及前后到期日留痕；应收存在时同步到期日，金额不改。
- [ ] 当前订单负责人登记取消/退款异常、留痕核实后恢复；有效异常唯一，暂停期间仍可查台账，账期及支付动作不自动解除，管理员只读。
- [ ] 按北京时间到期列表 00:00 生效；每日 09:00 起只评估当日，同订单/渠道/自然日唯一；结清/作废/异常不催收。发送前重查负责人、余额及异常，未知微信响应不得自动重复发送。
- [ ] 真实微信订阅适配器与授权记录可配置；无凭据/模板/授权时明确 unavailable/skipped，站内待办不隐藏。提供独立 worker 命令，不在 HTTP 请求中隐式给外部发消息。
- [ ] API 拟定：`POST /sales/hospitals/:id/payment-term`、`GET/POST /sales/purchase-orders/:id/payment-term-adjustments`、`GET/POST /sales/receivables/:id/exceptions`、`POST .../exceptions/:exceptionId/resolve`、`GET /sales/receivable-reminders`。
- [ ] 失败→通过测试覆盖 A/B/C/admin/hospital、0 天、跨午夜、结清/作废、并发幂等、异常暂停/解除、当日去重和重试前复查。

## Task 2：基础资料、管理员及专项交接

Files: `apps/api/migrations/007_master_data.sql`；`apps/api/src/master-data/`；`packages/contracts/src/master-data.ts`；`apps/api/test/master-data.test.ts`；内部账号初始化命令。

- [ ] 管理员 PC 维护账号、医院、采购员、厂家、标准商品/别名/规格及报价模板；资料采用版本校验和审计，管理员不能从医院资料接口修改账期。
- [ ] 账号临时密码一次展示、仅存哈希、限时设置新密码；重置撤销全部旧会话。禁止停用最后有效管理员；销售仍有待办/负责医院时拒绝直接停用。
- [ ] 商品与规格扁平查询、启停、别名；厂家来源批次手工/表格预览、字段映射、确认、整体作废，确认后不可覆盖，来源价不进入计价。
- [ ] 管理员专项交接预览与执行：仅未完成/未收齐/异常/待核实事项，固定锁顺序，复查后停用；新医院归属维护、当前责任转交、原始署名保留，不更改价格/状态/金额。
- [ ] 独立服务直接集成测试，HTTP 挂接交主任务；不得另造销售主管权限。

## Task 3：私有原单上传、Excel/CSV/XLS、OCR 与解析

Files: `apps/api/migrations/008_source_files.sql`；`apps/api/src/source-files/`；`packages/contracts/src/source-files.ts`；`apps/api/test/source-files.test.ts`；解析 worker 命令。

- [ ] jpg/jpeg/png/xlsx/xls/csv 白名单、内容嗅探、单文件 20MB、采购图片最多 20 张，绑定上传人及业务对象；签名短期下载不得放宽历史资料及医院权限。
- [ ] Excel/CSV/XLS 预览、字段映射、无效行和错误说明；禁止执行公式、宏及外部链接，解析候选不自动冻结或计入统计。
- [ ] 图片 OCR 使用可配置真实适配器；缺凭据返回未配置，失败可重试并手工兜底，限资源与超时。重试幂等，候选结果须人工校对。
- [ ] 正常销售/医院、历史附件、来源文件、回款凭证分清权限；通用文件上传不提供跨单引用通道，文件链接不得暴露内部成本给医院。
- [ ] 复用现有私有 ObjectStorage；COS 真实上传/下载及受保护本机文件系统验收保留外部边界。

## Task 4：历史纸单补录与核实

Files: `apps/api/migrations/009_historical_orders.sql`；`apps/api/src/historical/`；`packages/contracts/src/historical.ts`；`apps/api/test/historical.test.ts`；档案投影及回款关联适配由主任务协调。

- [ ] 专用 entryMode，内部暂存/核实；正常订单不能伪装历史跳过报价。明细、需求 kg、实际接收日期、原账期、最终金额及核实依据/说明必填；附件可选。
- [ ] 原账期未知保持待核实，无正式应收/提醒/统计；逐行确认数量、缺货及实际确认日期未知允许核实，未知保持 null。
- [ ] 核实只建一笔应收；历史累计已收可无实际日期、不得超额，0 不建支付；不伪造厂家/医院报价链路。
- [ ] 已核实金额更正仅当前负责人，原因及独立核实依据/说明必填，新金额不低于锁后有效已收，完整留痕；不作为退款或正常单改价入口。
- [ ] 历史源在医院端列表、详情、文件、回款全部拒绝，非仅隐藏菜单。

## Task 5：五类分析与查询快照

Files: `apps/api/migrations/010_analytics.sql`；`apps/api/src/analytics/`；`packages/contracts/src/analytics.ts`；`apps/api/test/analytics.test.ts`；PC/mini 图表组件。

- [ ] 五类：医院要货次数、需求/确认数量、周/月趋势、药品规格排名、明确缺货；实际接收同批与实际确认日期趋势分别返回。
- [ ] 正常单最新冻结修订，未冻结草稿沿用上一冻结；同根 ID 去重，排除整单作废和从未冻结；全缺货需求保留，待确认不算缺货。
- [ ] 历史核实需求计入；未知结果/确认日期不按 0/当前日期伪造，返回覆盖数据。单位 kg，金额精确十进制。
- [ ] 图表及下钻使用服务端持久快照、同一筛选/权限/截止；过期与权限变化重新校验，不暴露失权医院。

## Task 6：医院轻量端与双入口

Files: `apps/api/src/hospital/`、医院身份适配、`apps/mini/src/components/HospitalWorkspace.vue`、相关测试。

- [ ] 微信手机号 code 只匹配管理员预建启用采购员；不公开注册、不凭客户端明文手机号授予身份；真实接口缺凭据明确拒绝。
- [ ] 医院能创建和修改自己的草稿，通过图片/表格/商品库/手工四种方式提交；提交后交销售校对，销售代录归采购员可见。
- [ ] 医院只见自己的原始需求和简化状态，不能见厂家成本、加价、最终报价、导出文件、回款或历史补录；系统重查本人/医院/启用身份。

## Task 7：PC 完整工作台与双端功能接入

Files: `apps/pc/src/components/`、`apps/mini/src/components/`、共享请求状态模块及对应前端测试。

- [ ] PC 完成首页待办、采购校对并排原单、厂家询价表格、计价和批量加价/撤销、导出/发送确认、报价历史与订单作废/采购修订等已有后端操作；复用核心业务契约。
- [ ] PC/mini 均接入账期、异常、历史补录与分析；管理员 PC 维护页及专项交接、销售默认账期页、两端提醒入口。
- [ ] 写操作结果未知持久保留同 key/输入，刷新/会话失效/迟到响应不能覆盖其他单；权限由服务端保证。表单给出真实验证错误，不提供仅演示的成功分支。
- [ ] 沿用已批准原型；移动表格局部滚动，原单在手机单独页签；真实微信手感待 AppID 后真机验证。

## Task 8：部署脚本、完整审查与真实接入清单

Files: `deploy/`、`scripts/`、`.env.example`、README、AGENTS、实际试用及验收说明。

- [ ] 腾讯云单机部署配置、HTTPS 反向代理模板、资源限制、私有 COS、迁移/初始化、定时 workers、每小时异机备份及恢复脚本；脚本有自检与失败记录，不购买或部署真实资源。
- [ ] 每阶段 `pnpm test:offline`、`pnpm test:ui`、`pnpm typecheck`、`pnpm build`；金额/权限/并发等用例须有原生 PostgreSQL CI。增加功能测试验证真实边界，不以实现镜像断言代替验收。
- [ ] 分模块独立需求审查→质量审查→修复复审；最终隔离虚构数据浏览器跑完整闭环，包含医院、管理员与两端余额/图表，微信外部能力单列。
- [ ] 同步 GitHub 并确认最终 CI、文件树及本地清洁；交付逐项覆盖表，明确代码完成、配置阻塞、真实验收待办。不将整份 PRD 在未核对时标为全部完成。

## 外部依赖记录

真实 AppID/主体与微信手机号/订阅模板权限，腾讯云资源/域名/HTTPS、COS 桶与最小权限凭据、OCR 凭据及真实样单、采购预算及备份维护负责人尚未提供。工程使用可注入测试适配器验证协议与失败语义，默认不调用或发送真实外部通知；提供配置后再逐项真实验收。
