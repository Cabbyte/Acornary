# Android 同 App 环境切换设计（C5）

日期：2026-11-11。状态：**设计交付，未实施、未构建、未执行测试或真机验收**。本轮仅新增本文；现有正式包与 `cfPreview` 双安装包继续使用各自固定服务。本设计不改变 Android 运行时、签名、Manifest、CF 配置、生产数据或发布流程。

依据：[CF 集成准备方案](cf-integration-preparation-plan.md)第 7 节。后续实施必须先完成双包对照，并在恢复回归后通过本文验收；不把设计完成计为 Phase 2 工程验收或正式迁移。

## 1. 已读源码与确定的缺口

下表来自当前工作树静态阅读，不代表已验证运行行为。Android 路径前缀 `A/` 表示 `apps/android/app/src/main/java/top/protium/acornary/`。

| 现有位置 | 现有实现 | 同 App 前必须解决 |
| --- | --- | --- |
| `apps/android/app/build.gradle.kts`、`A/Models.kt` | 正式 `top.protium.acornary`、预览 `.cfpreview`；`ORIGIN/API/CALLBACK` 是构建常量；`SessionContext.scope` 为账号 ID + 家庭 ID | 显式环境配置与作用域；不能只替换 URL |
| `A/TerminalAuth.kt`、`A/TokenVault.kt` | 一个 `terminal-auth.bin` / `acornary.auth.v1`；同一记录存配置、AppAuth 状态、pendingState、refreshInFlight；固定 PendingIntent 10/11 | 令牌、登录尝试和刷新锁分别按归属隔离；旧回调不能清除当前会话 |
| `A/TerminalApi.kt` | bearer 绑定全局 API；401 后刷新并重发一次；HTTP 不跟随重定向、不自动连接重试 | 请求持有不可变环境/授权租约，重试也不能改环境或主体 |
| `A/TerminalRepository.kt` | 内存 generation；单一 `session` 缓存键；提交前保存原 JSON；未知结果查 operation；退出/失效/无凭据初始化 `dao.clear()` | 当前清库会删除未决请求与打印记录；切换须保留日志；所有响应和错误处理均校验租约 |
| `A/TerminalDao.java`、`TerminalDatabase.java` | Room v2；pending 主键仅 key；print batch 主键仅 id；家庭变化的 snapshot 事务可清整个库 | 完整作用域键与非破坏迁移；不同环境同 ID 不冲突；范围删除替代全库清理 |
| `A/TerminalPreferences.kt`、`DetailPane.kt` | 一个 DataStore `terminal`；draft 为 `itemId\|amount` | 草稿无账号/家庭归属，必须隔离且无法归属时封存；不能根据当前同 ID 自动认领 |
| `A/SyncScheduler.kt` | 唯一 work 名 `terminal-sync`；闹钟 30、通知打开 31；Worker/Service 执行时读取全局 repository | 老任务可能使用新会话；任务输入、闹钟身份和通知需绑定作用域/代次 |
| `A/TerminalApplication.kt` | 单例 repository；联网回调、前台定时刷新、session 非空监听触发调度 | 环境切换保持“已登录”时 boolean 监听不会重排；所有触发走同一 coordinator |
| `A/PrintJournal.kt`、`PrinterController.kt` | 批次按旧 scope；每页 SENDING/DONE，重启转 UNCERTAIN；全局 print_recovery.pending；scopeChanged 可能取消打印 job | 设备物理锁与任务归属分开；先停止并落盘，再切换；不确定页不能因换环境而解除 |
| `A/ItemLink.kt`、`LabelRenderer.kt`、`InventoryBrowse.kt` | 只接受构建 origin 的 `/i/<22 字符>`；二维码及 fingerprint 含该 origin | 解析结果保留来源环境；标签冻结源 URL；相同 UUID 不提供跨环境映射 |
| `AndroidManifest.xml`、`MainActivity.kt`、`CameraPane.kt` | Manifest 仅声明 OAuth callback 的 HTTPS App Link；扫码解析物品链接；MainActivity 处理授权动作 | 当前没有 `/i/` 系统 App Link 路由，不能称为已支持；未来单独增加路由及范围校验 |
| `A/AmbientProvider.kt`、`apps/android/aod/.../AcornaryDreamService.java` | provider 按 applicationId 隔离；AOD 硬编码正式 provider/包名；cfPreview 的 TerminalMaintenance 不控制正式 AOD | 同包切换后原 AOD 会读到新环境投影，须显式标识/暂停策略和兼容门槛 |

