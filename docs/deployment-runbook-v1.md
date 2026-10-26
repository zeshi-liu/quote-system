# 单机试用部署与备份操作手册 v1

- 基线：已确认 A 路线，2 名销售、2 核 4 GB、同机 PostgreSQL 17.11、业务文件私有 COS。
- 本文交付可审阅部署配置与脚本。尚未购买资源、部署云端、实际上传备份或恢复演练。RPO 2 小时/RTO 4 小时是目标，未经实测不宣称达标。
- 真实 AppID、域名/备案/证书、地域、预算、维护人与告警接收人仍须落实。无 AppID 时 PC 可用；小程序真机、微信医院登录与订阅外发不能验收。REMINDER_SEND_WECHAT 默认 false。

## 一 产物和隔离

`deploy/compose.yaml` 为完整单机入口，要求 Docker Engine + Compose 2.22 以上（additional_contexts）。`deploy/worker-compose.yaml` 是旧的独立导出 worker 片段，保留供开发/独立环境参考，**生产不要叠加启动该片段或旧 delivery/parser worker**。生产 `heavy-worker` 在同一进程依次执行导出与解析，共用数据库会话锁，集群内并发上限 1；提醒独立进程；每小时维护只删除过期查询快照与主数据操作预览，不删除订单、回款或业务原文件。导出 worker 自带的临时对象清理仅处理 24 小时前、终态任务且无成功业务引用的导出对象。

CPU 上限允许短时竞争；内存硬上限约 2.9 GiB（含单次备份），余量留给操作系统、Docker 与缓存。重任务 1 GiB（包含子进程）、API 512 MiB、PostgreSQL 768 MiB、提醒 192 MiB、维护 128 MiB、入口 96 MiB、备份 256 MiB。此为试用起点，须按真实 100 行订单及导出实测。API/各 worker 连接池 5；数据库最多 40。API/数据库均无公网端口映射，仅入口 80/443。数据库持久化卷禁止 `docker compose down -v`；应用重建不删除卷。

HTTPS 入口另接 `ingress` 网络接收 80/443，与 API 仅通过 `trusted-proxy` 内部网络通信；固定入口 172.30.90.2、API 172.30.90.3（子网 172.30.90.0/29，可整体配置）。入口不加入后端 default 网络，API 保留 default 网络访问数据库与必要的外部服务。Compose 将 API 的 TRUSTED_PROXY_IPS 限定为配置后的入口单一 IP，nginx 覆盖 X-Forwarded-For 为实际 socket 客户端地址；不使用 trust proxy=true 或信任全部私网。直接访问 API 的不可信对端不能借 XFF 冒充他人；可信入口传入多地址/无效 XFF 被拒绝。自定义部署不走此 Compose 时须明确指定唯一代理 IP，并单独验证来源隔离及限流；默认空配置不信任转发头。目标 Linux 仍须验证两个客户端经 HTTPS 的限流相互隔离、伪造 XFF 被入口覆盖，以及数据库/API 没有公网入口。

构建在独立构建环境完成，不在有业务写入的 2 核主机安装依赖/打包。镜像采用 Node 24、pnpm 11.25.0、PostgreSQL 17.11；正常 `--frozen-lockfile`，不绕过依赖信任策略。版本标签仍可移动，上线构建须解析并记录镜像摘要、commit、锁文件校验和及配置版本，审核后使用 `QUOTE_*_IMAGE` 固定产物。Dockerfile 的 Dockerfile 专属 ignore 会排除 .env、主机依赖、密钥与本地数据；凭证只在宿主受限目录或挂载文件中。

## 二 受保护配置

仓库不保存实际配置或凭证。下面列出字段名，值须由运维写入 `/etc/quote`，目录 0700、环境文件 0600；禁止 `docker compose config` 原样贴到日志或对话（会展开密码），可使用 `config --quiet`。

