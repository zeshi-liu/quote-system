# 中药饮品报价系统 PRD（A 方案：销售员内部使用）

版本：v1.0  
日期：2026-07-04  
适用范围：一期 MVP，可直接作为 Codex 开发输入  
目标用户：中药饮品销售员、销售主管/管理员

## 1. 背景与目标

### 1.1 当前人工流程

1. 医院采购员发送采购单给销售员。
2. 销售员将采购单转发给两个厂家报价员。
3. 两个厂家报价员输出含税、含抽点的报价单。
4. 厂家将报价单发给销售员。
5. 销售员根据两个厂家全品类历史最低报价进行二次修改。
6. 销售员将二次修改后的报价单发给医院采购员。
7. 医院采购员确认报价单无误，或反馈价格问题。
8. 销售员拿到确认报价单后联系厂家发货；如有问题，则继续修改报价单并再次发给医院采购员，直到确认无误。

### 1.2 核心痛点

- 采购单多为图片、手写或非标准 Excel，人工录入慢且容易漏项。
- 厂家报价单格式不统一，销售员需要手工查找品类价格。
- 销售员二次调价时需要反复对比两个厂家、历史最低报价、客户历史报价。
- 报价单模板依赖人工复制粘贴，版本容易混乱。
- 客户反馈后重新修改缺少版本记录，难追溯每次改价原因。

### 1.3 产品目标

一期建设一个销售员内部使用的 Web 报价系统，实现：

- 快速录入医院采购单。
- 上传和管理厂家全品类报价单。
- 自动匹配采购品类与厂家最新价格。
- 自动展示两个厂家最新月份采购品类最低报价，以及客户历史报价参考。
- 支持销售员二次加价、单品改价、批量改价。
- 一键生成并导出标准报价单。
- 沉淀每个客户、每个品类、每次报价的历史记录。

## 2. 方案边界

### 2.1 一期选择：A 方案

一期只给销售员和内部管理员使用。

- 医院采购员不登录系统。
- 厂家报价员不登录系统。
- 医院采购单由销售员上传或手工录入。
- 厂家报价单由销售员或管理员上传。
- 报价单导出后，由销售员通过微信、邮件或其他现有渠道发送给医院采购员。

### 2.2 一期必须做

- 账号登录与角色权限。
- 医院/客户档案管理。
- 厂家档案管理。
- 厂家报价单上传、解析、校验、入库。
- 医院采购单上传、OCR/手工录入、校验。
- 报价工作台：匹配品类、比价、二次调价、创建报价单草稿。
- 报价单版本管理。
- 报价单导出 Excel，PDF 可作为可选增强。
- 历史报价查询。

### 2.3 一期不做

- 医院采购员在线填写采购链接。
- 医院采购员在线确认报价。
- 厂家报价员登录系统。
- 自动通知厂家发货。
- 库存、物流、发票、回款管理。
- 复杂 CRM、销售业绩提成管理。
- 多租户 SaaS 化。

### 2.4 后续可扩展

- 医院采购员采购单填写链接。
- 医院采购员报价确认链接。
- 厂家端报价上传和发货确认。
- 企业微信/微信服务通知。
- 利润分析和销售提成统计。
- 小程序端。

## 3. 成功指标

一期上线后，建议用以下指标判断是否成功：

- 单张采购单从录入到导出报价单的平均时间减少 60% 以上。
- 厂家报价单上传后，90% 以上的标准品名可自动匹配。
- 报价单导出前，销售员能在一个页面看到厂家最新价、最低推荐价、客户历史价。
- 每次报价至少保留客户、品类、报价价格、版本、销售员、时间。
- 销售员无需手工复制厂家 Excel 即可生成医院报价单。

## 4. 用户角色与权限

### 4.1 角色

| 角色 | 说明 |
| --- | --- |
| 销售员 | 创建采购单、创建报价、上传厂家报价、修改报价、导出报价单、查看自己客户历史。 |
| 销售主管 | 查看所有销售员报价，维护客户、厂家、模板，可审核异常报价。 |
| 系统管理员 | 管理账号、角色、基础字典、系统配置、数据导入导出。 |

### 4.2 权限规则

- 销售员默认只能查看自己创建的客户、采购单和报价单。
- 销售主管可查看和编辑所有销售员的数据。
- 管理员可管理所有基础数据和系统设置。
- 厂家报价库属于内部共享数据，销售员可查看，是否可上传由配置控制。
- 报价单一旦导出或标记为已发送，不允许直接覆盖原版本，只能创建新版本。

## 5. 核心业务流程

### 5.1 一期主流程

1. 销售员登录系统。
2. 销售员进入「工作台首页」，优先点击「新建采购单」。
3. 销售员选择医院，上传手写采购单图片/PDF、导入 Excel，或直接手工录入采购明细。
4. 系统 OCR 或解析采购单明细；销售员人工校对品类、规格、数量、单位。
5. 销售员确认采购单。
6. 销售员点击「创建报价单」。
7. 系统基于采购明细创建报价单草稿，并进入报价工作台。
8. 系统自动使用当前有效厂家报价库匹配每个采购品类的厂家最新报价。
9. 系统展示每个采购明细的厂家 A 价格、厂家 B 价格、最新最低价、历史最低价、该医院历史报价。
10. 销售员使用批量加价或单品改价完成二次报价。
11. 销售员预览报价单。
12. 销售员导出 Excel/PDF 报价单并发送给医院采购员。
13. 若医院采购员反馈价格问题，销售员基于当前报价单创建新版本并修改。
14. 医院确认后，销售员将报价单状态标记为「已确认」。

厂家报价单导入不是销售员每日主流程的前置步骤，而是报价库维护流程。销售员或管理员仅在以下场景进入「厂家报价库」上传报价单：

- 系统首次使用，尚无有效厂家报价库。
- 厂家发布新月份全品类报价单。
- 报价工作台提示厂家报价过期。
- 采购品类缺少厂家价，需要补充报价库。

