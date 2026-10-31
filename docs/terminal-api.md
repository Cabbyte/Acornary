# Android 终端接口 v1

独立 OAuth 资源 `https://acornary.protium.top/api/terminal/v1`。主应用为无客户端密钥的 public client，Authorization Code + PKCE S256；申请 `openid offline_access inventory:read inventory:write`。回调精确为 `/android/oauth/callback`。Web cookie 不能代替终端 bearer token，动态注册与 OAuth 管理端点保持关闭。

每个私有请求验证签名、issuer、audience、客户端、scope、成员关系和 `auth_version`，家庭由令牌 reference 绑定。手机提交的家庭 header 不参与授权。领域写入复用 execute，来源为 `ANDROID`，不修改 Web 或 MCP 的接口语义。

## 契约

定义：`packages/contracts/src/terminal.ts`。

| 方法与路径（除特殊说明外位于 /api/terminal/v1） | 行为 |
| --- | --- |
| GET /config | 公开客户端 ID、版本、授权端点、scope；未配置返回 503 |
| GET /context | 账号、授权家庭、家庭时区、操作能力 |
| GET /snapshot | 同一 REPEATABLE READ 只读事务中生成完整当前库存；结束物品除外，容器保留 |
| GET /items/:id | 包含已结束物品的单件详情及只读笔记 |
| GET /items/:id/history?limit=20&cursor=… | 只读分页历史，先核对物品归属 |
| POST /commands/open_item | item_id、opened_at、expected_revisions、idempotency_key |
| POST /commands/consume_item_content | item_id、十进制字符串 amount、原单位、accuracy、expected_revisions、idempotency_key |
| POST /commands/consume_items | item_ids 严格一件、expected_revisions、idempotency_key |
| GET /operations/:key | 当前家庭及操作者的已提交结果；找不到返回 unknown，不等于失败 |
| GET /.well-known/assetlinks.json | 仅发布 Android 包名与公开证书指纹 |

三类操作都必须有目标 revision；开封必须有明确时间。容器不开放消耗。幂等重放仍检查原参数指纹；后续物品变化不妨碍查到原结果。版本冲突由用户核对后生成新的操作，禁止悄悄覆盖。

snapshot 的每件物品包含名称、品牌、规格、位置路径/ID、剩余量、生命周期、开封/到期日期、revision，以及服务端 `reminderDate` 的日期和依据。未知日期没有伪造值。提醒按家庭时区计算，Android 不重写开封保质期规则。

v1 兼容新增 `created_at`、`label_updated_at`，快照和单件详情一致。后者以创建时间及标签相关事件的 `recorded_at` 计算，逆序还原有效名称、SKU 规格、到期日期及日期类型；共享 SKU 更新影响关联物品，自定义名称屏蔽无关 SKU 改名。移动、笔记、余量及单纯开封不计入。没有日期时，不可见的日期类型变化也不计入。查询仍处于同一只读事务，无服务端表迁移。Android 按家庭时区取最近自然日，不使用一般 `updated_at` 或缓存同步时间。

响应均禁止缓存。认证错误统一 `TERMINAL_AUTH_INVALID`；业务无权限和认证失效分开处理。无效标识/分页/命令参数返回 400，跨家庭物品返回 404，revision 或幂等冲突返回 409。令牌和授权回调 URL 不进入请求日志。

## 注册与发布

沿用 [正式发布链路](releases.md)。本次没有业务表结构迁移。先发布包含注册命令的兼容镜像，配置为空时旧应用照常工作、终端配置返回 503。

注册命令在已授权的服务器数据库运维容器中运行，只需要该容器已有 DATABASE_URL 和公开 origin，不需要把登录凭据传给命令：

```sh
node dist/apps/server/src/register-terminal.js --origin=https://acornary.protium.top
```

命令以数据库 advisory lock 串行注册同一 softwareId，验证已有 public client 的 PKCE、grant、回调和禁用状态，重复运行复用 ID。输出只有公开 `ACORNARY_TERMINAL_CLIENT_ID=...`。它不开放 HTTP 客户端管理 API。注册同时配置固定资源的 `openid offline_access inventory:read inventory:write`，使刷新令牌能够严格轮换；访问令牌 300 秒、刷新令牌 30 天。

在服务器现有私有 `app.env` 中增加以下两项后按运行流程重新创建 app：

```text
ACORNARY_TERMINAL_CLIENT_ID=<注册命令输出的公开 ID>
ACORNARY_ANDROID_CERT_SHA256=43:86:9E:7E:B6:34:F1:4A:18:FC:EE:65:1B:C8:FF:60:2E:59:D5:50:F1:56:DA:7E:01:3D:15:7B:69:E4:47:B9
```

证书指纹格式错误会拒绝启动，不静默过滤。服务器不接收 Android 私钥。发布后核对公开配置、assetlinks、匿名私有接口 401 和现有 Web/MCP 回归。手机验证 App Link 后由用户本人完成登录。

2026-10-30 已在正式 v0.11.0 环境完成注册和配置，公开 client ID 为 `acornary_android_4a31c01a-49d0-4553-9c40-071c55c6b466`。`/config`、`assetlinks.json`、Google Digital Asset Links 声明查询及匿名 PKCE 请求检查均通过；设备本机验证和真实账号登录仍待完成，见 [验收记录](../apps/android/docs/acceptance.md)。该 ID 是公开标识，不是凭据。后续环境应运行注册工具取得各自 ID，不复制正式环境数据库或令牌。

## Android 持久化与恢复

- Room 原子写入 session + 完整解析后的 snapshot；家庭切换清理旧缓存，退出或授权失效清理展示。
- `noBackupFilesDir` + Android Keystore AES-GCM 保护 AppAuth 状态，AtomicFile 替换。云备份和设备迁移排除所有数据域。
- 刷新入口由 Mutex 串行；发送前落盘 refresh-in-flight。响应丢失或进程中断后重新登录，不复用已经可能轮换的旧刷新令牌。
- 提交前保存幂等键、原 JSON、revision、作用域。超时先查询，未知结果显示待确认。前台刷新恢复时也核对；手动重试保持相同参数和键。
- AOD 只有同签名只读展示投影，包含家庭名、时区、同步状态、临期摘要、方向和手势开关。没有令牌字段。

## 验证

`tests/terminal.test.ts` 使用独立 PostgreSQL 和真实 OAuth 流程；覆盖 PKCE 错误、cookie 不可用、scope/audience/client 错误、跨家庭读取、日期与十进制、三类写入、幂等与冲突、轮换重用、账号停用、auth_version 撤销。正式库存仅做只读验收。

2026-10-31：v0.12.0 已部署兼容的最近字段，正式家庭同事务只读投影已核对；手机端因当前没有默认网络仍待正常同步。显式 `ProductionReadAuditTest` 只刷新现有手机会话并核对快照与 AOD，不导出令牌、不提交库存命令；仅在 `readOnlyProductionAudit=true` 时运行。