| 文件 | 必需内容 |
| --- | --- |
| compose.env | QUOTE_ENV_FILE=/etc/quote/runtime.env；QUOTE_MIGRATION_ENV_FILE=/etc/quote/migration.env；QUOTE_BACKUP_ENV_FILE=/etc/quote/backup.env；QUOTE_DOMAIN 实际域名；QUOTE_CERT_DIR（含 fullchain.pem/privkey.pem）；QUOTE_FONT_DIR（合法授权 Noto CJK）；QUOTE_POSTGRES_PASSWORD_FILE、QUOTE_MIGRATOR_PASSWORD_FILE、QUOTE_APP_PASSWORD_FILE；QUOTE_BACKUP_RECIPIENTS_FILE；QUOTE_RESTORE_INPUT_DIR；三个 QUOTE_*_IMAGE 固定镜像；若与现有网络冲突，整体调整 QUOTE_PROXY_SUBNET、QUOTE_PROXY_WEB_IP、QUOTE_PROXY_API_IP（默认 172.30.90.0/29、.2、.3） |
| runtime.env | NODE_ENV=production；DATABASE_URL 使用 quote_app、postgres:5432/quote_system、至少 16 位随机且 URL 编码的密码；SUPPLIER_WEB_URL=https://实际域名/supplier；ALLOWED_ORIGINS=https://实际域名；TRIAL_PASSWORD_LOGIN=false；DEV_PGLITE=false；FILE_STORAGE_DRIVER=cos；COS_SECRET_ID、COS_SECRET_KEY、COS_BUCKET、COS_REGION；QUOTE_SELLER_NAME、QUOTE_CONTACT；EXPORT_FONT_PATH=/fonts/NotoSansCJK-Regular.ttc、EXPORT_FONT_FAMILY=NotoSansCJKsc-Regular；REMINDER_SEND_WECHAT=false |
| migration.env | 仅 MIGRATION_DATABASE_URL，使用 quote_migrator 角色；不要把迁移凭证放入运行配置 |
| backup.env | BACKUP_DATABASE_URL（专用只读备份角色）；BACKUP_COS_SECRET_ID、BACKUP_COS_SECRET_KEY、BACKUP_COS_BUCKET、BACKUP_COS_REGION；COS_BUCKET（用于拒绝同业务桶）；BACKUP_SCOPE（环境标识，小写字母/数字/连字符）；BACKUP_AGE_RECIPIENTS_FILE=/run/backup-recipients.txt；BACKUP_WORK_DIR=/backup-work |
| ops-alert.env | 从 `deploy/ops-alert.env.example` 复制到 `/etc/quote/ops-alert.env`、0600；OPS_ALERT_DRIVER 默认 disabled；实际启用时设 webhook、OPS_ALERT_WEBHOOK_URL 为受控 HTTPS 告警接收地址，可选 OPS_ALERT_BEARER_TOKEN，OPS_ALERT_TIMEOUT_MS 为 1–10000 毫秒（默认 5000）。不把此文件放业务容器或镜像 |
| 三份密码文件 | 对应 PostgreSQL 管理员、quote_migrator、quote_app 原始随机密码；运行连接串密码与此一致。Docker 文件型 secrets 保留宿主权限，须将这三份文件设置为镜像 postgres 用户 UID 可读（通常 UID 999、0400），并在目标镜像核对 UID，勿假定 compose mode 能改 bind 文件权限 |
| backup-recipients.txt | age 公钥（建议 age-keygen 生成）；恢复私钥离线异地保管，不放备份主机/运行镜像；公钥挂载文件可设 0444（宿主目录仍 0700），使 backup 容器 postgres 用户可读 |

COS 业务桶与备份桶均设私有且必须分开；备份使用独立最小权限账号，仅允许指定 `backups/BACKUP_SCOPE/` 下上传/读/列出/删除（保留策略需要删除），不授权业务桶。业务 COS 版本控制及对象共同恢复须另行验收。备份只读数据库角色由运维在迁移完成后创建，授予 CONNECT、public USAGE、所有业务表 SELECT 及未来表默认 SELECT；不可使用 quote_app 写账号或数据库超级用户执行计划备份。

`deploy/postgres-init.sh` 仅对空数据卷创建角色，初始化独立数据库所有者 quote_migrator 与仅业务 DML 的 quote_app，应用没有 DDL/建库/角色权限。迁移后撤销 quote_app 对迁移版本表的写权限。已有卷不自动改密码/权限，须按变更流程处理。

