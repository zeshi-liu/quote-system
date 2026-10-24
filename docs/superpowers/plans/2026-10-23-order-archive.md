# 历史订单档案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 逐项测试先行，实施后分开做需求符合性与代码质量审查。

**Goal:** 销售在 PC 和小程序长期分页查询医院历史订单，追溯采购修订、厂家提交、报价文件、确认及已有应收。

**Architecture:** 复用现有订单关系，不创建归档副本。列表单 SQL 快照返回总数和当前页；详情持有原订单读锁，所有权限按当前账号、医院归属和订单负责人重新核对。PC 增加内部密码会话，小程序沿用现有身份。

**Tech Stack:** Vue3 / uni-app / NestJS / PostgreSQL，复用当前 Vue/Vite/TypeScript 版本，不引入新的存储或消息服务。

## 已批准依据与边界

PRD v3 §§3.5、6.15–6.16、7.8、7.12、9.12–9.13及10.5；2026-10-20 已批准 order-archive 原型；PC账号密码和身份权限设计第三部分已批准。用户已指令继续开发，沿用原口径，不重复审批既有设计。

本批只读档案及价格参考，不包含历史补录、回款编辑/异常、统计、原单上传/OCR或完整PC业务写界面。原资料未上传时返回空附件，显示“暂无原始附件”；回款表尚未实施，展示真实已建应收且明确当前无登记记录，不伪造支付或附件。

当前手工品名缺商品库ID，历史价格只支持同院、完全相同品名/规格文本/kg，并标注“文本匹配参考”，不声称商品库精确匹配。先为每单取已确认优先、否则最近已发送且未作废代表版，再匹配行及取最近3单；同代表版多同名行保留多行，不任意挑价。排除当前订单，绝不回填当前最终价或推荐价。

## Task 1：只读API、PC会话与署名

Files: `apps/api/src/archive/service.ts`, `queries.ts`, `apps/api/migrations/003_archive.sql`, `apps/api/test/archive.test.ts`；修改auth、store、controller、app及contracts。

- [x] 先写失败集成测试并运行：`TEST_DB_MODE=pglite node --import tsx --test apps/api/test/archive.test.ts`。断言分页超过100单可访问；医院/包含首尾的实际接收日期/单号或历史修订药品/业务状态/归属/应收筛选；无权限不返回总数、医院选项或详情。
- [x] GET `/sales/order-archive` 接受 ArchiveFilters，page默认为1、pageSize20且上限50；日期用既有真实日期校验，结束不早于开始。keyword最长100字符，SQL参数化并将%/_/反斜线按字面检索。同一SQL返回total和pageitems，排序receivedDate DESC、orderNo DESC、id DESC。
- [x] GET `/sales/order-archive/hospitals` 返回所有可读订单/当前医院的医院选项，不使用仅当前负责医院的bootstrap替代；GET `/sales/order-archive/:id` 返回完整修订、所有厂家提交（含替代历史）、报价快照/成本链/导出/发送/确认、审计和真实应收。不返回link token/session/tokenHash/objectKey/download票据等凭证。
- [x] GET `/sales/price-history?hospitalId=&name=&spec=&unit=kg&excludeOrderId=` 按上述代表版规则返回至多3个订单。先选代表版再匹配，缺货保留null，不以较早V的同商品补替代表版。只读权限与原订单一致。
- [x] 新PC登录POST `/auth/pc/password-login` 接受同一内部账号密码；sales/admin可登录，医院不得登录PC管理端。channel pc最长7天、闲置8小时，可撤销；小程序绑定/试用登录仍仅销售。`/auth/me`与logout支持合法PC身份；管理员仅pc会话可访问内部只读路由，其他销售业务写接口继续拒绝。
- [x] 严格沿用已确认身份设计§2.2/§3：PC使用HttpOnly、Secure、SameSite=Lax、Path=/、无Domain的`__Host-quote_session`，不将PC会话token返回浏览器脚本或写localStorage；仅非生产HTTP本机使用明确独立的开发Cookie名。GET `/auth/csrf`绑定预会话/用户会话，登录后轮换，PC全部变更请求含登录、退出及下载授权POST都校验允许来源和CSRF。Cookie与Bearer通道不可互用或失败后兜底。角色变更须使旧会话失效，不能让旧销售PC会话升级为管理员权限。独立需求审查发现初稿遗漏，按既有确认补齐，无新增业务审批。
- [x] 迁移003给auth_sessions通道增加pc、给audit_records添加可空actor_name_snapshot及只读检索索引。新audit写入当时姓名，旧记录不伪造历史署名，返回actorNameSource=current_profile并在界面标注历史姓名未留快照。CoreStore.root只对admin pc开放读取，write仍仅订单负责销售；下载票据恢复actor时保留可信session channel。
- [x] 回归覆盖A旧单/B医院交接、无关C、管理员pc全量只读、admin mini拒绝、撤销/停用/闲置/7天过期、下载同权限且管理员不能修改价格/回款。确认过期失效历史仍可查，不用当前草稿覆盖冻结版本。
- [x] 新价格参考测试：同单V1/V2/V3只占1条，confirmed优先，未发送导出与void排除，代表版不含药品时不回退旧V，缺货null、0.00金额与无应收分开。
- [x] API回归和类型检查通过，提交本任务文件。

