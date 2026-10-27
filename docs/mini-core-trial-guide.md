# 小程序核心流程体验指南

- 当前工程：销售手工录入与校对、采购冻结、两家厂家真实 H5 提交、表格比价、计价保存，以及报价导出、手工发送登记、实际确认和唯一应收基础。
- 2026-10-23 新增闭环的启动、文件存储和证据见 [报价交付说明](quote-delivery-trial-guide.md)，本页保留第一批核心流程的操作记录。
- 已授权工程开发；真实微信小程序尚未注册，AppID、微信绑定、真机预览及云端 HTTPS 验收未完成。
- 界面原型仍留在 `prototype-v3/`；实际工程位于 `apps/mini/`、`apps/supplier-h5/`、`apps/api/`，数据由后端保存。

## 环境与启动

使用 Node.js 24 和 pnpm 11.25.0。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
```

标准 PostgreSQL：复制 `.env.example` 并填写自己的开发数据库地址；有 Docker 的环境可以先在本地设置 `POSTGRES_PASSWORD` 后执行 `docker compose up -d postgres`。本仓库不代购云资源。没有 Docker 时可运行 `pnpm db:local` 启动本地二进制辅助程序；当前电脑的该原生方式已出现 `postmaster became multithreaded during startup`，常规 locale 调整后仍失败，尚未修复，不把失败写为通过。

为继续本地功能联调，可以单独使用开发用 PostgreSQL WASM：

```sh
pnpm db:offline
```

保持该终端运行，再开终端，仍在仓库根目录执行：

```sh
set -a
source .local/trial.env
set +a
pnpm db:seed
pnpm dev:api
```

另开两个终端：

```sh
pnpm dev:mobile-web
```

```sh
pnpm dev:supplier
```

开发浏览器入口为 `http://127.0.0.1:5173`；厂家页面由系统生成 `http://127.0.0.1:5174/#token=...` 链接。API 监听 `127.0.0.1:3000`。不会自动发送消息。本轮新增文件导出需要独立 worker 与显式文件存储配置；销售登记医院实际确认后才建立应收，详见报价交付说明。

试用登录名为 `trial.sales`；随机密码保存在本机 `.local/trial-credentials.json` 的 `trialPassword`，也写入权限为 600 的 `.local/trial.env`。这些文件被 Git 忽略，禁止上传。只用本批虚构医院、采购员和厂家验证流程，不录入正式业务资料。初始化遇到已有不同密码时明确拒绝覆盖。