默认不配置 OCR 或微信凭证，不发生对应外部调用；Excel 解析、人工录入及站内待回款独立使用。启用 OCR 须配置 TENCENT_OCR_SECRET_ID/KEY/REGION 并核对实际服务开通。启用微信须真实 AppID/Secret、订阅模板与字段映射、用户授权及真机验收；另在 compose.env 显式设 REMINDER_SEND_WECHAT=true 才会启用外发。医院手机号匹配与微信绑定必须真实联调。

## 三前 容量暂停与真实数据盘核对

生产 heavy-worker 每次领取导出、每次领取解析之前，单独检查 `/tmp`、`/monitor/postgres`、`/monitor/backup`。后两项分别只读挂载本 Compose 实际的 `postgres-data`、`backup-work` 卷；不推定与容器根盘同盘。还校验 Linux `/proc/self/mountinfo` 中有对应真实挂载点，普通同名目录不能通过。`HEAVY_DISK_PATHS` 必须包含三处，可添加其他实际挂载根目录；不存在、权限不足、statfs/mountinfo 不可读或容量未知均暂停新领取。

使用率按 `(blocks-bfree)/(blocks-bfree+bavail)` 计算，包含普通用户不可用保留空间的影响。达到 75% 输出 `heavy_disk_capacity/warning`；达到 85%（含边界）输出 `paused_full` 并不领取新导出或解析；未知输出 `paused_unknown`。仅记录挂载序号与使用百分比，不记录原始异常/路径/凭证；状态变更立即输出，持续状态每分钟重报。每 2 秒重新探测，容量恢复自动继续。不会因磁盘告警取消已经执行的任务、伪造成功或把未知外部结果改为未发生；不会删除业务原文件腾空间。

本机 Linux/容器部署后维护人执行下面只读检查：

```bash
# 查看 heavy 实际获得的挂载（不查看 env，避免展开凭证）
docker inspect quote-system-heavy-worker-1 --format '{{json .Mounts}}'
# 直接在 PostgreSQL 容器检查 PGDATA 所在文件系统
docker compose -f deploy/compose.yaml exec postgres sh -c 'df -P "$PGDATA"'
# 与 heavy 中同一卷的探测结果核对；未知/满盘时退出非零
docker compose -f deploy/compose.yaml run --rm --no-deps heavy-worker node -e 'require("./deploy/launcher.cjs").capacity(["/tmp","/monitor/postgres","/monitor/backup"]).then(s=>{console.log(JSON.stringify(s));process.exitCode=s.allowed?0:1})'
# 宿主机另监测 Docker 日志/根盘；named volume 数据位置先用 inspect 核实
docker volume inspect quote-system_postgres-data --format '{{.Mountpoint}}'
df -P /var/lib/docker
```

Docker 数据目录若被迁移，应把最后一条改为实际 Docker Root Dir，不能沿用示例推定盘位。只读挂载使 heavy 无法写数据库文件；PostgreSQL 文件权限继续由 postgres 用户持有，不为监测放开读取权限。若具体镜像/宿主安全策略禁止 node 用户 statfs，这一环境会 fail closed，须在目标环境修正可探测能力并重新验证，不能忽略报错。

覆盖局限：该门控覆盖**本 Compose 的 PostgreSQL 与备份卷、重任务临时盘**，不能代表外部托管 PostgreSQL、COS 剩余容量、宿主其他挂载盘或 inode/配额/Thin pool 故障。宿主日志盘、数据库实例与存储告警仍须独立监测，未来更换外部 PostgreSQL 时必须重新明确数据盘监测方案。当前本机无 Docker，只有容量与挂载 fixture 已通过，真实跨容器卷一致性/权限和 85%暂停行为仍待目标 Linux 验收；不使用填满真实盘作为本次测试。

## 三 首次部署（以下命令仅由实际维护人执行）