若当前没有有效厂家报价或某些品类无法匹配厂家价，系统仍允许销售员录入采购单并创建报价单草稿；报价工作台需以「无厂家价」风险提示销售员手工报价或补充厂家报价。

### 5.2 报价单状态机

| 状态 | 说明 | 可执行动作 |
| --- | --- | --- |
| 草稿 | 报价单创建后未导出 | 编辑、删除、生成预览、导出 |
| 已导出 | 已生成 Excel/PDF 文件 | 创建新版本、标记已发送、标记作废 |
| 已发送 | 销售员已发给医院采购员 | 创建新版本、标记已确认、标记需修改 |
| 需修改 | 医院反馈价格或内容问题 | 创建新版本、查看反馈原因 |
| 已确认 | 医院确认报价单无误 | 查看、导出、归档 |
| 已作废 | 报价单不再使用 | 仅查看 |

状态约束：

- 已确认、已作废版本不可编辑。
- 已发送后修改必须创建新版本。
- 每个报价单至少保留一个有效版本。

状态流转规则：

| 当前状态 | 允许流转到 | 触发动作 |
| --- | --- | --- |
| 草稿 | 已导出、已作废 | 导出报价单、作废报价单 |
| 已导出 | 已发送、已作废 | 标记已发送、作废报价单 |
| 已发送 | 已确认、需修改、已作废 | 标记已确认、标记需修改、作废报价单 |
| 需修改 | 草稿、已作废 | 创建新版本、作废报价单 |
| 已确认 | 已作废 | 管理员作废 |
| 已作废 | 无 | 终态 |

## 6. 功能需求

### 6.1 登录与账号

功能：

- 用户使用手机号/用户名 + 密码登录。
- 支持退出登录。
- 支持管理员创建、禁用、重置用户密码。

字段：

- 用户姓名。
- 手机号。
- 登录账号。
- 角色：销售员、销售主管、管理员。
- 状态：启用、禁用。

验收标准：

- 未登录用户访问业务页面时跳转登录页。
- 禁用用户不能登录。
- 销售员不能访问管理员账号管理页面。

### 6.2 医院/客户管理

功能：

- 新增、编辑、停用医院客户。
- 维护医院名称、采购员信息、地区、默认报价模板、负责销售员。
- 在报价时选择医院客户。
- 查看该医院历史采购单和历史报价。

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| hospitalId | string | 是 | 系统生成唯一 ID。 |
| hospitalName | string | 是 | 医院名称。 |
| purchaserName | string | 否 | 医院采购员姓名。 |
| purchaserPhone | string | 否 | 采购员电话。 |
| region | string | 否 | 省/市/区或自定义区域。 |
| salesUserId | string | 是 | 负责销售员。 |
| defaultTemplateId | string | 否 | 默认报价模板。 |
| remark | string | 否 | 备注。 |
| status | enum | 是 | active/inactive。 |

验收标准：

- 医院名称不可为空。
- 同一销售员下医院名称不允许重复。
- 停用医院不出现在新建采购单默认选择列表中，但历史数据可查看。

### 6.3 厂家管理

功能：

- 新增、编辑、停用厂家。
- 维护厂家名称、联系人、报价单导入规则。
- 支持至少两个厂家，系统不硬编码厂家数量。

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| manufacturerId | string | 是 | 系统生成唯一 ID。 |
| manufacturerName | string | 是 | 厂家名称。 |
| contactName | string | 否 | 联系人。 |
| contactPhone | string | 否 | 联系电话。 |
| defaultTaxIncluded | boolean | 是 | 默认是否含税。 |
| defaultCommissionIncluded | boolean | 是 | 默认是否含抽点。 |
| status | enum | 是 | active/inactive。 |

验收标准：

- 停用厂家不允许上传新报价单。
- 历史报价仍能查看停用厂家数据。

### 6.4 品类基础库

目的：

用于解决厂家报价单和医院采购单品名不一致的问题。

功能：

- 新增、编辑中药饮品品类。
- 支持别名管理。
- 支持规格、单位、产地等字段。
- 支持导入 Excel 批量维护。

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| itemId | string | 是 | 系统生成唯一 ID。 |
| standardName | string | 是 | 标准品名。 |
| aliases | string[] | 否 | 别名，如繁简体、俗称、厂家写法。 |
| specification | string | 否 | 规格。 |
| unit | string | 否 | 默认单位，如 kg、g、袋、盒。 |
| origin | string | 否 | 产地。 |
| category | string | 否 | 分类。 |
| status | enum | 是 | active/inactive。 |

匹配规则：

1. 优先按标准品名完全匹配。
2. 其次按别名完全匹配。
3. 再按去空格、去标点、繁简转换后的名称匹配。
4. 若仍无法匹配，进入人工匹配队列。
5. 人工确认后，可选择将该名称加入别名库。

验收标准：

- 未匹配品类在报价工作台中明确标红。
- 销售员必须处理未匹配品类后才能导出报价单。

### 6.5 厂家报价录入与导入

支持录入方式：

- 文件导入：`.xlsx`、`.xls`、`.csv`。
- 手动录入：在页面表格中逐行录入或粘贴报价明细。

支持文件类型：

- `.xlsx`
- `.xls`
- `.csv`

一期不要求支持厂家报价单图片识别。

功能：

- 选择厂家、报价批次日期、生效时间、录入方式。
- 文件导入时，用户上传报价单文件，系统解析 Excel/CSV。
- 文件导入时，系统自动识别或由用户指定字段映射。
- 手动录入时，用户在表格中新增报价明细，字段与文件导入后的系统字段一致。
- 支持从 Excel 复制多行数据后粘贴到手动录入表格。
- 展示录入预览：总行数、有效行、异常行、重复行、未匹配品类。
- 用户修正后确认入库。
- 确认入库后生成新的报价批次。
- 支持查看每次导入批次和导入明细。

推荐字段映射或手动录入字段：