## Task 2：PC档案与小程序历史入口

Files: `apps/pc/`（Vue3/Vite实际PC工程），`apps/mini/src/components/OrderArchive.vue`, `archive-domain.ts`, tests，index.vue；root build/typecheck纳入PC。

- [x] 先写失败单测：构造查询URL/重置页码，失败不保留旧结果；pending、fullmissing和zeroAR不同金额文案；无当前权限禁止跳业务；未知确认数量不从新修订推算。PC真实api适配和只读会话行为用边界替身验证。
- [x] PC提供账号密码登录、当前角色/权限说明、医院/接收日期/关键字/状态/归属/应收筛选、稳定分页、详情页（原资料/采购/厂家报价/医院报价/应收与留痕）及真实文件受控下载。仅展示只读历史，无模拟角色开关。
- [x] 小程序新增历史订单入口，复用同一只读组件和类型、保留筛选及页码返回；详情可进入既有业务处理页面但按当前订单可操作权。读取失败清理旧结果，服务端无权后不留旧详情；切换筛选/行快速请求避免迟到响应覆盖当前对象，离页不再更新。
- [x] 已有计价工作台加“同院历史参考”，按当前行请求最近3单且标明文本匹配；只读参考，不写任何当前计价字段。缺货和多个同名行明确展示。
- [x] PC管理员全量只读；销售小程序仍只接销售账号。PC已有角色/会话过期直接清理数据并回登录，不把server403/500视为无历史0条。
- [x] PC通过受保护Cookie及CSRF适配API，不保存会话凭证到localStorage；GET me复核当前身份，PC与小程序凭证通道隔离。
- [x] PC与mini类型检查、build、前端回归通过并提交。

## Task 3：独立审查、联调与GitHub

- [x] 后端及前端分别需求审查→修复→质量审查，不将实施者自检替代独立审查。
- [x] 浏览器虚构数据验证PC密码登录、筛选/分页/返回、旧单只读、小程序同结果、历史价格只读、管理员权限；本地PGlite结果与标准PostgreSQL CI分开记录。
- [ ] 更新实际工程/指南与验收范围，保留用户既有修改。同步独立分支`codex/order-archive`，PR以`codex/quote-delivery`为基线（PR#2尚未合并）；创建并附加草稿PR，等待标准PostgreSQL CI。不擅自合并已有PR。

## 计划自检

已将PC登录所需会话迁移、管理员只读、历史署名非伪造、交接医院筛选、完整历史分页与最近3单价格去重分别覆盖。缺附件、缺回款编辑、商品库ID缺失均按真实实现边界展示；不会缩小既有PRD后续需求或改变版本。
