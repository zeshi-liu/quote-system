# Task 3 私有源文件与解析实现记录

## 对照依据

- PRD v3 §6.3、§6.5、§9.5、§10.1–10.2；已确认接口权限设计 §6.2。
- 主计划 Task 3；本记录仅覆盖后端服务、迁移、契约和解析 worker，HTTP 与双端页面由主任务集成。

## 实现

- [x] 私有原文件绑定实际上传人、类型化业务对象及 SHA-256；原证据不可更新或删除。重新上传可带同业务父文件引用，保留来源链。
- [x] jpg/jpeg/png/xlsx/xls/csv 后缀、MIME 与内容嗅探；每文件不超过 20MB、同根采购单最多 20 张采购图片。客户端不得传对象存储键或上传人。
- [x] 正常采购修订、历史补录、同单回款凭证、厂家来源、管理员模板 logo 分别授权。医院仅启用医院下本人正常采购资料；只有 `submission_source=hospital_self` 且未提交的医院自主草稿允许医院写入，销售代录及旧单默认只读，销售仍可校对；模板 logo 仅管理员 PC、只限图片。
- [x] 下载授权最多 300 秒、只存令牌哈希、绑定当前用户与会话。实际下载再次校验会话及业务权限，并校验文件内容哈希；不返回永久或云存储公开地址。
- [x] XLSX/真实 BIFF8 XLS/UTF-8 CSV 在限资源子进程解析。最多 1000 数据行与一行表头、64 列；只读取第一工作表。不执行宏或外部链接；XLSX 的宏/外链及 XLS 的宏整表拒绝，单元格公式与链接标出逐行错误且不采用公式缓存结果。
- [x] 字段映射与候选预览；采购应用最多 200 行，全部 `checked=false`，记录来源 file/job/row 并保存映射采购备注 `purchase_remark`，重复应用不重复建行；来源价不进入计价。
- [x] PostgreSQL 持久解析队列、租约代次隔离、显式手工重试与持久幂等。OCR 超时/未知返回不得自动再调厂商，人工核对并 `acknowledgeUnknown=true` 后才可重试；总尝试最多 5 次。
- [x] 腾讯表格识别 V3 `RecognizeTableAccurateOCR` TC3 签名适配器；缺凭据明确 `OCR_NOT_CONFIGURED`，不合成识别成功。使用私有图片 Base64，不生成公网 ImageUrl。腾讯接口编码后 10MB 上限单独提示，不因此删除原文件。

迁移 `012_source_completeness.sql` 增加 `submission_source`（旧单默认 `sales_entry`）、`hospital_submitted_at` 和采购行 `purchase_remark`。正常手工采购保存/读取及双端备注编辑由主任务统一接通。

## 集成契约

`SourceFileService(core, storage)`：`upload(actor,key,input)`、`list(actor,reference)`、`get(actor,fileId)`、`requireReference(c,actor,fileId,expectedRef?,write=false)`、`downloadGrant(actor,fileId)`、`download(actor,fileId,token)`。

业务引用为 `{kind:'purchase_revision',orderId,revisionId}`、`{kind:'historical_order',orderId}`、`{kind:'payment_record',orderId,paymentRecordId}`、`{kind:'manufacturer',manufacturerId}`、`{kind:'template'}`。用途依次固定为采购图片/表格、历史附件、回款凭证、厂家来源、模板 logo，不能交叉引用。

`ParserService(files, options?)`：`create(actor,key,{fileId})`、`get(actor,id)`、`retry(actor,key,id,{acknowledgeUnknown?})`、`preview(actor,id,mapping)`、`apply(actor,key,id,{expectedVersion,mapping,rowNumbers?})`、`runOnce()`。

`mapping={headerRow:1,columns:{name:0,quantity:1,spec:2,unit:3}}`：表头行号从 1 起，列索引从 0 起；`headerRow:0` 表示没有表头。`get` 的 `rawRows` 包含行号、纯文本 cells 和 errors。OCR 按官方行列坐标恢复单元格原文，再通过同一字段映射生成可用候选；合并、重叠及非表格内容标错，不猜测价格或单位换算，可手工编辑采购草稿兜底。

HTTP 下载须保持鉴权，并设置附件下载、`nosniff` 与 `no-store`。页面预览采用鉴权 fetch 取得 blob；短期令牌不能单独替代登录。共享异步操作结果查询还须由主任务增加文件/解析任务资源追溯。

开发 worker：`tsx scripts/parse-worker.ts`；编译后：`node --max-old-space-size=192 apps/api/dist/apps/api/src/source-files/worker-main.js`。生产沿用 `DATABASE_URL` 与 `FILE_STORAGE_DRIVER=cos` 等私有存储配置。OCR 配置为 `TENCENT_OCR_SECRET_ID`、`TENCENT_OCR_SECRET_KEY`、可选 `TENCENT_OCR_REGION`。

## 验证与边界

- 先行失败：`私有原文件` 用例在未实现 upload 时失败；新增模板、冻结后幂等重放及结果字节上限均先见失败后修复。2026-10-26 补审四项（停用医院、销售代录草稿、结构化 OCR、采购备注）各自先见失败后修复；新增合并区域资源上限回归。
- 本地：`TEST_DB_MODE=pglite tsx --test apps/api/test/source-files.test.ts`，26/26 通过；独立端口 25452。
- 类型：`tsc --noEmit -p apps/api/tsconfig.json` 通过。
- 这些证据不代表标准 PostgreSQL 多连接竞争、真实 COS/受保护文件系统、真实腾讯 OCR、微信真机或云端验收。HTTP、页面与全库回归由主任务统一验收。

## 依赖与官方依据

新增仅 SheetJS CE 0.20.3 官方发行包，由主任务集中安装并维护锁文件；Apache-2.0，保留供应链检查，不使用 npm 中陈旧 0.18.5。

- [SheetJS 官方发行、当前推荐版本及许可](https://cdn.sheetjs.com/)
- [SheetJS Node 安装与固定官方包](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [SheetJS 安全与避免 HTML 链接执行](https://docs.sheetjs.com/docs/miscellany/security/)
- [腾讯表格识别 V3 参数与限制](https://cloud.tencent.com/document/api/866/86721)
- [腾讯表格单元格行列坐标与原文结构](https://cloud.tencent.com/document/api/866/33527)
- [腾讯 TC3 签名方法](https://cloud.tencent.com/document/api/866/33519)