| 系统字段 | 说明 | 必填 |
| --- | --- | --- |
| rawItemName | 厂家原始品名 | 是 |
| specification | 规格 | 否 |
| origin | 产地 | 否 |
| unit | 单位 | 是 |
| taxIncludedPrice | 含税单价 | 是 |
| commissionIncludedPrice | 含抽点单价 | 否 |
| finalFactoryPrice | 本系统用于比价的厂家价 | 是 |
| remark | 备注 | 否 |

价格规则：

- 若文件包含「含税含抽点价」，则作为 `finalFactoryPrice`。
- 若文件只有含税价，则 `finalFactoryPrice = taxIncludedPrice`，并标记 `commissionIncluded = false`。
- 一期不自动计算税点和抽点，只记录价格是否已含。
- 所有价格保留 4 位小数，导出报价单默认显示 2 位小数。

重复处理：

- 同一报价批次内，同一厂家、同一标准品类、同一规格、同一单位存在多条报价时，系统标记为重复。
- 用户需选择保留哪一条，或允许多条保留但必须填写差异备注。

报价批次规则：

- 每次确认导入或手动录入报价，都必须创建一个新的厂家报价批次。
- 厂家报价批次不能覆盖旧批次，即使同一厂家、同一报价日期、生效时间相同，也必须保留为独立批次。
- 系统为每个批次生成唯一批次号，例如 `FQ-20260704-MFR001-001`。
- 旧批次长期保留，用于历史最低价、价格追溯和改价审计。
- 若某次批次导入错误，只能标记为作废或失败，不能物理删除或被新批次覆盖。
- 「厂家最新价」查询时，按厂家维度取最新有效批次；排序规则为 `生效时间 desc -> 报价批次日期 desc -> 创建时间 desc`。
- 页面必须展示每个厂家价格对应的批次号和生效时间，不能只展示月份。

验收标准：

- 导入前必须显示预览，不允许静默入库。
- 手动录入提交前必须进入同样的预览和校验流程。
- 含有异常行时可导入正常行，但异常行必须可下载或查看。
- 同一厂家同一日期重复录入或导入时，系统直接创建新批次，并提示“历史批次将保留，不会覆盖”。
- 批次详情必须可查看来源方式：文件导入或手动录入。

### 6.6 医院采购单录入

支持录入方式：

- 上传图片：`.jpg`、`.jpeg`、`.png`。
- 上传 PDF。
- 手工录入采购明细。
- 从 Excel 导入采购明细。

OCR 要求：

- 一期系统应预留 OCR 服务接口。
- 若 OCR 服务未配置，上传图片后允许用户手工录入，不阻断业务。
- OCR 结果必须进入人工校对页，不能直接生成正式报价。

采购单字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| purchaseOrderId | string | 是 | 系统生成。 |
| hospitalId | string | 是 | 所属医院。 |
| sourceType | enum | 是 | image/pdf/excel/manual。 |
| sourceFileUrl | string | 否 | 原始文件地址。 |
| orderDate | date | 是 | 采购单日期，默认当天。 |
| salesUserId | string | 是 | 创建销售员。 |
| status | enum | 是 | draft/confirmed/quoted/cancelled。 |
| remark | string | 否 | 备注。 |

采购明细字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| lineId | string | 是 | 明细 ID。 |
| rawItemName | string | 是 | 原始品名。 |
| itemId | string | 否 | 匹配后的标准品类。 |
| specification | string | 否 | 规格。 |
| quantity | decimal | 否 | 数量。 |
| unit | string | 否 | 单位。 |
| remark | string | 否 | 备注。 |
| ocrConfidence | decimal | 否 | OCR 置信度，0-1。 |

验收标准：

- 销售员必须确认采购明细后才能创建报价单。
- 品名为空的明细不能保存。
- 数量为空允许保存，但在导出报价单前必须提醒。
- OCR 低置信度字段需要高亮提醒。

### 6.7 报价工作台

报价工作台是一期核心页面。

入口：

- 从采购单详情点击「创建报价单」。
- 从报价单列表点击「继续编辑」。

页面布局建议：

- 顶部：医院名称、采购单号、报价版本、状态、操作按钮。
- 左侧/主体表格：采购明细和报价明细。
- 右侧抽屉或侧栏：当前行的历史报价、厂家报价、改价记录。
- 底部/顶部固定栏：批量加价、保存草稿、预览报价单、导出。

每行展示字段：

| 字段 | 说明 |
| --- | --- |
| 原始品名 | 来自采购单。 |
| 标准品名 | 系统匹配品类，可人工修改。 |
| 规格 | 采购单规格。 |
| 数量 | 采购数量。 |
| 单位 | 采购单位。 |
| 厂家 A 最新价 | 该品类厂家最新有效批次价格，展示价格、批次号、生效时间。 |
| 厂家 B 最新价 | 该品类厂家最新有效批次价格，展示价格、批次号、生效时间。 |
| 最新厂家最低价 | 当前所有有效厂家最新批次中的最低价格。 |
| 历史厂家最低价 | 历史所有厂家报价中的最低价格。 |
| 该医院上次报价 | 同医院、同标准品类最近一次已确认或已发送报价。 |
| 建议基准价 | 系统推荐用于加价的基础价格。 |
| 本次报价 | 销售员最终报给医院的单价。 |
| 加价金额 | 本次报价 - 建议基准价。 |
| 加价率 | 加价金额 / 建议基准价。 |
| 异常标记 | 未匹配、无厂家价、低于历史最低、低于基准价等。 |

建议基准价规则：

默认：

```text
建议基准价 = min(所有启用厂家在最新有效报价批次中的 finalFactoryPrice)
```

若两个厂家最新有效批次不同：

- 各厂家取该厂家最新有效报价批次。
- 页面必须展示每个厂家价格对应的批次号、报价批次日期和生效时间。

若某品类只有一个厂家报价：

- 使用该厂家价格作为建议基准价。
- 行级提示「仅 1 家报价」。

若无厂家报价：