共享协议证据：[terminal.ts](../../packages/contracts/src/terminal.ts)、[CF handler](../../apps/cloudflare/src/terminal-handler.ts)、[CF terminal 投影](../../apps/cloudflare/src/inventory/terminal.ts)、[CF worker](../../apps/cloudflare/src/worker.ts)、[接口说明](../terminal-api.md)。CF handler 的认证失败可能为 HTTP 403 + `TERMINAL_AUTH_INVALID`，不能仅凭 401 认定失效。CF `/context.commands` 当前返回固定 terminalCommands 列表；客户端只能把它当候选能力，实际授权仍由后端判断，不能用环境名或该列表替代授权。

## 2. 不变量与固定服务配置

1. 任何事实、草稿、任务、回执和令牌都具有来源环境；环境 + 账号 + 家庭全部相等才是同一业务作用域。客户端 UUID、item UUID、幂等键相等不构成跨环境同一对象。
2. 只支持内置、审查过的两个 HTTPS origin，不提供任意 URL 输入。不可达、503、授权失败均不自动转向另一服务。
3. 业务请求体、revision、审批和幂等协议维持共享契约。现有 Android v1 仅开放三个命令，未来 Web 审批/草稿能力不据此自动下放 Android。
4. 切换是可恢复的本地事务协议；页面切换、旋转、进程重启和通知均不能绕过它。
5. 所有可产生副作用的发送先持久化；存储失败则不发送。取消网络请求并不证明服务端没有提交。

| 字段 | `legacy-production` | `cf-preview` |
| --- | --- | --- |
| 显示名称 | 正式库存 | CF 测试库存 |
| origin | `https://acornary.protium.top` | `https://cf.acornary.protium.top` |
| resource | origin + `/api/terminal/v1` | 同路径、独立 origin |
| redirect URI | origin + `/android/oauth/callback` | 同路径、独立 origin |
| authorize / token / revoke | origin + `/api/auth/oauth2/{authorize,token,revoke}` | 同路径、独立 origin |
| client ID | 从该环境 `/config` 取得并校验 | 从该环境 `/config` 取得并校验，禁止复制正式 ID 或会话 |

`EnvironmentSpec` 包含稳定 ID、上述端点、允许的配置版本/请求 scopes、标签 origin、可选 AOD 策略。`AuthConfig.validate(spec)` 必须检查 version=1、非空 client ID、resource/redirect/三个端点精确匹配；保留 PKCE S256。URL 不允许 userinfo、额外端口、HTTP、跨 origin 重定向或任意 metadata 指定的第三方端点。公开配置不是签名或账号身份的替代。

服务 ID 不随显示名、APK buildType 或部署 commit 变化。现有 v1 无可信 dataset ID：不能把 `/api/version` 的 commit 当数据集标识。为每个已知服务记录本地 `bindingRevision`（初始 1）；若 CF 重新导入快照或正式迁移，必须有显式部署/迁移清单推进此值并封存旧日志，重新登录。无法获知服务端重建是当前协议缺口；没有该运营约束或后续可信 dataset 标识时，禁止跨数据集恢复旧写入。本文不新增服务端字段或端点。

## 3. 接口边界与并发规则

以下为后续 Kotlin 结构约定，不是本轮代码，具体实现可使用 data class/sealed interface；业务 scope 使用结构化字段，持久化编码使用版本化 JSON 或长度前缀，禁止拼接未转义的冒号字符串。

```kotlin
data class ScopeKey(val environmentId: String, val accountId: String, val householdId: String)
data class SessionLease(
    val scope: ScopeKey, val bindingRevision: Long,
    val activationId: String, val credentialId: String
)
data class AuthAttempt(
    val id: String, val environmentId: String, val activationId: String,
    val config: AuthConfig, val state: String, val createdAt: Long,
    val status: String // PENDING, EXCHANGING, CANCELLED, CONSUMED
)
interface ScopedTerminalApi {
    suspend fun context(credentialId: String): SessionContext
    suspend fun get(lease: SessionLease, path: String): String
    suspend fun postOriginal(lease: SessionLease, operationId: String): String
}
interface EnvironmentCoordinator {
    suspend fun requestSwitch(targetEnvironmentId: String): SwitchDecision
    suspend fun confirmLeaveUnknown(switchId: String): SwitchDecision
    suspend fun cancelSwitch(switchId: String)
    suspend fun resumeInterruptedSwitch()
}
// SwitchDecision: Completed / NeedsLogin / NeedsUnknownAcknowledgement /
// WaitingForWrite / WaitingForPrint / StorageFailure / Cancelled.
```