```bash
# 在已准备配置的构建环境，只构建，不启动服务
set -a
. /etc/quote/compose.env
set +a
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml build api web backup
# 离线配置检查，不等于 COS/数据库/证书连通
# --no-deps 防止检查命令顺带启动数据库
docker compose -f deploy/compose.yaml run --rm --no-deps api node scripts/deployment-preflight.cjs
# 初次创建持久化数据卷和数据库；禁止使用开发 seed
docker compose -f deploy/compose.yaml up -d postgres
docker compose -f deploy/compose.yaml --profile operations run --rm migrate
docker compose -f deploy/compose.yaml run --rm --no-deps api node deploy/launcher.cjs verify-migrations
# 交互执行；管理员信息只传当次环境；临时密码只输出交互终端，不重定向日志
docker compose -f deploy/compose.yaml --profile operations run --rm -e ADMIN_LOGIN_NAME -e ADMIN_NAME -e ADMIN_PHONE init-admin
docker compose -f deploy/compose.yaml up -d api heavy-worker reminder-worker maintenance web
```

首次管理员登录后须设置本人新密码，之后创建两名真实销售账号。代码正常启动只校验迁移版本/校验和，不自动迁移；迁移由单独命令及独立账号执行。PostgreSQL 就绪检查只表示接受连接；API 健康检查额外查询数据库并且启动已验证迁移，仍不代表实际业务/文件权限验收。HTTPS 入口将 `/api/v1` 原路径转发至 API，PC `/`、厂家 `/supplier/`；移动 H5 已打包但 `/mobile/` 默认 404，只有确认构建 base/path 后才能开放，不替代小程序真机验收。

停机发布须先停止重任务/提醒与 API 写入，等待或明确处理在途任务，完成并验证发布前异机备份，失败则停止发布。执行迁移、启动新 API 检查只读页面，再恢复任务与业务。回滚只限兼容应用产物；不自动回滚数据库或覆盖已发生回款。

## 四 每小时加密异机备份

```bash
docker compose -f deploy/compose.yaml --profile operations run --rm --no-deps backup
```

脚本使用 PostgreSQL 17.11 `pg_dump --format=custom --no-owner --no-acl`，先 `pg_restore --list` 检查，再用 age 公钥加密；只有密文上传备份桶。上传后流式回读密文检查长度与 SHA-256，再写清单、回读清单；数据时间使用开始备份前时间，记录完成时间。任一环节失败非零退出，不写 last-success。备份不重叠，锁未释放时拒绝新任务；进程被杀可能遗留锁，运维确认无运行任务后才移除。最近 24 份小时备份与最近 7 个 UTC 自然日各一份保留，日备与小时备去重；不足时全部保留。仅处理本脚本命名空间清单，异常清单使任务失败，未知对象不自动删除。中断上传可能遗留无清单密文，须人工巡检后清理，不把它算成功备份。

安装 `deploy/quote-backup.service`、`deploy/quote-backup.timer` 和 `deploy/quote-ops-alert@.service` 到 systemd 后，核对三个 unit 中的实际发布目录并 reload。备份非零退出会经 OnFailure 启动已提供的告警 unit；unit 只读取独立的 ops-alert.env，经 `ops-alert` 容器调用 `scripts/deployment-alert.cjs`，不挂载业务或迁移凭据。告警配置文件缺失、默认 disabled 或配置不完整时明确记为 `unavailable` 并非零退出，不能认定告警已经发出。启用 timer 前由维护人配置和测试真实通道及接收人；本次开发没有执行真实外发。

告警适配使用通用 HTTPS webhook：POST JSON `{ "version": 1, "event": "unit_failed", "unit": "quote-backup.service", "occurredAt": "UTC时间" }`，可选 `Authorization: Bearer`。接收端须按此契约接入实际运维告警渠道；URL 查询串也可能含秘密，不得记录配置全文。只接受 HTTPS，不跟随重定向，不读取或打印响应正文，不自动重试。HTTP 2xx 只记录 `accepted`（退出码 0，表示端点接受，并不证明维护人已收到）；非 2xx 为 `rejected`（1）；未配置/无效配置为 `unavailable`（2）；超时或网络响应未知为 `outcome_unknown`（3），由维护人查证后决定下一次动作。告警失败仅在 journald/容器输出留下安全记录，不递归触发自身告警。

