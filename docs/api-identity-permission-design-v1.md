# 开发设计说明书第三部分接口与身份权限设计草案

- 日期：2026-10-15
- 状态：待审阅技术设计；本次不创建账号或调用真实微信登录。
- 基线：[PRD v3](quote-system-prd-v3.md)、已确认的 [数据库与事务设计](database-transaction-design-v1.md)。

本部分固定本系统的接口约定、登录绑定、会话和数据权限。微信接口的主体资格、实际权限、外部参数及费用在真实 AppID 下联调核验；本节不假定相关能力已经开通。日期截止和提醒调度时刻留到下一部分细化。

## 一 统一接口约定

### 1.1 地址与数据格式

- API 前缀统一为 `/api/v1`，本文表格中的路径均相对此前缀；PRD 第 9 节是能力基线，尚无已上线旧接口需要兼容。
- 请求与响应使用 JSON，字段 camelCase；UUID 使用字符串，金额、数量和比例使用十进制字符串，未知值用 null，不能用空字符串或 0 替代。
- DATE 使用 YYYY-MM-DD；时间点使用带时区的 ISO 8601。客户端不传系统录入人、录入时间或服务器业务状态。
- 普通列表返回 items、nextCursor 和 hasMore，稳定排序含 ID，pageSize 默认 20、上限 100。图表下钻必须携带服务端签发的 snapshotId。
- 所有响应带 requestId，敏感数据设置禁止共享缓存。GET 不承担状态变更。
- PC 与销售小程序调用相同销售业务接口，使用相同输入和错误码；角色及会话类型由服务端判定，不信任客户端传来的 role、userId 或 clientType。

### 1.2 保存版本和重复请求

- 修改草稿等可编辑聚合对象必须提交 expectedVersion；任一子行变化递增父聚合版本，冲突返回 409 VERSION_CONFLICT。
- 新建订单、创建修订、厂家提交、导出、标记发送、确认、核实、回款、作废重录、账期调整、异常处理和专项交接等变更要求 Idempotency-Key。
- 键在操作人和操作范围内唯一；服务端内容哈希包含目标资源及有效请求内容。相同键不同内容返回 409 IDEMPOTENCY_KEY_REUSED，相同业务的重复请求返回原结果。
- 授权及资源归属在数据库事务中重新检查；幂等结果也不能绕过当前读取权限。租约、行锁和任务去重沿用第二部分。
- OCR、导出等异步操作返回 202、jobId、业务引用及查询地址；202 只表示任务已受理，成功文件和可发送资格以任务完成后的业务状态为准。
- 查询快照生成、上传授权与下载签名等 POST 属于受授权的查询/传输准备，不改业务事实；按各自权限执行，不能借这类路由取得记账或改价能力。
- 临时密码等秘密的一次性展示不进入 operation_requests 的结果缓存。重置/生成请求仍幂等，但重试只返回原操作引用及“已生成”状态，不再生成或恢复原文；首次响应丢失时，管理员需明确发起新的重置并使上次临时凭证失效。

### 1.3 响应示例

以下为契约示例，不是实际运行记录。回款成功返回：

```json
{
  "data": {
    "paymentId": "a0d64e2e-0278-4073-9b3b-e2f401c068c9",
    "amount": "3000.00",
    "paidAmount": "3000.00",
    "outstandingAmount": "7000.00",
    "paymentStatus": "partially_paid"
  },
  "meta": {"requestId": "example-payment-request"}
}
```