`activationId` 是持久化随机代次，每次启用/重新登录/家庭更换/启动恢复均更新；不是进程内递增 Int。`credentialId` 指向具体授权，令牌绑定家庭，因此凭据槽按环境 + 账号 + 家庭保存，不能只按账号保存。同一环境一次只激活一个家庭；未激活槽不做后台刷新。

`EnvironmentCoordinator` 持有单一 transitionMutex，仲裁命令发送、打印开始、登录开始和作用域变更。`SessionRuntime` 持有不可变 spec/lease、独立 auth/API/repository 子协程作用域；不将共享 API 的 base URL 原地修改。读取进入时捕获租约，提交 Room、StateFlow、消息或错误处理前再次比较 activationId + scope + bindingRevision + credentialId。旧响应既不能更新新缓存，也不能清空新令牌或弹出误导消息。

锁顺序固定为 coordinator → 短 Room 事务；网络、用户确认、蓝牙等待不持有 Room 事务。认证刷新锁按 credentialId；刷新结束的状态发布走 coordinator，避免持锁等待自身。切换先关闭发送入口，随后等待已准入操作结束；检查 busy 后再关入口存在竞态，不允许这样实现。

## 4. 切换状态机

持久化 `activation_control` 为唯一活动来源：current environment/scope/credential、activationId、bindingRevision、switchId、from、target、phase。DataStore 不保存另一份权威活动指针。无账号时 scope/credential 为空，仍有环境与 activationId。

| 状态 | 允许行为及进入条件 | 下一状态 |
| --- | --- | --- |
| `ACTIVE` / `SIGNED_OUT` | 当前环境浏览或独立登录；请求切换后原子关闭新写入/打印/登录入口 | `CHECKPOINTING` |
| `CHECKPOINTING` | 保存原草稿和任务、写 PREPARED 切换记录；失败不切换、不发送 | `WAIT_WRITE` / `WAIT_PRINT` / `WAIT_AUTH` / `CONFIRM_UNKNOWN` / `QUIESCING` |
| `WAIT_WRITE` | 已进入发送阶段时阻止切换；保持原请求/环境，等待成功、确定拒绝或超时；禁用强制换 URL | 明确终态后继续；超时/断连进入 UNKNOWN 并可靠落盘后到 `CONFIRM_UNKNOWN` |
| `WAIT_PRINT` | 请求完成当前页后停止；等待 BLE 发送退出且 SENDING 已转 DONE 或 UNCERTAIN；不因为超时直接宣布停止 | 状态可靠落盘且设备发送锁释放后继续；否则停留并报告需核对 |
| `WAIT_AUTH` | 登录取消并作废原 attempt；若 code exchange/refresh 已发送，等待有界收尾，丢回执使原凭据需要重登，绝不重用可能已轮换 refresh token | 原流程静止后继续 |
| `CONFIRM_UNKNOWN` | 明示“正式/CF、家庭、待确认数量，返回原环境处理”；只有已持久化的 UNKNOWN 可经用户选择保留离开 | 确认后 `QUIESCING`；取消回原环境 |
| `QUIESCING` | 取消/等待旧读取，取消旧 work/alarm，关闭旧订阅；清空显示投影；旧写入和打印不得仍可发新字节 | `ACTIVATING` |
| `ACTIVATING` | Room 事务提交 target + 新 activationId + COMMITTED；组装新 runtime；新 scope 未核对前显示登录/连接中空状态 | `ACTIVE` / `SIGNED_OUT` / `OFFLINE` |
| `OFFLINE` | 留在用户所选环境；仅展示该已知作用域的缓存和离线标记；不执行写入/重试/打印数据核对 | 网络恢复后核对同环境 context，或再次走切换流程 |
| `RECOVERY_REQUIRED` | 切换记录/存储损坏或归属不明；停止调度和业务发送，显示可恢复原因 | 修复并明确重新登录后激活；不自动猜测归属 |

CHECKPOINTING 后存在多类阻塞时全部满足才推进，表中 WAIT 不是互斥捷径。用户取消只撤销切换意图，不撤销已提交命令、不自动继续打印、不恢复作废的 OAuth attempt。以新 activationId 重新激活原环境，按需重登录。

