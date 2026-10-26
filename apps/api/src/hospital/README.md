# 医院采购轻量端

已实现医院本人正常单的草稿创建、组合录入、保存、提交、分页和精简状态，以及本人常用/最近采购需求。资料和解析复用 `SourceFileService`、`ParserService`；医院身份不进入 `CoreStore.active` 的内部业务授权范围。

## 集成接口

- `HospitalService(core, files)`：`bootstrap(actor)`、`list(actor,{page?,pageSize?})`、`suggestions(actor)`、`get(actor,id)`、`create(actor,key,{receivedDate?,lines,hospitalId?,purchaserUserId?})`、`save(actor,key,id,{expectedVersion,receivedDate?,lines})`、`submit(actor,key,id,{expectedVersion})`、`operation(actor,key)`。
- 对应 `/hospital/bootstrap`、`/hospital/purchase-orders`、`/hospital/purchase-suggestions`、`/hospital/purchase-orders/:id`、`/hospital/purchase-orders/:id/submit`。创建及提交 POST，保存 PUT；业务写入使用持久幂等 key。
- 自报医院与采购员不作为身份依据。采购单由服务端绑定本人、所属医院及当时有效负责销售。来源永久为 `hospital_self`；销售代录仅本人可读。
- 医院提交仍保持销售工作修订为 draft，销售稍后校对与冻结；提交时间和原始需求快照不可覆盖。医院只读状态不返回厂家、报价、账期、回款和内部审计；历史补录一律拒绝。
- `/operations/:key` 医院角色需走 `HospitalService.operation`，医院文件和解析回执均通过 `files.requireReference` 再次授权。

## 微信手机号绑定

`HospitalAuthService(auth, adapter?)` 的 `phoneLogin({bindTicket,phoneCode},ip)` 只接受手机号授权 code。默认适配器使用服务端 AppID/AppSecret 获取稳定 access token，再调用手机号接口；手机号只取可信响应 `phone_info.purePhoneNumber`，精确匹配启用的预建医院用户、采购员档案及医院。无公开注册或明文手机号回退。

现有 `AuthService.miniLogin({loginCode},ip)` 验证 loginCode，未绑定时创建短期 bindTicket；已绑定医院身份每次仍检查采购员和医院。`AuthService.authenticate(token,'bearer',true)` 仅为医院专属白名单入口放行，默认及 PC Cookie 均拒绝医院；HTTP 层须继续阻断内部报价、导出、回款、历史补录与统计路径。

配置使用既有 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`。缺配置返回 `WECHAT_NOT_CONFIGURED`，未知外部响应不伪造成功或自动重复使用 phoneCode。微信官方协议参考：[手机号接口](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html)、[稳定接口凭据](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getStableAccessToken.html)。本轮官方文档网址抓取不可用；协议请求/响应通过合成传输测试，仍需注册及配置真实 AppID 后逐项复核并联调。

## 手机组件

`HospitalWorkspace.vue` 仅接医院 API，展示本人原始需求；具名插槽 `source-files` 传入 `order`、`locked`、`mode`（image/excel）和 `refresh`。父页面嵌入原单上传解析组件，微信未绑定页由父页面提供主动手机号授权按钮。商品库、最近采购和常用需求均不带价格。

组件提供 `refresh()`、`openAfterRecovery(orderId?)`、`canLeave()`，发出 `busy-changed` 和 `failure`；未保存修改、未知操作和异步迟到响应不能覆盖其他单。API 清除待核对操作前应调用 `assertHospitalReceipt` 核对回执。

## 验证边界

`TEST_DB_MODE=pglite pnpm exec tsx --test apps/api/test/hospital.test.ts` 验证隔离虚构数据。`pnpm exec tsx --test apps/mini/src/hospital-domain.test.ts` 验证表单、异步状态及回执。标准 PostgreSQL 多连接锁竞争、真实微信手机号权限/按钮及手机手感、COS/OCR 和 HTTPS 部署仍须独立验收。

## 采购行来源与商品引用

`014_purchase_line_origins.sql` 补充每行 `sourceType`（ocr/excel/product_library/custom_input）、标准商品和规格引用。新手工行默认 custom_input；商品库选择保留原始输入、商品与规格 ID，手工修正文案不会伪造另一种录入来源。常用或最近采购重新选择时不复制旧单 OCR/表格证据；有商品引用时按新选择重新检查启用状态。

共用 `core/line-origin.ts` 的 `resolveLineOrigin` 在已授权锁定根单内核验引用；规格必须属于所选商品，新引用须启用，原行相同引用可保留已停用资料。解析来源必须对应本单已成功应用的任务、私有原文件和原始行号；客户端不能给普通行补上虚假的 OCR/Excel 标签或复制他行解析证据。旧客户端省略来源时保留该行既有服务端记录；已应用解析来源不可覆盖。提交快照和医院只读详情保留这些字段，所有来源价格仍不进入计价链路。