版本冲突返回 HTTP 409：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "资料已被另一端更新，请刷新后重试",
    "details": {"expectedVersion": 8, "currentVersion": 9}
  },
  "meta": {"requestId": "example-conflict-request"}
}
```

## 二 登录和账号绑定

### 2.1 内部账号初始化与重置

1. 管理员在 PC 预建销售账号和必要的管理员账号，设置登录名、姓名、手机号和角色；医院采购员档案另行维护。不提供公开注册或凭手机号自动生成内部销售账号。
2. 首个管理员通过受控部署初始化流程建立，不开放匿名创建管理员接口。后续管理员维护不能通过通用个人资料修改接口提权。
3. 初始/重置密码采用系统生成的临时凭证，仅在生成时显示一次，明文不落日志或持久存储；临时凭证有效期建议 24 小时，重新生成后旧凭证失效。交付由管理员自行完成，系统不自动发送短信或邮件。
4. 首次正确验证临时凭证只取得 password_setup 受限会话，必须设置本人新密码；此前不能读写业务、绑定微信或管理账号。受限会话建议 10 分钟失效，完成设置后作废并重新登录。
5. 密码采用 Argon2id 加盐哈希，参数按部署机器基准测试及 OWASP 指引确定；不存明文、可逆密码或以快速通用哈希替代密码哈希。建议支持 15～128 字符口令，不静默截断或自动 trim 密码。[密码存储指引](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。
6. 忘记密码由管理员核实后执行专用重置，原因必填，保留审计并撤销该账号现有 PC/小程序会话。重置不改订单归属或历史署名，不自动解除微信绑定；丢失微信身份时另走管理员绑定重置。

### 2.2 PC 登录

销售和管理员用登录名/密码进入 PC。登录接口返回服务端确定的角色和允许入口，医院采购员不能用此入口获得 PC 业务会话。登录失败不披露“账号存在但密码错误”等可枚举差异，组合账号和来源限流，触发时返回 429。

登录成功轮换会话标识，PC 使用 HttpOnly、Secure、SameSite=Lax 的 `__Host-quote_session` Cookie，Path 为 /，不设置 Domain。PC 前端不把会话凭证写入 localStorage。部署入口以同源 /api 反向代理为默认方案。

### 2.3 销售小程序首次绑定

推荐首次在小程序输入已设置的内部账号密码，同时提交本次微信登录凭证，服务端验证两者后绑定现有 users.id。另一种方式是 PC 登录后生成一次性绑定码再扫码，适合后续减少手机输密码；MVP 先采用前一种，减少跨设备步骤。

1. 小程序获得新的微信登录凭证，经后端验证得到本应用范围内的微信身份；AppID 取服务端配置，不允许客户端指定任意应用或自报 OpenID。
2. 未绑定身份只取得用途受限的 bindTicket，不能访问业务。销售提交 bindTicket、内部登录名和密码，服务端验证账号有效、角色为 salesperson、已完成密码设置。
3. 在事务中验证同一 AppID/OpenID 未绑定其他用户，该内部账号在本 AppID 下也未绑定其他有效微信身份；成功后绑定已有账号并发放销售小程序会话。
4. 冲突返回 IDENTITY_BINDING_CONFLICT，不能自动合并账号或覆盖旧绑定；同一绑定请求重复成功可幂等返回结果。
5. 此后通过验证后的微信身份登录到同一用户，服务端每次仍检查账号有效状态。管理员角色不得建立管理员小程序会话。

### 2.4 医院采购员登录

未绑定的微信身份经用户主动手机号授权，由后端取得可信手机号并匹配管理员预建的有效 hospital_purchasers 档案、关联用户及医院；客户端自填手机号或 hospitalId 不能作为身份依据。未建档、档案停用、角色或已有绑定冲突时提示联系管理员，不能自动注册、合并或转移医院归属。

匹配成功后在事务中绑定已有医院采购员身份。后续微信登录仍检查用户、采购员档案及医院的有效状态。微信登录凭证和手机号授权凭证分别命名为 loginCode、phoneCode，不混用，也不向前端下发 AppSecret、平台访问令牌或会话密钥。

微信适配器在真实 AppID 下验证登录和手机号授权流程；接口不可用、用户拒绝授权或未建档不伪造身份。销售代录的正常业务入口仍按 PRD 保留。参考入口：[微信小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[手机号授权](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)。本轮上述微信文档的直接读取受限，外部字段与能力不能据此视为完成核验。

### 2.5 绑定重置和会话撤销

微信绑定重置为管理员 PC 账号维护操作，必须记录原因并校验当前绑定，撤销原小程序会话及绑定；新身份仍须完成相应验证后才能绑定，原 OpenID 不再获得业务访问。医院采购员同样不因重置绑定而改写旧订单上的采购员或历史操作人。

停用账号立即阻止两端后续受保护请求。离职销售须先按专项交接及医院新单归属规则处理未完成事项，再停用；绑定/密码重置都不能隐式转交旧单。

## 三 会话设计

推荐使用可撤销的服务端不透明会话，先持久化到 PostgreSQL；与纯无状态 JWT 相比，多一次会话查询，但便于即时停用、重置和处理身份绑定变化。认证层可在测量后缓存，不提前引入另一套权限权威来源。

| 会话 | 传递方式 | 服务端限制 |
| --- | --- | --- |
| PC 内部会话 | HttpOnly Cookie | 仅由 PC 密码认证产生，角色为 salesperson 或 admin；管理员管理入口还须 role=admin。 |
| 小程序用户会话 | Authorization Bearer | 仅由微信验证/绑定产生，角色为 salesperson 或 hospital_purchaser；按 users.id 统一业务身份。 |
| 密码设置会话 | 专用受限凭证 | 只允许设置新密码和退出，不复用为用户业务会话。 |
| 待绑定票据 | 专用短期票据 | 只允许对应身份的绑定/手机号验证，不能访问订单。 |
| 厂家 H5 会话 | 独立的受限 Bearer | 只访问一个有效询价链接和任务，不得作为内部用户会话。 |

会话凭证使用密码学安全随机数，服务端只存哈希；认证结果绑定 session.channel/purpose、用户或厂家链接及到期时间。不能通过修改请求 clientType、User-Agent 或 Cookie 名字获得更高角色。

PC 建议绝对有效期 7 天、连续不活跃 8 小时过期；小程序建议绝对有效期 30 天、连续不活跃 7 天过期。期限为待审阅的运行默认值，受限票据建议 10 分钟，厂家会话不得超过原链接的 48 小时截止。业务请求不无限延长绝对期限，退出撤销当前会话；修改或重置密码撤销该用户原有会话。

PC 所有变更请求，包括登录、绑定维护及退出，校验允许来源和 CSRF 令牌；登录前可签发无业务权限的预会话令牌，登录后轮换。SameSite 不能替代完整 CSRF 校验，Cookie 模式与 Bearer 模式不互相兜底；敏感响应不记录凭证。[会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[CSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。

## 四 数据与操作权限

### 4.1 判断规则

对有效内部用户 u 和根订单 o，销售读取条件为：u 是订单当前负责销售员，或 u 是该医院当前负责销售员。销售业务写入则必须是订单当前负责销售员，且该操作符合当前状态和采购修订；医院只读授权不能复用为旧单写权限。

医院采购员只读属于本人且当前医院一致的 standard 正常单，包含本人提交和销售为本人代录的单。historical_backfill 在全部核实状态下均对医院角色拒绝；医院响应使用专用精简 DTO，不返回报价、厂家、价格、账期、回款或内部审计。

管理员只读全量业务，写权限只限基础资料白名单及专用离职交接/账号维护操作。厂家只持有任务级能力，没有 users 业务角色。

| 操作 | 订单负责销售 | 医院当前销售查看他人旧单 | 管理员 PC | 医院采购员 | 厂家 H5 |
| --- | --- | --- | --- | --- | --- |
| 查订单、内部报价及相关文件 | 允许 | 只读 | 全量只读 | 只限本人正常单精简资料，无报价 | 仅本链接冻结需求 |
| 冻结、询价、改价、导出、发送、确认 | 按状态允许 | 拒绝 | 拒绝 | 拒绝 | 仅完整提交本任务 |
| 回款、作废、单单账期及异常处理 | 按规则允许 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| 历史补录核实或金额更正 | 本人负责单按规则允许 | 拒绝 | 只读 | 全部拒绝 | 拒绝 |
| 医院默认账期 | 当前负责该医院时允许 | 当前负责医院时允许，不改旧单 | 拒绝 | 拒绝 | 拒绝 |
| 医院跨任期全量统计 | 当前负责医院时可查 | 当前负责医院时可查 | 全量可查 | 拒绝 | 拒绝 |
| 账号与基础资料管理 | 仅 PRD 授权的资料操作 | 同左 | 维护白名单 | 拒绝 | 拒绝 |
| 离职专项交接 | 拒绝 | 拒绝 | 专用接口允许并留痕 | 拒绝 | 拒绝 |

非医院当前销售只能统计自己仍负责的订单，不能因曾服务该医院而读取后来归他人的新单。统计返回 scopeLabel，区分“医院全量”和“本人负责订单范围”，底层根订单集合与下钻一致。

### 4.2 防止跨对象与字段越权

- 解析 revisionId、lineId、quoteId、versionId、receivableId、paymentId、jobId、fileId 时必须追溯根单并核对层级，不只检查“用户能登录”或仅校验外层 orderId。
- 医院创建单的 hospitalId/purchaserUserId 按 PRD 忽略自报值，以绑定身份设置；销售代录则必须提交这两项并验证当前医院归属、采购员同院且有效。sourceActorType、负责人和系统时间由服务端生成。
- 禁止通用 PATCH 写 status、salesUserId、confirmedVersionId、应收/已收金额或冻结字段。医院默认账期使用独立销售接口，管理员通用医院维护不能修改 paymentTermDays。
- 数据结构错误和普通非白名单字段返回 400；已识别但当前主体无权修改的业务字段返回 403 FIELD_WRITE_FORBIDDEN。不把权限失败伪装成保存成功后丢弃字段。
- 对无读取权限的具体业务对象统一 404，避免暴露存在性；已知资源的操作权限不足返回 403。查询列表先限权后分页、计数和聚合。
- 响应可返回 allowedActions 帮助两端展示按钮，但每次请求仍在服务端重验。角色 Guard 负责入口，资源和字段策略由业务授权服务处理，不能只靠路由名。[NestJS 授权](https://docs.nestjs.com/security/authorization)、[参数验证](https://docs.nestjs.com/techniques/validation)。
- 管理员可执行本节列明的内部业务 GET，以及生成只读分析快照/读取文件所需的查询 POST；这些仅扩大读取范围，不开放同路径族下的销售写操作。文件上传则须为管理员获准维护的基础资料用途，不能上传并更改业务订单附件。

## 五 核心接口契约

### 5.1 认证与管理员账号维护

| 方法与路径 | 输入与处理 |
| --- | --- |
| GET /auth/csrf | PC 获取与当前预会话或用户会话绑定的 CSRF 令牌；响应禁止缓存。 |
| GET/POST /admin/users | 管理员 PC 查询或预建内部账号，输入 loginName、name、phone、role；内部角色仅 salesperson/admin，不能通过该入口伪造已绑定微信或医院业务归属。 |
| POST /admin/hospitals/:id/purchasers | 管理员 PC 建有效采购员档案及对应医院用户，医院和用户关联由服务端维护，不能只凭首次登录自动注册。 |
| POST /auth/password-login | loginName、password；成功产生 PC 会话，临时密码只产生 password_setup 受限会话。 |
| POST /auth/password/complete-setup | 受限会话与 newPassword；完成设置后撤销设置会话，重新登录，不顺便创建业务账号。 |
| POST /auth/password/change | 已登录内部用户提交 currentPassword、newPassword；校验后撤销原有会话并重新登录。 |
| POST /auth/miniapp/login | loginCode；已绑定则登录对应用户，未绑定返回 bindTicket 及 nextAction，不给业务会话。 |
| POST /auth/miniapp/bind-sales | bindTicket、loginName、password；验证有效销售账号并绑定；临时凭证先完成密码设置，再用新的微信凭证绑定。 |
| POST /auth/miniapp/hospital-phone-login | bindTicket、phoneCode；后端验证手机号并匹配有效预建采购员，事务内绑定；拒绝自报医院/角色。 |
| GET /auth/me | 返回当前 users.id、role、channel、必要医院关系及 scopeVersion，不返回密码哈希、OpenID、平台密钥或会话原文。 |
| POST /auth/logout | 幂等撤销当前会话；PC 清 Cookie、小程序清本地凭证。 |
| POST /admin/users/:id/password-reset | 管理员 PC，reason 必填；生成新的临时凭证并撤销原会话，仅生成响应显示一次。 |
| POST /admin/users/:id/wechat-binding-reset | 管理员 PC，reason 和 expectedBindingVersion 必填；撤销旧绑定及小程序会话，保留历史。 |
| POST /admin/users/:id/disable | 管理员 PC，重查离职交接及医院新单归属，不隐式转单。 |

bindTicket 已验证的身份信息仅保存在后端。与外部微信交换凭证属于事务外步骤，成功后再在短事务中核对票据用途、到期和用户/档案状态，完成一次性绑定；第三方超时不提前创建或绑定用户。

认证响应区分三种 authState：authenticated 才发放正式会话；password_setup_required 只返回短期 setupTicket，作为受限 Bearer 在内存中使用；identity_unbound 只返回 bindTicket 和允许的下一步。complete-setup 只接受 purpose=password_setup 的票据，不把 setupTicket 或 bindTicket 当作完整业务会话。完成设置后重新登录；手机首次绑定遇到临时密码时也先完成设置，再取得新的微信凭证绑定。

### 5.2 订单、询价和报价

| 方法与路径 | 关键输入和约束 |
| --- | --- |
| POST /hospital/purchase-orders | 本人正常单草稿与需求明细；医院及采购员由会话设置，回包无价格。 |
| POST /sales/purchase-orders | hospitalId、purchaserUserId、receivedDate、需求明细；只为当前负责医院创建新单。 |
| PATCH /sales/purchase-orders/:id/revisions/:revisionId/lines/:lineId | expectedVersion、允许修改的草稿行字段；冻结行、跨修订及他人旧单拒绝。 |
| POST /sales/purchase-orders/:id/revisions/:revisionId/freeze | expectedVersion；校验当前修订、需求完整及 kg 后冻结。 |
| POST /sales/purchase-orders/:id/create-revision | expectedVersion、reason；复制原需求为新草稿，不覆盖旧行或增加统计次数。 |
| POST /sales/purchase-order-revisions/:revisionId/supplier-tasks | manufacturerId、slotNo；仅当前冻结修订，同厂家和任务位有效唯一。 |
| POST /supplier-tasks/:taskId/generate-link 或 regenerate-link | 订单负责销售生成/重置本任务链接；新链接原文仅在生成响应返回，服务端不保存可恢复原文。 |
| POST /supplier-tasks/:taskId/requote | 原因及当前版本；重询同步替代旧提交、关闭旧链接、使被选基准的相关报价失效。 |
| PATCH /quotes/:id/versions/:versionId/draft | expectedVersion、逐行计价及最终确认字段、hospitalValidUntil；不接受当前价格来源之外的任意基准价。 |
| POST /quotes/:id/versions/:versionId/adopt-latest-supplier-quotes | expectedVersion 与选择范围；仅主动采用才更新草稿，保留最终价，变化行重新确认。 |
| POST /quotes/:id/versions/:versionId/export | expectedVersion、format=xlsx/pdf；整单校验并取得导出占用后返回 202。 |
| GET /jobs/:jobId | 鉴权后返回该任务必要状态、失败码或成功业务引用；不直接返回供应商/其他用户任务内容。 |
| POST /quotes/:id/versions/:versionId/mark-sent | channel、可选 remark；仅当前采购修订下已有成功文件、未失效且未完成的版本。 |
| POST /quotes/:id/versions/:versionId/confirm | hospitalConfirmedAt、适用的 backfillReason；唯一确认并关闭其他未发送版本，含价格时建立唯一应收。 |
| GET /quotes/:id/versions、GET /quote-history | 使用内部读取权限；商品最近三次参考按根采购单去重，不能替代完整档案。 |

PRD 其余草稿增删行、提交、厂家取消/替换、报价换版与作废、资料批次和模板等能力保持；每个写入口同样经过角色、根单、当前版本、状态、字段及幂等校验。正常完成后不能通过通用更新、任务重试或旧版本发送接口重新打开报价。

### 5.3 历史、回款与分析

| 方法与路径 | 关键输入和约束 |
| --- | --- |
| GET /sales/order-archive 及 /:purchaseOrderId | 按有权根单筛选医院、日期、药品及状态；聚合原资料、修订、报价、核实和回款，不只返回最近三条。 |
| POST/PATCH /sales/historical-orders 及 /:id | 专用历史来源，PATCH 仅未核实资料；不把普通单改成历史来源。 |
| POST /sales/historical-orders/:id/verify | expectedVersion、verificationBasis、verificationNote；采购药品/数量等必填资料齐全，附件可空，逐行确认结果未知仍可核实。 |
| POST /sales/historical-orders/:id/amount-corrections | newAmount、reason、verificationBasis、verificationNote、可选 evidenceFileIds、expectedVersion；仅录入错误，新应收不低于有效已收。 |
| GET /sales/receivables 及 /:id | 当前/历史读取范围内的应收、有效已收、余额、原始及有效账期、异常与更正历史。 |
| POST /sales/receivables/:id/payments | amount、paidDate、可选 remark/proofFileId/correctsPaymentRecordId；服务端确定 recordType，正数且不超余额。 |
| POST /sales/receivables/:id/payments/:paymentId/void | reason；只能作废同单错误记录，保留原值，不能作为实际退款。 |
| POST /sales/purchase-orders/:id/payment-term-adjustments | newTermDays、reason、expectedVersion；只改本单当前账期，不改原快照或医院默认值。 |
| PATCH /sales/hospitals/:id/payment-term | paymentTermDays、expectedVersion；仅该医院当前负责销售，修改只影响之后创建的新单。 |
| POST /sales/receivables/:id/exceptions | exceptionType、reason、可选 evidenceFileIds；暂停催收，不改金额。 |
| POST /sales/receivables/:id/exceptions/:exceptionId/resolve | verificationResult、resolveReason；仅核实仍需收款时解除当前异常，按当前到期日恢复条件。 |
| POST /sales/analytics/query-snapshots | filters、dateBasis、所需图表；生成五类分析所用共同快照与覆盖信息。 |
| GET /sales/analytics/query-snapshots/:snapshotId 及 /orders | 仅创建者且当前权限范围版本一致；订单分页与图表共用快照，失效整组刷新。 |
| POST /admin/sales-handoffs/preview 及 /admin/sales-handoffs | fromSalesUserId、toSalesUserId、明确范围、reason 与相应版本；预览不写数据，执行留痕，未交接事项阻止停用。 |

普通新增回款不能自行指定 historical_opening。更正原历史累计须关联同单已作废的原累计记录，由服务端保持类型；初次历史累计只在核实入口产生。医院账号对历史补录与回款相关接口均拒绝。

管理员 PC 可调用上述内部 GET（包括 /sales、/quotes 和有权文件/任务读取）及 POST /sales/analytics/query-snapshots，查询策略返回全量只读视图，沿用业务 DTO 与脱敏规则；路径中的 sales 不是单独的权限依据。对应销售写接口仍只允许有权销售员。账号、医院、采购员、厂家、商品、模板等管理写接口使用独立白名单；无销售主管或团队角色接口。

## 六 厂家 H5 与私有文件

### 6.1 厂家能力凭证

推荐生成带 token 片段的 H5 链接，由页面读取后向 `POST /h5/sessions` 用 HTTPS 请求体交换专用会话。交换后清理地址栏中的原 token，后续使用会话 Bearer 访问 `GET /h5/supplier-quote` 及 `POST /h5/supplier-quote/submit`，避免把长效填写 token 放进每个 API 路径和访问日志。微信内打开及链接转发需在真实 H5 环境验证。

页面关闭后的再次复制/重发方式正在等待业务确认：只存随机 token 哈希时，服务端不能恢复原链接；如果要求随时恢复同一个链接，必须明确调整凭证保存方案。本草案尚不把“只能重新生成”视为已批准规则。

会话只引用一个 linkId、taskId 和冻结采购修订，有效期最多到原链接 expiresAt；不因交换会话或刷新页面重新起算 48 小时。服务端仍验证任务未取消、链接当前有效、对应采购修订及未提交状态。

提交输入只有 validUntil 及完整 lines；行包含 purchaseOrderLineId、supplyStatus、quotedUnitPrice 和可选 remark。规格、单位和数量从冻结行读取，客户端传来的变更字段拒绝；缺货单价为空，未填行、多余行和重复行均拒绝。

提交成功后只保留本次回执读取能力；相同内容的幂等重试返回原提交结果，不能再次报价。H5 会话不能调用 /auth/me、销售/医院/管理员接口或其他任务；内部 Cookie 也不作为 H5 链接授权的替代。

### 6.2 文件上传和下载

`POST /files/upload-intents` 提交用途、目标业务对象、文件名、大小与 MIME，服务端先检查该用途的写权限，再签发限时上传授权；完成后由服务端核对对象元信息，`POST /files/:id/complete` 只绑定允许的业务对象。不能凭任意 fileId 把别人的文件挂到本单。

`POST /files/:id/download-url` 每次追溯实际业务关联和文件用途。销售/管理员按读取范围获取私有原资料或已成功导出文件，医院仅本人的正常采购资料，不得读取报价、内部凭证或历史补录附件；厂家只获得冻结需求字段，不开放通用文件列表。

下载签名短期有效，建议默认 5 分钟；实际值配置化。鉴权在签发时发生，已经签发的有效链接不能宣称随账号停用立即撤回，已下载文件也无法收回；因此不持久化分享链接、不记录含凭证的 URL。临时文件和未成功导出文件不签发业务下载链接。

## 七 错误码与前端动作

| HTTP 与错误码 | 客户端动作 |
| --- | --- |
| 400 VALIDATION_FAILED | 提示具体字段；不更改已保存事实。 |
| 401 AUTHENTICATION_REQUIRED / SESSION_EXPIRED | 重新登录，不把未提交编辑当作已保存。 |
| 403 ACCOUNT_DISABLED / ROLE_CHANNEL_DENIED | 停止访问相应入口，不能换客户端标记绕过。 |
| 403 FIELD_WRITE_FORBIDDEN / ACTION_FORBIDDEN | 提示只读或字段权限限制，不自动重试写入。 |
| 404 RESOURCE_NOT_FOUND | 不暴露是否存在无权对象、文件或任务。 |
| 409 VERSION_CONFLICT / IDEMPOTENCY_KEY_REUSED | 显示冲突并刷新核对，不自动覆盖或换键重发。 |
| 409 IDENTITY_BINDING_CONFLICT / PURCHASER_NOT_PROVISIONED | 联系管理员核实，不能自动创建或合并账号。 |
| 409 EXPORT_IN_PROGRESS / STATE_CONFLICT | 展示任务或当前状态，草稿占用解除后再允许编辑。 |
| 409 SNAPSHOT_SCOPE_CHANGED | 图表和下钻整组刷新，不继续展示已失去权限的数据。 |
| 410 LINK_EXPIRED / SNAPSHOT_EXPIRED | 链接过期重新询价或按业务规则重发新链接；查询快照过期则重算。 |
| 422 SUPPLIER_PENDING / QUOTE_INVALIDATED / QUOTE_EXPIRED / PAYMENT_EXCEEDS_OUTSTANDING | 展示业务原因及可行修复动作，不部分提交或自动改钱。 |
| 429 RATE_LIMITED | 按 Retry-After 等待，保留本地未提交内容。 |
| 503 INTEGRATION_UNAVAILABLE | 明确尚未登录/核实/完成外部操作，恢复后重新获取必要凭证；不生成伪成功结果。 |

字段错误可返回已授权对象内的行 ID、原因和修复动作；权限失败不得带其他医院、厂家、用户或隐藏财务数据。服务器日志按 requestId 关联，密码、授权码、token、Cookie、平台密钥和完整敏感请求体脱敏。

## 八 认证数据模型补充

| 对象 | 主要内容 |
| --- | --- |
| users 补充 | password_setup_required、临时密码失效时间、auth_version；access_scope_version 沿用第二部分。旧密码与账号维护动作撤销相应会话，不改业务负责人。 |
| wechat_identities | app_id、open_id、user_id、绑定版本、状态与绑定/解除时间；有效 AppID/OpenID 唯一，同用户同 AppID 最多一个有效绑定。历史关联保留，不向业务前端返回原始 OpenID。 |
| auth_sessions | 会话哈希、user_id 或 vendor_link_id、channel、purpose、auth_version、创建/绝对到期/最后活动时间及撤销原因；受限身份和普通会话不能混用。 |
| auth_challenges | 一次性 bindTicket 或密码设置票据的哈希、目的、已验证身份引用、到期和消费状态；绑定事务内一次消费。 |
| audit_logs | 账号创建、密码/绑定重置、停用、越权拒绝摘要与专项交接引用；不保存可复用凭证原文。 |

微信关联从 PRD 的 openId 建议字段细化为独立关系，避免不同应用或解绑历史混用；用户身份权威仍是同一 users.id。认证模型补充不改变第二部分已确认的业务表和事务边界。

## 九 实现阶段验证要求

- PC 和小程序绑定到同一销售用户；未绑定或需设置密码的票据不能访问业务；管理员或医院身份不能借销售绑定接口提权。
- 微信凭证在后端验证，重放、过期、拒绝授权、手机号无档案、绑定冲突及并发绑定均不给伪成功；外部服务失败不生成用户或转移归属。
- 旧单负责人 A 可处理旧单，医院当前销售 B 只读；管理员写普通业务、医院读历史补录、厂家读另一任务及嵌套 ID 跨单全部拒绝。
- 医院精简 DTO 不含内部价格或财务；导出、私有文件、异步任务和图表快照执行相同资源权限，不能只靠隐藏菜单。
- 账号停用、密码/绑定重置、专项交接后旧会话及旧权限正确失效；CSRF、来源及字段白名单在 PC 变更接口生效。
- 两端版本冲突、重复记账、超过余额、过期/失效报价、导出占用及快照范围变化都返回可识别错误，不产生部分成功。

以上是后续联调与自动化验收要求，本轮只检查文档。真实微信能力、Cookie/CSRF 部署和 API 行为需在建立工程后验证。

## 十 本次审阅范围与下一项

建议确认：销售用内部密码加微信验证完成首次绑定、医院手机号匹配预建档案、可撤销服务端会话、角色加根订单/字段授权、统一接口与错误码，以及厂家任务级独立会话。

厂家链接再次复制方式须先完成本轮业务确认，再形成该部分的最终接口约定；其他接口方案仍待本部分整体审阅。

下一项为状态流转与时间边界设计，收敛日期截止、提醒调度和各状态的允许操作；之后再细化部署、真实外部接入验证和实施任务。