崩溃恢复顺序：系统解锁 → 本地迁移 → 读取 activation_control → 将遗留 SENDING 写入标为 UNKNOWN、打印 SENDING 标为 UNCERTAIN → 处理 switch journal → 组装 runtime → 注册调度。PREPARED 未 COMMITTED 时恢复原环境并取消未完成切换，不自动继续发送；COMMITTED 时恢复目标环境，不因目标离线自动回退。每次启动重新生成 activationId，使遗留回调/任务失效。旧工作取消是尽力而为，真正的隔离靠执行入口与落盘前租约检查。

## 5. 认证与 HTTP

- 新 TokenVault 文件/Keystore 别名为版本化、按 credentialId 派生的不可逆存储名；明文索引仅记录作用域及凭据 ID，不含 token、code、verifier。仍使用 noBackupFilesDir、AES-GCM、AtomicFile 和禁备份策略。加密记录内保存环境、client ID、resource、bindingRevision 与身份绑定，解密后再次匹配索引。
- 登录尚无 account/household 时，使用独立 attempt 槽保存 AppAuth request（包括 SDK PKCE 状态）及 environment/activation/state/完整回调；不能把登录 pending 写入已有已授权槽。PendingIntent 使用唯一 attempt 身份（显式组件 + data URI/request code），extras 不能单独作为 PendingIntent 唯一性依据。
- 回调先定位本地未过期、未取消的 attempt，再严格校验 state、SDK request/client、redirect、配置、PKCE；不能从当前选中环境推断归属。无匹配回调只拒绝该回调，绝不调用当前 repo.logout。重复回调不重复兑换；兑换前持久化 EXCHANGING，丢回执重新登录。
- 获取 token 后以同配置 `/context` 核对账号和家庭，成功才把临时凭据提升到对应 ScopeKey。token 与 scope 不匹配、服务返回不同家庭均不加载旧数据。登录发生主体变化时同样经过切换屏障；不可把 A 的待确认请求交给 B 查询或重试。
- 切换保留非活动环境的合法凭据但不后台续期；不复制浏览器 cookie 或令牌。浏览器 SSO 可能共享登录习惯，仍需每个 resource 独立授权且核对 context。退出只撤销捕获的旧 credential/config，撤销失败不恢复本地会话。
- 刷新保留现有“发送前 refreshInFlight；不确定则需要重登”的规则。旧刷新回包只允许写回旧凭据槽，不能更新新 runtime；若已取消/撤销则丢弃。同一凭据 Mutex 防止并发轮换。登出/失效隐藏该作用域展示并清凭据，保留未决/打印证据，后续同一主体重登才能查看或恢复。
- 保留不跟随重定向、不做网络自动重试；一次 401 刷新重发只在原租约仍有效且原请求已落盘时进行。403 `TERMINAL_AUTH_INVALID` 走原凭据失效，不无穷刷新；403 业务拒绝不等同于退出。URI 参数编码由固定端点构造器完成，不接受未校验路径穿越。

## 6. 数据库、草稿与迁移

选择单个 Room 库的显式复合作用域，避免跨文件切换事务。建议 v3 新表/列如下，原 v1→v2 路径保留；迁移无 destructive fallback。

| 存储 | 主键/必要字段 | 规则 |
| --- | --- | --- |
| `activation_control` / `switch_journal` | 单例活动记录 / switchId | 切换权威指针、阶段、原/目标、代次；不存 token |
| `session_bindings` | environment/account/household/bindingRevision | credentialId、最近核对时间；config 是环境及凭据的快照 |
| `scoped_cache` | scope + bindingRevision + kind + entityId | session、snapshot、detail；history/cursor 与查询绑定；替换仅限对应作用域 |
| `scoped_drafts` | scope + bindingRevision + draftId | itemId、输入、原 revision、命令、保存时间；提交持久化成功后才清对应草稿 |
| `operation_journal` | scope + bindingRevision + idempotencyKey | 原始 JSON/命令/itemId/expected revision、源 resource/client、创建/尝试时间、状态、回执/错误摘要；JSON 不重建 |
| `print_batches_v3` / `print_pages_v3` | scope + bindingRevision + batchId / 同上 + position | 冻结标签 URL/内容/fingerprint、纸张/密度、每页状态；所有更新带完整主键 |
| `migration_journal` / `legacy_quarantine` | migrationId / recordId | 源应用、步骤、水位、校验结果、无法确定归属的数据；不向业务读取开放 |