- 建议基准价为空。
- 销售员必须手工填写本次报价。
- 行级提示「无厂家报价」。

历史最低价规则：

```text
历史厂家最低价 = min(所有有效厂家报价明细 finalFactoryPrice)
```

客户历史价规则：

- 优先展示同医院、同标准品类、同规格、同单位的最近一次报价。
- 若没有完全匹配，则展示同医院、同标准品类的最近 3 次报价。
- 历史报价不自动覆盖本次报价，只作为参考。

验收标准：

- 报价工作台加载时自动生成每行建议基准价。
- 未匹配品类、无厂家价、本次报价低于建议基准价的行必须醒目标识。
- 销售员可以手工覆盖任何一行的本次报价。
- 每次手工改价必须记录改价前价格、改价后价格、操作人、时间。

### 6.8 二次加价功能

支持方式：

1. 按比例批量加价：如基准价上浮 5%。
2. 按固定金额批量加价：如每个品类加 2 元。
3. 按毛利率目标反推报价：如目标毛利率 15%，报价 = 基准价 / (1 - 15%)。
4. 单行手工改价。
5. 按选中行批量加价。

舍入规则：

- 系统内部价格保留 4 位小数。
- 工作台显示 2 位小数，可展开查看 4 位。
- 导出报价单默认保留 2 位小数。
- 加价后默认四舍五入到 2 位小数。

最低价保护：

- 若本次报价低于建议基准价，行级红色提示。
- 若本次报价低于该医院历史最低报价，行级黄色提示。
- 一期允许销售员继续导出，但导出前弹窗二次确认。

验收标准：

- 批量加价前必须显示影响行数。
- 批量加价后可在保存前撤销本次批量操作。
- 单行手工改价不影响其他行。

### 6.9 报价单生成与导出

模板内容：

- 医院名称。
- 报价日期。
- 报价单编号。
- 销售员姓名和联系方式。
- 报价明细表。
- 备注条款。

报价明细导出字段：

| 字段 | 说明 |
| --- | --- |
| 序号 | 从 1 开始。 |
| 品名 | 标准品名，必要时保留采购单原始品名。 |
| 规格 | 采购单规格。 |
| 单位 | 采购单位。 |
| 数量 | 采购数量，可为空。 |
| 单价 | 本次报价单价。 |
| 金额 | 数量 * 单价；数量为空时为空。 |
| 备注 | 销售员填写。 |

导出格式：

- 一期必须支持 Excel `.xlsx`。
- PDF 可选，但代码结构应预留 PDF 导出服务。

模板要求：

- 支持一个系统默认模板。
- 支持按医院配置默认模板。
- 模板一期可以通过代码或配置文件维护，不要求可视化设计器。

报价单编号规则：

```text
BJ-{yyyyMMdd}-{hospitalCode或hospitalId后6位}-{三位流水号}
示例：BJ-20260704-HOSP01-001
```

版本号规则：

```text
V1, V2, V3...
```

验收标准：

- 导出的 Excel 文件可被 WPS 和 Microsoft Excel 打开。
- 导出文件名包含医院名称、报价单编号、版本号。
- 已导出的报价单文件地址和导出时间必须保存。
- 同一报价单再次修改时必须创建新版本。

### 6.10 报价历史与查询

功能：

- 按医院查询历史报价。
- 按品类查询历史报价。
- 按销售员查询报价单。
- 查看报价单版本和每次改价记录。

筛选条件：

- 医院。
- 销售员。
- 报价日期范围。
- 报价单状态。
- 品名/标准品名。
- 厂家。

验收标准：

- 在报价工作台点击某一行，可查看该医院该品类最近 3 次报价。
- 历史报价详情可查看原采购单、报价单版本、导出文件。

### 6.11 异常处理

异常类型：

| 异常 | 系统行为 |
| --- | --- |
| Excel 字段无法识别 | 进入字段映射页，由用户手动指定列。 |
| 价格为空或非数字 | 标记异常行，禁止作为有效报价入库。 |
| 品名无法匹配 | 进入人工匹配队列。 |
| 采购单 OCR 识别失败 | 允许手工录入。 |
| 报价工作台无厂家价 | 允许手工填写报价，导出前提醒。 |
| 本次报价低于基准价 | 行级红色提示，导出前二次确认。 |
| 导出失败 | 保留报价草稿，展示错误原因，允许重试。 |

## 7. 数据模型

以下为一期建议数据表。实际开发可使用 PostgreSQL + Prisma，也可按所选技术栈等价实现。

### 7.1 users

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| name | varchar | 姓名。 |
| username | varchar | 登录账号，唯一。 |
| phone | varchar | 手机号。 |
| passwordHash | varchar | 密码哈希。 |
| role | enum | salesperson/manager/admin。 |
| status | enum | active/disabled。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.2 hospitals

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| name | varchar | 医院名称。 |
| code | varchar | 医院编码，可选。 |
| purchaserName | varchar | 采购员姓名。 |
| purchaserPhone | varchar | 采购员电话。 |
| region | varchar | 区域。 |
| salesUserId | uuid | 负责销售员。 |
| defaultTemplateId | uuid | 默认模板。 |
| remark | text | 备注。 |
| status | enum | active/inactive。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.3 manufacturers

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| name | varchar | 厂家名称。 |
| contactName | varchar | 联系人。 |
| contactPhone | varchar | 电话。 |
| defaultTaxIncluded | boolean | 默认含税。 |
| defaultCommissionIncluded | boolean | 默认含抽点。 |
| status | enum | active/inactive。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.4 items

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| standardName | varchar | 标准品名。 |
| specification | varchar | 规格。 |
| unit | varchar | 默认单位。 |
| origin | varchar | 产地。 |
| category | varchar | 分类。 |
| status | enum | active/inactive。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.5 item_aliases

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| itemId | uuid | 关联 items。 |
| aliasName | varchar | 别名。 |
| normalizedAlias | varchar | 归一化别名，用于匹配。 |
| createdAt | datetime | 创建时间。 |

