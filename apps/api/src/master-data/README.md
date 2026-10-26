# 基础资料、内部账号与专项交接服务

本目录只提供独立领域服务，HTTP 挂接、认证分支及页面由主任务统一集成。全部管理员写操作再次校验有效 PC 管理员会话；销售与医院不能借此代操作业务。

## 接口挂接

- `MasterDataService(store, checkFile?)`
  - `list(actor, kind, {keyword?,includeInactive?,page?,pageSize?})` → `{items,total,page,pageSize}`。
  - `save(actor, key, kind, input)` → camelCase 资料记录，乐观版本字段为 `version`。新建省略 id/expectedVersion，修改同时提供两者。
  - kind 为 `hospitals`、`purchasers`、`manufacturers`、`items`、`variants`、`templates`。完整字段见 `packages/contracts/src/master-data.ts` 及服务中的严格校验。医院维护不接受 paymentTermDays，默认 90 天由数据库建立。
  - `searchCatalog(actor,{keyword?,limit?})` → `{items}`，包含扁平标准商品/规格/别名；不读取或返回来源价。内部有效身份与有效医院 mini 身份可查。
  - `previewSourceBatch(actor,input)` → `{previewToken,rows,totalRows,validRows,invalidRows,referenceNotice}`；输入和映射字段见契约。文件解析不在本服务中，解析后的 cells 可按列号转成 record，再提交 mapping。
  - previewToken 为 32 字节随机值编码后的 43 字符；仅哈希落库，原始预览内容服务端保存，并绑定管理员、用途、认证版本及权限版本。过期或权限变化须重新预览，服务重启不丢失仍有效预览。每次生成时清理该管理员已过期的临时预览；批次确认后的永久 previewSnapshot 不受清理影响。
  - `confirmSourceBatch(actor,key,{previewToken,acceptedRowNumbers})` → 已确认批次详情。行号从 1 开始，必须显式选择，异常行不能确认；未选择行与异常行的原始校对依据保存在不可改的 previewSnapshot 中。
  - `listSourceBatches(actor,{manufacturerId?,batchNo?,sourceBatchNo?,quotedFrom?,quotedTo?,page?,pageSize?})`、`sourceBatch(actor,id)` 为内部只读。
  - `voidSourceBatch(actor,key,id,{expectedVersion,reason})` 只能整批作废；确认后的批次和行不可追加、覆盖或删除。
- `AdminIdentityService(store)`
  - `listUsers(actor)` 返回内部账号及不含 openId 的绑定引用。
  - `createUser(actor,key,{loginName,name,phone,role})`，role 仅 salesperson/admin。
  - `updateUser(actor,key,id,{expectedVersion,name,phone,role,active})`，不允许本人改角色/启停；离职或变更为非销售身份前须清空其医院及待办负责范围。
  - `resetPassword(actor,key,id,{expectedVersion,reason})`、`resetBinding(actor,key,id,{expectedVersion,reason,expectedBindingId})` 立即撤销原会话及旧设置票据，不转单。
  - 创建/密码重置返回 `{user,credentialGenerated:true,temporaryPassword,temporaryPasswordExpiresAt}`；同键重试不再返回 temporaryPassword。明文、哈希均不放入操作结果或审计。
  - `verifyTemporaryPassword({loginName,password},ip?)` 仅返回 10 分钟 password_setup 票据；`completeSetup({setupTicket,newPassword})` 设置 15～128 字符本人密码、撤销所有旧票据和会话，并要求重新登录。临时凭证 24 小时到期。
- `HandoffService(store)`
  - `preview(actor,{fromSalesUserId,toSalesUserId,orderIds,hospitalIds,reason})` 返回全部应处理订单/医院、选择范围、财务摘要及 15 分钟随机短 previewToken。可先以空选择查询范围，再按最终选择重新预览。
  - `execute(actor,key,{previewToken})` 重查同版本、同待办范围及双方有效身份；必须选全待办订单和仍负责医院，任何失败整笔回滚。交接后重查无遗漏再停用原销售。
  - 只更新采购单当前负责人（应收、提醒通过 JOIN 使用该负责人）、明确选择的医院新单归属和账号状态；原始负责人、历史操作人、报价内容和版本、数量、金额、账期、日期、回款及异常状态不改。采购单 row_version 为阻止旧客户端写入而递增。

建议 HTTP 路径为 `/admin/master-data/:kind`、`/catalog/variants`、`/admin/users`、`/admin/users/:id/reset-password`、`.../reset-binding`、`/auth/password/complete-setup`、`/admin/source-batches/preview`、`.../confirm`、`.../:id/void`、`/source-batches`、`/admin/sales-handoffs/preview`、`/admin/sales-handoffs`。这些路径在本服务提交中尚未挂接。

## 主任务必须完成的集成

1. `AuthService` 的 PC、trial、mini 登录及绑定必须在发放正式会话前拒绝 password_setup_required；PC 正确临时凭证走 verifyTemporaryPassword，只给受限票据，不下发业务 Cookie。completeSetup 只接受该用途票据，完成后重新登录。
2. CoreStore.active/认证层重查 password_setup_required，医院认证重查 user、purchaser、hospital 启用；采购创建和 bootstrap 重查 hospitals.active。
3. `/operations/:key` 同样重查 `master.*` 和 `admin.*` 操作的当前管理员 PC 权限，不能让降级后新销售会话查询过去的管理员结果。
4. 向 MasterDataService 注入 `SourceFileService.requireReference(c,actor,fileId,ref)`；厂家来源文件使用 `{kind:'manufacturer',manufacturerId}`，模板 logo 使用 `{kind:'template'}`。文件元数据原始 object_key 不传给客户端。
5. 导出时加载当前默认 quote_templates 配置并冻结到文件文档快照；不可因此重写旧文件。商品来源表不可加入计价读取链路。
6. 后续历史单把待核实根对象保留为未完成状态；若采用独立完成状态，须将待核实谓词补入 common.ts/pendingWork。当前未完成状态、未结清应收及 pending_verification 异常已覆盖。
7. 配置部署初始化命令 `node --import tsx scripts/init-admin.ts`，环境为 DATABASE_URL、ADMIN_LOGIN_NAME、ADMIN_NAME、ADMIN_PHONE。仅交互终端一次展示临时凭证，禁止覆盖已有管理员。不开放匿名初始化 HTTP。

## 验证边界

`TEST_DB_MODE=pglite node --import tsx --test apps/api/test/master-data.test.ts` 使用独立 25451 端口和临时数据库，执行真实迁移及服务事务。原生 PostgreSQL 模式通过 TEST_DATABASE_URL 指向专用 `/quote_core_test`，每次建立隔离 schema；其中“医院归属维护用户→医院锁顺序”竞争回归仅在原生 PostgreSQL 执行，PGlite 明确跳过。

本地 PGlite 的单连接串行结果不证明标准 PostgreSQL 锁竞争、真实微信、COS、HTTPS 或恢复演练通过。