环境/account/household 为独立列并建索引；DAO 不暴露仅 `resolve(key)`、仅 `printPageStatus(batchId, position)` 或无条件 clear。清缓存不得清 operation/print journal。非活动数据不能被新账号 UI、AOD 或通知枚举；恢复须同主体认证。正式删除本地数据是另一项显式操作，不能由切换、授权失效或缓存淘汰触发。

迁移流程必须可重入：

1. 启动门阻止联网、同步、AOD 业务投影和打印。确定安装来源：当前正式 applicationId 原库归 `legacy-production`；现有 cfPreview 沙箱原库归 `cf-preview`（仅其未来版本升级自己时适用）。正式 APK 不能读取/自动合并另一个 APK 沙箱，不能假设包名改变会迁移数据。
2. Room 事务创建 v3 表、转换旧 scope 与缓存键、复制原数据、检查条数/内容摘要和关联关系、记录 DB_DONE。已知原应用与原记录 scope 才能赋归属；无合法 scope、session 与 snapshot 家庭冲突或遗失 session 的裸缓存保留隔离区，不自动重标为当前家庭。旧 pending 原 JSON、key、revision 全部保留，统一保守标为 UNKNOWN。
3. 旧打印 batch/page 按旧 scope 归源环境；SENDING→UNCERTAIN、RUNNING→STOPPED，DONE/CONFIRMED 保留原 fingerprint 与 URL 含义。全局 print_recovery.pending 没有任务归属时保留为设备级“旧任务待核对”，不能猜到 CF 或当前家庭。
4. 旧 TokenVault 只在配置严格匹配已知原环境、无 pendingState/refreshInFlight 且记录可解密时迁入原环境的待核对凭据槽；通过该环境 context 后绑定主体。此过程是同一服务本地格式升级，不是跨域迁移。pending/exchanging/refreshInFlight 旧授权失效重登，业务日志保持；写新槽并读回成功后才能删除旧槽，最后记录 VAULT_DONE。
5. 旧 DataStore 的主题、方向、纸张/密度可复制为设备偏好。`enabled/wave` 按源环境保存为终端偏好，目标 CF 默认不自动开启待机控制。旧 draft 只有 item ID，无可靠账号归属，即使当前 session 同 ID 也不能证明来源：封存为 legacy 草稿；用户在源环境核对后可手动复制输入为新草稿，重新读取 revision，绝不自动发送。记录 PREFS_DONE。
6. 检查各阶段完成，提交 MIGRATION_COMPLETE 并默认恢复已知原环境（正式升级不会默认 CF）。再启动 runtime 与调度。Room/文件/DataStore 无跨系统原子事务，依靠 journal 分步完成；任何中断均幂等续作，不提前删除唯一旧副本。
7. 迁移失败保持旧数据并停止业务发送，不降级启动旧版来使用半迁移库。回退 APK 不保证理解 v3；发布前提供隔离设备恢复方案，不用卸载正式应用或删除未决记录作为修复步骤。

新增状态仅修改本地日志，不改变后端写入 schema。`bindingRevision` 不发给现有 API 作为授权字段。

## 7. 未决写入恢复

本地状态：`PREPARED → SENDING → COMMITTED | REJECTED | UNKNOWN`。创建 PREPARED 和原请求入库同一事务；SENDING 在网络发送前提交。只有明确的原请求回执或完整可归属的确定业务拒绝可终结；超时、取消、进程中断、401/失效、未解析响应均保守 UNKNOWN。认证重新取得不能凭当前 item 状态猜原请求结果。

`GET /operations/:key` 的 `unknown` 不等于失败。恢复必须：回到原 environment/bindingRevision → 以原 account/household 重新认证 → 查原 key → committed 保存回执；unknown 保留状态，用户明确选择重试才发送原 command + 原 JSON + 原 key。不改变 opened_at、amount、revision，不生成新键，不转到另一环境查“相同 ID”。IDEMPOTENCY_CONFLICT 保留证据并阻止自动重试；revision 冲突保留原输入供核对，新操作必须由用户重新确认。

同一 scope 存在 UNKNOWN 时仍阻止该 scope 新写入，另一环境可在明确保留离开后独立使用。切回只恢复日志和查询入口，不自动重发写入。操作日志先更新持久终态再刷新 UI；回执落盘失败不能将 UNKNOWN 从界面移除。当前 v1 的三类命令无额外客户端审批步骤，未来如引入审批，审批必须额外绑定同 scope、原参数和 revision，不能跨环境继承。

## 8. 后台同步、AOD、打印和入口

### 同步与通知