### 7.6 manufacturer_quote_batches

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| manufacturerId | uuid | 厂家 ID。 |
| batchNo | varchar | 系统生成批次号，唯一。 |
| quoteDate | date | 报价批次日期。 |
| effectiveAt | datetime | 生效时间，可为空；为空时默认使用 quoteDate 当天 00:00。 |
| sourceType | enum | file/manual。 |
| sourceFileUrl | varchar | 原始文件地址，手动录入可为空。 |
| uploadedBy | uuid | 上传人。 |
| status | enum | importing/active/failed/voided。 |
| totalRows | int | 总行数。 |
| validRows | int | 有效行数。 |
| invalidRows | int | 异常行数。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.7 manufacturer_quote_lines

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| batchId | uuid | 报价批次。 |
| manufacturerId | uuid | 冗余厂家 ID，便于查询。 |
| itemId | uuid | 标准品类，可为空。 |
| rawItemName | varchar | 原始品名。 |
| normalizedName | varchar | 归一化名称。 |
| specification | varchar | 规格。 |
| origin | varchar | 产地。 |
| unit | varchar | 单位。 |
| taxIncludedPrice | decimal(12,4) | 含税价。 |
| commissionIncludedPrice | decimal(12,4) | 含抽点价。 |
| finalFactoryPrice | decimal(12,4) | 系统用于比价价格。 |
| taxIncluded | boolean | 是否含税。 |
| commissionIncluded | boolean | 是否含抽点。 |
| remark | text | 备注。 |
| status | enum | valid/invalid/duplicate/unmatched。 |
| createdAt | datetime | 创建时间。 |

索引建议：

- `(manufacturerId, itemId, unit)`
- `(itemId, finalFactoryPrice)`
- `(batchId, status)`

### 7.8 purchase_orders

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| hospitalId | uuid | 医院 ID。 |
| orderNo | varchar | 采购单编号。 |
| orderDate | date | 采购日期。 |
| sourceType | enum | image/pdf/excel/manual。 |
| sourceFileUrl | varchar | 原始文件。 |
| salesUserId | uuid | 创建销售员。 |
| status | enum | draft/confirmed/quoted/cancelled。 |
| remark | text | 备注。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.9 purchase_order_lines

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| purchaseOrderId | uuid | 采购单 ID。 |
| rawItemName | varchar | 原始品名。 |
| itemId | uuid | 标准品类。 |
| specification | varchar | 规格。 |
| quantity | decimal(12,4) | 数量。 |
| unit | varchar | 单位。 |
| remark | text | 备注。 |
| ocrConfidence | decimal(5,4) | OCR 置信度。 |
| sortOrder | int | 排序。 |
| createdAt | datetime | 创建时间。 |

### 7.10 quotes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| quoteNo | varchar | 报价单编号。 |
| hospitalId | uuid | 医院 ID。 |
| purchaseOrderId | uuid | 采购单 ID。 |
| salesUserId | uuid | 销售员。 |
| status | enum | draft/exported/sent/needs_revision/confirmed/voided。 |
| currentVersion | int | 当前版本号。 |
| templateId | uuid | 使用模板。 |
| remark | text | 备注。 |
| createdAt | datetime | 创建时间。 |
| updatedAt | datetime | 更新时间。 |

### 7.11 quote_versions

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| quoteId | uuid | 报价单 ID。 |
| versionNo | int | 版本号。 |
| status | enum | draft/exported/sent/needs_revision/confirmed/voided。 |
| exportFileUrl | varchar | 导出文件。 |
| exportedAt | datetime | 导出时间。 |
| revisionReason | text | 修改原因。 |
| createdBy | uuid | 创建人。 |
| createdAt | datetime | 创建时间。 |

### 7.12 quote_lines

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| quoteVersionId | uuid | 报价版本 ID。 |
| purchaseOrderLineId | uuid | 采购明细 ID。 |
| itemId | uuid | 标准品类。 |
| rawItemName | varchar | 原始品名。 |
| displayName | varchar | 导出显示品名。 |
| specification | varchar | 规格。 |
| quantity | decimal(12,4) | 数量。 |
| unit | varchar | 单位。 |
| baseFactoryPrice | decimal(12,4) | 建议基准价。 |
| latestMinFactoryPrice | decimal(12,4) | 最新厂家最低价。 |
| historicalMinFactoryPrice | decimal(12,4) | 历史厂家最低价。 |
| previousHospitalPrice | decimal(12,4) | 该医院上次报价。 |
| quotedPrice | decimal(12,4) | 本次报价。 |
| markupAmount | decimal(12,4) | 加价金额。 |
| markupRate | decimal(8,4) | 加价率。 |
| selectedManufacturerId | uuid | 当前参考厂家。 |
| warningFlags | json | 异常标记。 |
| remark | text | 备注。 |
| sortOrder | int | 排序。 |
| createdAt | datetime | 创建时间。 |

### 7.13 price_change_logs

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| quoteLineId | uuid | 报价明细 ID。 |
| fieldName | varchar | 修改字段。 |
| oldValue | varchar | 修改前。 |
| newValue | varchar | 修改后。 |
| reason | text | 修改原因，可选。 |
| changedBy | uuid | 操作人。 |
| changedAt | datetime | 操作时间。 |

### 7.14 quote_templates

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid | 主键。 |
| name | varchar | 模板名称。 |
| type | enum | excel/pdf。 |
| fileUrl | varchar | 模板文件。 |
| configJson | json | 字段映射配置。 |
| isDefault | boolean | 是否默认。 |
| status | enum | active/inactive。 |
| createdAt | datetime | 创建时间。 |

## 8. API 需求

接口命名可按 REST 实现。若使用 Next.js，可对应到 Route Handlers 或服务端 Actions，但需要保持相同语义。