配置外部独立监测主机，使用只读备份桶权限每 15 分钟运行 `node scripts/deployment-backup-freshness.cjs`：0=新鲜，2=数据时间超过 90 分钟，3=达到 2 小时目标失守，1=缺失备份/读失败。它直接读异机清单，不依赖 API 或本机 last-success。监测调度器应将 2/3/1 分别接入同一 hook 的 `backup-stale` / `backup-rpo-target-missed` / `backup-monitor-failed` 事件（例如加载独立告警配置后运行 `node scripts/deployment-alert.cjs backup-stale quote-backup.service`）；hook 非零须保留，不把发送失败改为监测成功。独立主机、实际调度及接收验收仍待维护人落实；只安装 timer 不等于告警可用。

备份、恢复和新鲜度脚本错误按 JSON 输出 `event/stage/reason`，工具失败额外记录白名单工具名及数字退出码；例如 `backup_failed/dump/tool_failed` 或 `backup_failed/upload_cipher/operation_failed`。阶段覆盖配置、归档、加密、上传/回读、保留、恢复校验与新库恢复；不记录连接串、目录、参数、供应商原始错误或 stderr。systemd 运行时通过 `journalctl -u quote-backup.service` 和对应 `quote-ops-alert@...` unit 查看安全失败记录；实际故障须结合阶段按受控运维流程核查，不把业务账号或秘密复制到日志。

逻辑备份无任意时间点恢复；角色/权限/扩展/配置单独保存重建清单。备份目录只保存状态与短期临时密文，明文 dump 产生后即加密并删除，运行失败 finally 清理。磁盘不足/备份失败不得忽略或删除业务记录腾空间。

## 五 隔离恢复（禁止覆盖现有数据库）

先从备份桶下载明确的 `.dump.age` 与同名 `.json` 到隔离主机受保护目录，另从安全保管处取得 age 恢复私钥。脚本仅接受 `quote_restore_` 前缀的新库，必须显式确认、校验文件长度和 SHA-256、age 验证解密、`pg_restore --list` 后才新建库；现存目标必拒绝。无 DROP、--clean 或覆盖路径。恢复失败留下的隔离库由维护人审阅；脚本不自动删除。

在有 PostgreSQL 17.11 客户端、age、Node 24 及项目依赖的隔离恢复环境设置：RESTORE_BACKUP_FILE、RESTORE_MANIFEST_FILE、RESTORE_TARGET_DATABASE=quote_restore_演练编号（仅小写字母数字下划线）、RESTORE_ADMIN_URL（隔离实例管理员连接）、RESTORE_AGE_IDENTITY_FILE、RESTORE_CONFIRM=CREATE_NEW_ISOLATED_DATABASE，执行：

```bash
node scripts/deployment-restore.cjs
```

容器工具可复用 backup 镜像：将输入文件与私钥放入单独受控恢复输入挂载，在明确提供上述 RESTORE 环境后使用 `docker compose ... run --rm --entrypoint node backup scripts/deployment-restore.cjs`。私钥不放 runtime.env/backup.env，不挂载业务运行容器；恢复容器以 postgres 用户运行时私钥文件须该 UID 可读且仅该 UID 可读。脚本不会自动把恢复库切为在线生产库。

恢复后必须在隔离环境核对当前采购修订/确认版本、应收/有效已收/余额、业务文件对象/哈希、审计及任务状态；撤销旧 auth_sessions、supplier_sessions/链接、绑定/密码/下载/预览凭证，防止恢复出来的旧链接生效（按业务规则生成新链接，不篡改旧提交）。备份点后真实发送/医院确认/回款与线下依据逐项核对；外部结果未知不盲目重发。只有权限、文件与账实验收通过才另行安排维护窗口切换，恢复后只评估当天催收。

开始记录备份数据时间、故障发生时间、恢复开始/完成时间、抽核证据及责任人；以实际差值评估 RPO 2 小时/RTO 4 小时。上线前一次、每月至少一次、数据库大版本或备份方式变更后追加演练。归档可读、fixture 通过、HTTP 200、数据库创建成功均不等于恢复验收。