- WorkManager unique work 与 tag 使用作用域存储哈希，inputData 包含 scope/bindingRevision/activationId；闹钟/Service intent 与通知打开 intent 携带相同租约，PendingIntent 身份也必须区分。登出/切换取消旧 unique work、旧闹钟、停止旧 service，并等待旧 runtime 读取任务退出。
- Worker/Receiver/Service 进入、网络前、写缓存前、重排前都验证租约；失配返回 success/no-op，不重试、不读“当前 repository”代替旧任务。仅活跃环境调度；网络变化、前台 60 秒轮询、重启和解锁都经 coordinator 取得新租约。
- 通知只显示来源环境/已授权家庭的必要信息，不含 token、URL 或库存明细；点击旧通知不得自动切换或提交操作，仅提示来源已不活动。SyncJournal 仍无账号/库存/令牌，可用环境 ID 和匿名 activation 诊断关联；不把令牌/完整授权 URL写日志。

### AOD

- 双包现状保持：cfPreview 不控制正式 AOD。未来同包模式默认 CF 不输出库存到旧 AOD；切换开始立即通知 provider，返回“正在切换/已暂停”空投影，关闭 wave，不残留上一家庭行。
- 新 AOD projection v2 增加 environment label、activationId、状态和是否允许展示；不提供 token、任意 scope 查询或任意数据库访问，保留 signature 权限。provider 读取一次一致的活动状态，不能拼接新环境标题与旧 snapshot。
- 同 App 在 CF 展示 AOD 需要新版 companion 明确支持并持续显示“CF 测试库存”；未确认 companion 能力时，CF 仅空态。正式环境可保留 v1 投影兼容。AOD 点击始终进入当前环境概览，不恢复旧 item/家庭；测试环境不得修改正式独立包的待机设置。

### 打印

- BLE 配对/连接偏好可作为设备级状态共享；批次、标签、已打印 fingerprint 和确认操作全部按 scope/bindingRevision 隔离。一个物理打印设备只有一个发送锁；切环境不重置这个锁或 print_recovery。
- 新 batch 冻结源环境 label origin、item ID、标签可见内容和 fingerprint；渲染 `LabelContent.item(item, sourceEnvironment)`，不读取当前全局 ORIGIN。历史 label-v2 fingerprint 原样保留，新算法明确版本，不将旧已打印记录冒充另一环境的去重证据。
- 切换调用 stopAfterPage，禁止继续下一页；当前页可能已经出纸时记录 UNCERTAIN，等待发送退出后才允许保留离开。无法可靠存 UNCERTAIN 则继续阻止切换并提示存储故障。
- UNCERTAIN 归属原批次；另一环境不能把它标为已打印/未打印。设备级阻塞保留，切回原环境核对纸张后才解锁；无归属旧标记通过明确设备核对流程解除，不能恢复或自动补打任何批次。
- 返回原环境不自动继续；重新选择待打页、联网核对原环境最新资料、用户点击开始。离线或新 scope 的同 UUID 不用于核对。测试标签同样使用物理锁和出纸不确定标记；重连只恢复连接，不重打。

### App Links、扫码与旧二维码

- 将 `ItemLink.parse` 返回值从 String 改为 `ResolvedItemLink(environmentId, itemId, sourceUrl)`；保持 HTTPS、准确 host、无 query/fragment/userinfo/额外端口、规范 compact UUID 的现有限制。允许两个内置源 origin，但识别来源不代表已授权。
- 当前环境的链接正常只读导航；另一环境链接展示“此标签属于正式/CF 库存”，只有用户选择切至来源环境并走完整屏障、认证和对象归属读取后才能打开。扫码/系统 Intent 从不直接执行命令。
- 正式旧域名二维码在 CF 里不能把 host 改成 CF、不能仅按 UUID 打开 CF 对象。当前不提供跨环境数据集映射；未来只有受审查的明确映射清单和用户选择才能开放，快照中 ID 相同不算映射。
- 当前 Manifest 没有物品 `/i/` App Link；后续若增加，MainActivity 需统一路由 `onCreate/onNewIntent`、延迟 ready 和重复 Intent，排除 OAuth callback 路径。OAuth 仍由 AppAuth 路径接收并通过 attempt 关联，不能当物品链接解析。
- 两个 origin 分别验证 assetlinks 的 package + 实际签名指纹、OAuth public client/PKCE/resource/redirect。当前 CF worker 在 preview 只声明 `.cfpreview`，所以未来正式 applicationId 同 App 接 CF 前需要独立服务端声明设计和发布验收；仅改 Android Manifest 不足以成立。双包共存时还须实测回调由哪个包接收，禁止通过增加宽泛 scheme/host 绕过。