### 8.1 Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 8.2 Users

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/reset-password`
- `POST /api/users/:id/disable`

### 8.3 Hospitals

- `GET /api/hospitals`
- `POST /api/hospitals`
- `GET /api/hospitals/:id`
- `PATCH /api/hospitals/:id`
- `GET /api/hospitals/:id/quote-history`

### 8.4 Manufacturers

- `GET /api/manufacturers`
- `POST /api/manufacturers`
- `PATCH /api/manufacturers/:id`

### 8.5 Items

- `GET /api/items`
- `POST /api/items`
- `PATCH /api/items/:id`
- `POST /api/items/import`
- `POST /api/items/:id/aliases`

### 8.6 Manufacturer Quotes

- `POST /api/manufacturer-quotes/upload`
  - 上传文件，返回解析任务或预览数据。
- `POST /api/manufacturer-quotes/manual-draft`
  - 创建手动录入草稿，保存用户逐行录入或粘贴的厂家报价明细。
- `POST /api/manufacturer-quotes/preview`
  - 文件导入时根据字段映射生成预览；手动录入时根据录入明细生成预览。
- `POST /api/manufacturer-quotes/import`
  - 确认入库并创建新的厂家报价批次；任何情况下都不覆盖历史批次。
- `GET /api/manufacturer-quotes/batches`
- `GET /api/manufacturer-quotes/batches/:id`
- `GET /api/manufacturer-quotes/latest-prices`
  - 查询指定 itemIds 的最新厂家价格。

### 8.7 Purchase Orders

- `GET /api/purchase-orders`
- `POST /api/purchase-orders`
- `POST /api/purchase-orders/upload`
- `POST /api/purchase-orders/:id/ocr`
- `PATCH /api/purchase-orders/:id`
- `POST /api/purchase-orders/:id/confirm`
- `GET /api/purchase-orders/:id`
- `POST /api/purchase-orders/:id/lines`
- `PATCH /api/purchase-orders/:id/lines/:lineId`
- `DELETE /api/purchase-orders/:id/lines/:lineId`

### 8.8 Quotes

- `GET /api/quotes`
- `POST /api/quotes/from-purchase-order`
- `GET /api/quotes/:id`
- `PATCH /api/quotes/:id`
- `POST /api/quotes/:id/create-version`
- `PATCH /api/quotes/:id/versions/:versionId/lines/:lineId`
- `POST /api/quotes/:id/versions/:versionId/bulk-markup`
- `POST /api/quotes/:id/versions/:versionId/export`
- `POST /api/quotes/:id/mark-sent`
- `POST /api/quotes/:id/mark-needs-revision`
- `POST /api/quotes/:id/mark-confirmed`
- `POST /api/quotes/:id/void`

### 8.9 History

- `GET /api/history/item-prices`
- `GET /api/history/hospital-item-quotes`
- `GET /api/history/quote-line-changes`

## 9. 页面与交互需求

### 9.1 页面列表

| 页面 | 路径建议 | 角色 |
| --- | --- | --- |
| 登录页 | `/login` | 全部 |
| 工作台首页 | `/dashboard` | 销售员、主管、管理员 |
| 采购单列表 | `/purchase-orders` | 销售员、主管 |
| 采购单详情/编辑 | `/purchase-orders/:id` | 销售员、主管 |
| 厂家报价库 | `/manufacturer-quotes` | 销售员、主管、管理员 |
| 厂家报价导入 | `/manufacturer-quotes/import` | 销售员、主管、管理员 |
| 报价单列表 | `/quotes` | 销售员、主管 |
| 报价工作台 | `/quotes/:id/workbench` | 销售员、主管 |
| 报价单预览 | `/quotes/:id/preview` | 销售员、主管 |
| 医院客户管理 | `/hospitals` | 销售员、主管、管理员 |
| 厂家管理 | `/manufacturers` | 主管、管理员 |
| 品类基础库 | `/items` | 主管、管理员 |
| 用户管理 | `/users` | 管理员 |
| 系统设置 | `/settings` | 管理员 |

### 9.2 工作台首页

展示：

- 今日创建采购单数。
- 待处理采购单。
- 草稿报价单。
- 需修改报价单。
- 最近导入厂家报价批次。
- 厂家报价库健康状态：正常、缺失、过期、有异常。

操作：

- 主操作：新建采购单。
- 次操作：继续处理采购单、继续编辑报价单、进入报价单列表。
- 维护操作：上传厂家报价单、查看厂家报价库。

交互规则：

- 工作台首页默认引导销售员从「新建采购单」开始工作。
- 「上传厂家报价单」作为价格库维护入口，不作为每日主流程前置步骤。
- 当无有效厂家报价库时，工作台展示提醒，但不阻断新建采购单。
- 当厂家报价库过期或存在导入异常时，工作台展示风险提示，并提供进入厂家报价库的入口。

### 9.3 厂家报价导入页

流程：

1. 选择厂家。
2. 选择报价批次日期和生效时间。
3. 选择录入方式：文件导入或手动录入。
4. 文件导入时上传文件并确认字段映射；手动录入时进入可编辑表格录入明细。
5. 预览录入结果。
6. 处理异常行、重复行、未匹配品类。
7. 确认入库并创建新报价批次。

关键交互：

- 字段映射必须支持下拉选择 Excel 列名。
- 手动录入必须支持新增行、复制行、删除行、批量粘贴。
- 异常行要显示具体原因。
- 未匹配品名可直接绑定已有标准品类，或新建标准品类。
- 每次确认入库都创建新批次，不提供覆盖旧批次入口。

### 9.4 采购单编辑页

流程：

1. 选择医院。
2. 上传采购单或手工添加明细。
3. 系统识别或导入明细。
4. 销售员校对明细。
5. 点击确认采购单。
6. 点击「创建报价单」，系统基于采购明细生成报价草稿并进入报价工作台。

关键交互：

- 支持表格内直接编辑。
- 支持新增行、删除行、复制行。
- 支持品类搜索匹配。
- OCR 低置信度字段高亮。

### 9.5 报价工作台

关键操作：

- 保存草稿。
- 批量加价。
- 单行改价。
- 查看历史报价。
- 查看厂家报价明细。
- 创建新版本。
- 预览报价单。
- 导出报价单。

必须提示：

- 未匹配品类。
- 无厂家报价。
- 本次报价低于建议基准价。
- 本次报价低于医院历史最低价。
- 数量为空导致金额无法计算。

### 9.6 报价预览页

展示正式报价单样式。

操作：

- 返回编辑。
- 导出 Excel。
- 导出 PDF（可选）。
- 标记已发送。
- 标记已确认。

## 10. 文件处理与存储

### 10.1 文件类型

| 文件 | 支持格式 | 说明 |
| --- | --- | --- |
| 厂家报价单 | xlsx/xls/csv | 必须解析入库。 |
| 采购单 | jpg/jpeg/png/pdf/xlsx/xls/csv | 图片/PDF 进入 OCR 或手工校对；Excel 解析。 |
| 导出报价单 | xlsx | 一期必须。 |
| 导出报价单 | pdf | 可选。 |

### 10.2 存储要求

- 原始上传文件必须保存。
- 导出文件必须保存。
- 文件记录需要关联业务单据。
- 文件名不能作为唯一依据，必须使用系统 ID。

### 10.3 安全要求

- 文件上传需限制大小，一期建议单文件不超过 20MB。
- 只允许白名单文件类型。
- 导入 Excel 时不能执行宏。

## 11. 价格计算规则

### 11.1 基础定义

- 厂家价：厂家报价单中用于比价的 `finalFactoryPrice`。
- 最新厂家价：厂家最新 active 报价批次中对应品类的厂家价。
- 最新最低价：所有启用厂家最新厂家价中的最低值。
- 历史最低价：所有有效厂家报价历史中的最低值。
- 本次报价：销售员最终报给医院的价格。

### 11.2 加价公式

按比例加价：

```text
quotedPrice = baseFactoryPrice * (1 + markupRate)
```

按固定金额加价：

```text
quotedPrice = baseFactoryPrice + markupAmount
```

按目标毛利率：

```text
quotedPrice = baseFactoryPrice / (1 - targetGrossMarginRate)
```

金额：

```text
lineAmount = quantity * quotedPrice
```

若 quantity 为空，则 lineAmount 为空。

### 11.3 精度

- 数据库存储：4 位小数。
- 工作台显示：默认 2 位小数。
- Excel 导出：默认 2 位小数。
- 金额合计：按每行四舍五入后的显示金额求和。

## 12. OCR 与智能识别设计

### 12.1 一期要求

一期必须设计 OCR 抽象接口，但具体 OCR 供应商可以延后配置。

接口输入：

- 文件 URL。
- 文件类型。
- 业务类型：purchase_order。

接口输出：

```json
{
  "lines": [
    {
      "rawItemName": "党参",
      "specification": "",
      "quantity": 10,
      "unit": "kg",
      "remark": "",
      "confidence": 0.86
    }
  ],
  "warnings": []
}
```

### 12.2 降级策略

- OCR 服务不可用时，系统提示用户手工录入。
- OCR 识别结果不直接入正式采购明细，必须经过用户确认。
- 置信度低于 0.8 的字段高亮显示。

## 13. 非功能需求

### 13.1 性能

- 报价工作台 200 行以内，首次加载不超过 3 秒。
- 厂家报价单 1 万行以内，解析预览不超过 20 秒。
- 历史报价查询常用条件响应不超过 2 秒。

### 13.2 可用性

- 核心表格支持键盘编辑。
- 所有批量操作必须可预览影响范围。
- 导入失败要显示具体错误行和原因。

### 13.3 数据安全

- 用户密码必须哈希存储。
- 后端接口必须校验角色权限。
- 销售员不能通过修改 URL 访问其他销售员的报价单。
- 价格修改必须留痕。

### 13.4 审计

必须记录：

- 厂家报价单导入。
- 报价单导出。
- 报价单状态变更。
- 报价明细价格修改。
- 报价单版本创建。

## 14. 推荐技术实现约束

如果从空项目开始，推荐以下一期技术栈：

- 前端/后端：Next.js + TypeScript。
- UI：React + Ant Design 或 shadcn/ui。报价表格建议使用支持虚拟滚动/批量编辑的表格组件。
- 数据库：PostgreSQL。
- ORM：Prisma。
- 文件存储：本地存储用于开发，生产可切换 S3/OSS/COS。
- Excel 解析：SheetJS/xlsx。
- Excel 导出：ExcelJS。
- PDF 导出：后续可用 Playwright 打印或服务端 PDF 库。
- OCR：通过 `OcrService` 接口抽象，供应商可后续接入。

代码分层建议：

```text
src/
  app/
    login/
    dashboard/
    purchase-orders/
    manufacturer-quotes/
    quotes/
    hospitals/
    manufacturers/
    items/
    users/
    settings/
    api/
  components/
    data-table/
    import-wizard/
    quote-workbench/
    price-history-panel/
  server/
    auth/
    db/
    services/
      item-matching-service.ts
      manufacturer-quote-import-service.ts
      purchase-order-import-service.ts
      quote-pricing-service.ts
      quote-export-service.ts
      ocr-service.ts
    repositories/
  lib/
    price/
    excel/
    files/
    validation/
  prisma/
    schema.prisma