PGlite 在这里运行 PostgreSQL SQL 与数据持久化，但只有单后端连接，本地 API 的连接池因此设为 1。它用于离线功能验证，**不能证明标准 PostgreSQL 多连接行锁、故障恢复、容量或生产可用性**；实现仍使用 node-postgres、关系型迁移及原定标准 PostgreSQL 部署方案。可核对 [PGlite socket 的官方限制](https://pglite.dev/docs/pglite-socket#limitations-and-tips)。生产环境明确拒绝开发用 PGlite 标志及试用密码入口。

## 编译小程序与真机准备

```sh
pnpm --dir apps/mini build:mp-weixin
```

构建目录为 `apps/mini/dist/build/mp-weixin`，不是现有 HTML 原型。使用微信开发者工具导入该目录。注册后在 `apps/mini/src/manifest.json` 的 `mp-weixin.appid` 设置本项目真实 AppID 并重新构建；当前未配置，产物为 `touristappid`，不能据此验收微信身份或体验版。前端配置只放 AppID，AppSecret 只在后端 `WECHAT_APP_SECRET` 配置，不放源码、截图或聊天。

当前用户尚未注册小程序。先通过 [微信公众平台注册入口](https://mp.weixin.qq.com/) 按实际使用主体创建小程序，取得 AppID，再安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。注册/类目/资质及后台具体入口以官方实时界面为准；本轮官方文档页面读取受限，未验证当前账号的实际资格和权限。

本地真机联调时，小程序 `VITE_API_BASE_URL` 不能保留 `127.0.0.1`，需指向手机可访问的开发 API 地址；H5 链接的 `SUPPLIER_WEB_URL` 也需指向厂家手机可访问的地址，不能只改小程序端。API 监听地址和开发 CORS 来源按实际内网地址显式配置。正式体验版须按已确认部署设计完成 HTTPS、服务器域名及微信实际配置核验，不将本地绕过域名校验作为上线条件。

真实微信登录调用后端的微信凭证交换和内部账号绑定；未配置 AppID/AppSecret 时返回 `WECHAT_NOT_CONFIGURED`。开发试用登录只在服务端显式启用且非生产时出现可用入口，不能冒充已完成真实微信绑定。

## 试用脚本

1. 用试用账号登录，选择虚构医院和该院具体采购员，填写实际接收日期。
2. 手工新增药品、规格及 kg 数量，逐行核对，保存后重新进入核对结果；冻结前复核全部行。
3. 选择两个不同厂家，分别生成链接并手动复制。关闭页面再发送时须明确重置，旧链接失效；已提交后必须明确重新询价。
4. 在独立浏览器窗口打开厂家 A 链接，完整填写每行价格/缺货及有效至日，复核提交。
5. 回销售端刷新表格，确认 A 原价、最低价、待报价和缺货状态；只有一家提交时显式确认提前计价。
6. 设置固定金额、比例或倍率加价，检查推荐价；明确采用或输入最终价并逐行确认，保存后重新加载。
7. 厂家 B 提交更低价。实时比价更新，草稿已采用价格不自动变化；主动采用后，原最终值保留，变动行重新确认。
8. 将已选基准厂家重新询价，核对旧链接和原 H5 会话失效、原厂家报价保留、草稿基准不可继续使用、最终值仍在。
9. 两家都缺货时保留完整采购数量和规格；一缺货一待报价不能当双家缺货。含价格报价的有效期不能超过所选基准最早到期日。
10. 重启 API 后重新查看订单、厂家提交和已保存计价；试手机键盘、长药名、20 行以上表格、滚动和按钮位置，再决定最终布局。

## 验证命令与边界

```sh
pnpm test:offline
pnpm test:ui
pnpm typecheck
pnpm build
```

离线回归当前覆盖 10 组 API/金额测试：采购、厂家提交、计价及后到价采用、重复请求/原文不重放、冻结行数据库守卫、48 小时与价格日期独立、锁等待跨午夜、交接后的回执权限、旧入口等待后撤销，以及测试数据库凭证下的绑定冲突/一次性/过期与会话撤销/停用。绑定测试不调用微信，也不生成正式身份。离线并发场景被单连接串行化，不作标准 PostgreSQL 锁竞争通过声明。

标准 PostgreSQL 使用专用测试数据库 `quote_core_test`：

```sh
export TEST_DATABASE_URL=postgresql://postgres:YOUR_TEST_PASSWORD@127.0.0.1:5432/quote_core_test
pnpm test
```

每轮在专用库建立独立随机 schema，完成后仅清除此 schema，不修改正式业务库。CI 配置见 `.github/workflows/core-trial.yml`，运行结果须以 GitHub 实际任务为准。

2026-10-22 本地已执行：10 组 API/金额离线回归、10 组前端金额/撤销/链接/恢复行为回归、后端及两前端类型检查、后端编译、微信包与两种 H5 构建。真实 API 浏览器联调已完成采购二次保存、冻结、两家 H5 独立提交、先一家计价、后到价主动采用、最终价及缺货行保留、刷新恢复；390 px 页面没有横向溢出或脚本错误。模拟 503 响应、查询 not_found、刷新后同键重试及原请求迟到，未重复建单；保存期间编辑与导航被禁止。另从无关工作目录启动新编译 API 进程，读回同一已保存草稿。浏览器使用开发用 PGlite，这些结果均不替代标准 PostgreSQL 多连接、真实微信、手机键盘/触摸和云端验收。

待核实操作会按账号保存原请求和请求键；`not_found` 只表示暂未查到，不能据此换新键再建单。身份失效后先重新登录同一账号再核对，旧记录缺少原请求内容时保留待核对并联系维护人员处理。

GitHub 的[标准 PostgreSQL 17.11 验证](https://github.com/zeshi-liu/quote-system/actions/runs/39765104814)已通过，含 10 组 API/金额测试（多连接锁等待、撤销后新读与并发提交）、10 组前端回归、类型检查及全部构建。核心代码提交为 `cee84d2c04992dea064a86200b716f2facda0d92`；后续仅补齐验收文档。第一批已按用户指令合并 [PR #1](https://github.com/zeshi-liu/quote-system/pull/1)，主分支提交 `fd67dfb45a71ca6c4ef7ad1af0d8cc3fcb53b269`，[合并后 PostgreSQL CI](https://github.com/zeshi-liu/quote-system/actions/runs/39883984188)通过。本轮后续交付另在 `codex/quote-delivery`。标准测试数据库通过不代表腾讯云部署、恢复演练或微信真机通过。