## 9. 后续逐文件工作与实施顺序

以下全为未实施任务；文件前缀同第 1 节。公共协议、注册配置和签名改动需要单独发布工作包，本轮不执行。

| 顺序 | 文件 | 具体修改/交付 |
| --- | --- | --- |
| S1 | 新 `A/EnvironmentSpec.kt`、`ScopeKey.kt`、`EnvironmentCoordinator.kt` | 固定配置、结构化作用域、租约、切换状态机与单一活动控制表接口 |
| S2 | `A/Models.kt` | 移除业务层对全局 ORIGIN 的依赖；wire SessionContext 保持契约形状，由本地绑定包装 scope；AuthConfig.validate 接受 spec |
| S3 | `A/TerminalDatabase.java`、`TerminalDao.java`、`CacheEntry.java`、`PendingOperation.java`、`PrintBatchRecord.java`、`PrintPageRecord.java`；新迁移实体 | v3 复合主键、journal、非破坏迁移、范围查询/删除、终态回执；导出可核对 schema |
| S4 | `A/TokenVault.kt`、`TerminalAuth.kt` | 分槽加密、attempt 独立存储、PendingIntent 唯一性、严格旧回调隔离、原凭据刷新/撤销、迁移恢复 |
| S5 | `A/TerminalApi.kt`、`TerminalRepository.kt` | 不可变 endpoint/lease；去除失效即全库 clear；原请求 durable 状态；响应和错误提交屏障；同 scope 恢复 |
| S6 | `A/TerminalPreferences.kt`、`DetailPane.kt` | 全局设备偏好/按环境终端偏好/按 scope 草稿拆分；封存无法归属旧草稿；不提前清输入 |
| S7 | `A/TerminalApplication.kt`、`MainActivity.kt`、`TerminalScreen.kt`、`SettingsPane.kt` | 启动迁移门、runtime 生命周期、持续环境标识、切换说明/阻塞/保留离开 UI、统一回调及入口；不在页面建副本会话 |
| S8 | `A/SyncScheduler.kt`、`SyncJournal.kt` | scoped work/alarm/notification、旧租约 no-op、只调度活动环境；重启/解锁迁移门 |
| S9 | `A/PrintJournal.kt`、`PrinterController.kt`、`PrinterService.kt`、`BatchPrintPane.kt`、`PrinterPane.kt` | 持久归属和设备发送锁、停止屏障、无自动重打、按原 scope 核对 UNCERTAIN、测试标签也受锁 |
| S10 | `A/ItemLink.kt`、`LabelRenderer.kt`、`InventoryBrowse.kt`、`CameraPane.kt` | 来源解析、显式环境标签 URL、fingerprint 版本、旧链接路由；无静默域名改写 |
| S11 | `A/AmbientProvider.kt`、`SyncScheduler.kt` 中 TerminalMaintenance、`apps/android/aod/src/main/java/top/protium/acornary/aod/{AcornaryDreamService,TerminalSettingsProvider}.java` | v2 能力握手/投影、CF 默认暂停、清旧投影与 wave；同签名边界 |
| S12 | `apps/android/app/src/main/AndroidManifest.xml`、`app/build.gradle.kts` | 保留双包直到验收；未来显式同包变体、两 origin 的精确 callback 与可选物品链接；不修改签名私钥或自动安装 |
| S13 | `apps/cloudflare/src/worker.ts`、`terminal-handler.ts`、`scripts/cloudflare/provision-terminal.mjs` 及非 CF 对应注册流程 | 只在后续发布工作包核对单包双 origin 的 package/指纹/client/resource；不复制 token，不为 UI 放宽授权 |
| S14 | `apps/android/app/src/test/...`、`src/androidTest/...`、`apps/android/docs/acceptance.md` | 恢复回归后增补以下状态/迁移/双后端/硬件证据；分开自动、模拟器、实机结果 |

依赖：S1/S3 定义冻结 → S4/S5 → S6/S7 → S8–S11 → S12/S13 的发布资格核对 → S14 完整验收。业务隔离与原请求恢复未通过前，不开放同 App 开关。

## 10. 验收用例（全部未执行）

使用两个隔离后端与明确种子；不得向正式库存发送测试写入。两边故意使用相同账号/家庭/item UUID、不同名称/revision/数量，才能证明隔离；也覆盖同环境不同账号/家庭。原正式数据只做另行授权的只读核对。