```

## 15. 核心服务说明

### 15.1 ItemMatchingService

职责：

- 标准化品名。
- 根据标准品名、别名、归一化名称匹配品类。
- 返回匹配结果和置信标记。

输入：

- 原始品名。
- 规格。
- 单位。

输出：

- itemId。
- matchType：standardName/alias/normalized/manual/unmatched。
- confidence。

### 15.2 ManufacturerQuoteImportService

职责：

- 读取 Excel/CSV。
- 处理手动录入报价明细。
- 执行字段映射。
- 校验价格和单位。
- 调用 ItemMatchingService。
- 生成录入预览。
- 确认入库并创建报价批次和明细。

### 15.3 PurchaseOrderImportService

职责：

- 处理采购单 Excel/CSV。
- 调用 OCR 服务处理图片/PDF。
- 生成采购明细草稿。
- 支持用户确认后入库。

### 15.4 QuotePricingService

职责：

- 根据采购明细生成报价明细。
- 查询各厂家最新价格。
- 计算最新最低价、历史最低价、客户历史价。
- 生成建议基准价。
- 应用批量加价策略。
- 生成 warningFlags。

### 15.5 QuoteExportService

职责：

- 根据报价版本生成 Excel。
- 套用模板。
- 保存导出文件。
- 更新报价状态和导出记录。

## 16. 测试与验收

### 16.1 单元测试

必须覆盖：

- 品名归一化和别名匹配。
- 厂家报价导入字段校验。
- 最新最低价计算。
- 历史最低价计算。
- 批量加价计算。
- 目标毛利率计算。
- 报价状态流转规则。

### 16.2 集成测试

必须覆盖：

- 文件导入厂家报价 -> 预览 -> 创建新报价批次 -> 查询最新价格。
- 手动录入厂家报价 -> 预览 -> 创建新报价批次 -> 查询最新价格。
- 新建采购单 -> 添加采购明细 -> 创建报价单草稿。
- 报价工作台批量加价 -> 保存 -> 导出 Excel。
- 已发送报价单创建新版本。
- 销售员权限隔离。

### 16.3 E2E 测试

建议覆盖主路径：

1. 管理员创建销售员。
2. 销售员创建医院。
3. 系统已有两个厂家有效报价批次。
4. 销售员从工作台首页点击「新建采购单」。
5. 销售员录入 3 个品类并确认采购单。
6. 系统创建报价单草稿并进入报价工作台。
7. 销售员批量加价 10%。
8. 销售员手工修改其中 1 行价格。
9. 销售员导出 Excel 报价单。
10. 销售员标记报价单已发送。
11. 销售员创建 V2 版本并再次导出。

补充覆盖价格库维护路径：

1. 销售员或管理员进入「厂家报价库」。
2. 选择文件导入或手动录入厂家报价。
3. 完成字段映射或手动录入、录入预览、异常处理。
4. 确认入库并创建新的有效报价批次。

### 16.4 验收数据

开发时至少准备：

- 2 个厂家。
- 2 家医院。
- 20 个标准品类。
- 每个厂家 1 份报价单，每份至少 20 行。
- 1 份采购单，包含：
  - 可自动匹配品类。
  - 只能通过别名匹配品类。
  - 无法匹配品类。
  - 无厂家报价品类。

## 17. 开发里程碑

### M1：项目基础与权限

- 初始化项目。
- 登录、用户、角色。
- 数据库 schema。
- 基础布局和导航。

### M2：基础资料

- 医院管理。
- 厂家管理。
- 品类基础库和别名。

### M3：厂家报价导入

- 文件上传。
- Excel/CSV 解析。
- 字段映射。
- 导入预览。
- 报价批次和明细入库。

### M4：采购单录入

- 新建采购单。
- 手工录入明细。
- Excel 导入采购明细。
- 图片/PDF 上传和 OCR 接口占位。

### M5：报价工作台

- 从采购单创建报价单草稿。
- 自动匹配厂家价。
- 展示最新最低价、历史最低价、医院历史价。
- 单行改价和批量加价。
- 报价版本管理。

### M6：导出与历史

- Excel 报价单导出。
- 报价状态流转。
- 报价历史查询。
- 改价日志。

### M7：测试与优化

- 单元测试、集成测试、E2E。
- 导入异常优化。
- 表格性能优化。
- 权限补漏。

## 18. 风险与处理策略

| 风险 | 影响 | 策略 |
| --- | --- | --- |
| 手写采购单 OCR 准确率不足 | 采购单录入仍需人工校对 | 一期强制人工确认，OCR 作为辅助。 |
| 厂家报价单格式不统一 | 导入失败或字段错位 | 做字段映射和导入预览，不静默入库。 |
| 品名不统一 | 价格匹配失败 | 建立标准品类和别名库，人工匹配后沉淀。 |
| 销售员改价逻辑复杂 | 报价错误 | 工作台显示基准价、历史价和异常提示。 |
| 历史价格口径争议 | 推荐价不可信 | 明确最新最低价、历史最低价、客户历史价三个概念。 |
| 报价版本覆盖 | 无法追溯 | 已发送/已确认后强制新版本。 |

## 19. 待业务确认事项

以下事项不阻塞一期开发，但建议在开发前确认：

1. 「中药饮品」是否实际指「中药饮片」。若是，系统显示文案应统一为「中药饮片」。
2. 厂家报价单中的「含抽点」是否已经是最终成本价，还是需要系统根据抽点比例计算。
3. 医院报价单是否必须显示数量和金额，还是只需要显示单价。
4. 报价单模板是否已有固定 Excel 样式。
5. 销售员是否允许看到所有客户历史报价，还是只能看到自己负责客户。
6. 本次报价低于厂家基准价时，是否需要主管审批。一期默认只提示，不拦截。

## 20. 一期交付定义

满足以下条件即可认为一期完成：

- 销售员可以登录系统。
- 销售员可以维护医院、厂家、品类。
- 销售员进入工作台后可以直接新建采购单并录入采购明细。
- 销售员或管理员可以通过厂家报价库文件导入或手动录入厂家报价，并生成可追溯的新报价批次。
- 系统可以根据采购单创建报价单草稿并进入报价工作台。
- 报价工作台可以展示厂家最新最低价、历史最低价、医院历史价。
- 当缺少厂家报价时，系统不阻断采购单录入和报价单草稿创建，但需在报价工作台提示「无厂家价」。
- 销售员可以批量加价和单行改价。
- 系统可以生成报价单版本。
- 系统可以导出 Excel 报价单。
- 系统可以记录报价历史和改价日志。