| ID | 场景 | 必须观察的结果 | 后续证据层 |
| --- | --- | --- | --- |
| A01 | 双包同时安装/运行 | 原独立沙箱与 CF 不控制正式 AOD 的行为保持；未发布切换功能 | APK/模拟器/设备 |
| A02 | 相同三类 UUID，来回切换 | snapshot/detail/history/cursor/草稿/打印去重不串；标题持续标明环境 | 自动 + UI |
| A03 | 读取发出后切环境，旧成功/失败/401/403 晚到 | 不更新新缓存、不清新凭据、不改变新消息；原调用无重定向 | 并发注入 |
| A04 | 登录中切换、迟到/重复/伪造 callback | 原 attempt 作废；新会话不受影响；state/PKCE/resource/client 校验严格 | Auth + App Links |
| A05 | refresh 请求已送达后断网/杀进程/切换 | 原凭据重登，不重用旧 refresh token，不写入另一槽 | 真实隔离 OAuth |
| A06 | command 入库失败、SENDING 时切换 | 失败零网络提交；已发送阻止切换，不能强制改 URL | 存储故障/并发 |
| A07 | 服务提交后丢回执，确认保留离开再返回 | 原 UNKNOWN 保留；只原主体查 key；同键同 JSON 重试不重复扣减 | 双后端差分 |
| A08 | lookup unknown、IDEMPOTENCY_CONFLICT、revision 冲突 | unknown 不当失败；不改键/参数自动重发；冲突保留输入与证据 | 协议/状态 |
| A09 | 授权失效/退出/换账号家庭，存在未决 | 隐藏旧显示和凭据；旧日志未删除且新主体不能查询/认领 | 存储 + UI |
| A10 | PREPARED/COMMITTED 每一步杀进程或满盘 | 原/目标恢复符合 journal；无半迁移误发；无法落盘时保持阻止 | 崩溃恢复 |
| A11 | 正式 v1/v2 升级，含旧草稿、未决、打印记录 | 默认仍正式；未知草稿封存；所有日志可追溯；不会导入 CF 沙箱 | Room/文件迁移 |
| A12 | 旧 work/alarm/Service/通知在切换后触发 | no-op，不改用新会话；只新活动作用域重排；重启/解锁遵守 ready 门 | 调度/模拟器 |
| A13 | 两环境均已登录，enabled 一直 true | 仍取消原调度、建立目标调度；不依赖 signedIn boolean 变化 | 自动 |
| A14 | AOD 正在展示时切换/失效 | 旧家庭内容立即清空；旧 companion 不显示 CF 库存；新版明确 CF 标签 | 真机 AOD |
| A15 | 打印 SENDING 切换/断连/回执落盘失败 | 当前页核对为 DONE/UNCERTAIN；无自动重打；另一环境不能解除原页 | 实机 BLE/纸张 |
| A16 | 打印中杀进程，之后在另一环境启动 | 设备级不确定锁持续；原批次可核对；配对重连不打印 | 实机 |
| A17 | 旧正式二维码在 CF 扫描/系统打开 | 提示源环境并由用户选择；不靠 UUID 打开 CF，不提交命令 | QR/App Links |
| A18 | 两域名 callback、两包共存、不同签名 | 各自 DAL/回调匹配，错误包/指纹无法完成授权；物品路径与 OAuth 分开 | 发布配置 + 真机 |
| A19 | CF 不可达、503、配置端点恶意/不匹配 | 留在 CF，拒绝不可信配置，无正式故障转移 | 网络注入 |
| A20 | CF 快照重建/bindingRevision 更新 | 旧缓存/请求封存并重登；无映射时拒绝恢复旧写入；同 UUID 无例外 | 隔离运维演练 |
| A21 | 旧凭据槽损坏、迁移第 N 步中断 | 不清未决日志；可重入或明确 RECOVERY_REQUIRED；新旧 token 无跨域复制 | 存储故障 |
| A22 | 新环境无命令权限、终止物品、未知数量/日期 | 遵守真实契约错误/未知事实，不因环境名放开命令或构造数量 | 协议/UI |

C5 完成只说明设计与实现缺口已列明。当前未解决的发布资格包括：实际签名/App Links、双包 OAuth/命令对照、v3 迁移、可信数据集变更约束、同包 AOD 协议以及 BLE 纸张核对。本文未执行任何测试、构建、安装、部署或远端读写。
