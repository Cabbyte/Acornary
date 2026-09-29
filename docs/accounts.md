# 邮箱、Passkey 与家庭账号

账号身份与家庭成员关系独立。一个账号可以加入多个家庭；每次业务请求携带 `X-Acornary-Household`，服务端重新检查成员关系并选择该家庭内的 actor。用户输入不能指定 actor。检查器保持只读，认证表不在白名单中。

## 默认关闭的邮件能力

未配置时无需更改现有私有环境文件：邮件、公开注册和找回默认关闭，已有账号可以用原密码登录、添加通行密钥。注册 UI 会明确显示不可用。邮箱 OTP 仅用于验证与恢复，不作为独立登录入口。

在服务器私有 `app.env` 配置以下字段后，先验收投递再打开开关，不提交真实值到 Git：

```dotenv
ACORNARY_MAIL_TRANSPORT=smtp
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=松仓 <accounts@example.com>
ACORNARY_REGISTRATION_ENABLED=false
ACORNARY_RECOVERY_ENABLED=false
```

SMTP 支持 465/TLS 和 587/STARTTLS，要求 TLS。两个开关独立启用。禁用邮件却开启开关会导致启动配置校验失败。`test` 发件箱仅供 `NODE_ENV=test`、隔离测试库使用；生产无测试邮件读取端点，不记录验证码、密码、凭据或邀请原文。

注册：邮箱验证码 → Passkey 或密码 → Passkey 用户可选添加密码 → 创建或加入家庭。验证码 10 分钟有效、最多 5 次尝试；验证后的注册／恢复凭证 15 分钟有效，Passkey challenge 5 分钟有效。邮件按邮箱与可信入口 IP 限流，发送失败不返回成功。未完成凭据设置不会创建账号。

恢复验证只授予更换凭据的权限，不先创建完整登录会话；提交新密码或 Passkey 后原凭据、会话、OAuth 授权失效。凭据修改要求 5 分钟内的登录证明；保留至少一种登录凭据。更改密码撤销其他会话和客户端授权。新增 Passkey 不延长重新验证窗口。

## API 与授权

- `/api/session`：账号、成员关系、当前家庭、缓存命名空间；已登录但无家庭是有效的引导状态。业务接口缺少家庭标识或越权时拒绝访问。
- `/api/auth/account/capabilities`：注册、恢复、Passkey 可用状态。
- `/api/auth/account/email/start`、`email/verify`、`complete-password`：目的绑定的邮箱验证及凭据完成；验证码和 ceremony 通过 HttpOnly、Secure、SameSite Cookie 绑定浏览器。
- `/api/auth/account/passkey/options`、`passkey/complete`、`passkey/update`、`credentials`、`password`：凭据注册和管理；Passkey 的签名验证使用 SimpleWebAuthn，日常登录使用 Better Auth Passkey 插件。所有认证器都必须验证用户，服务端验证固定 origin/RP ID。
- `/api/auth/account/households`、`household`、`invitation`：家庭及邀请流程。邀请原文仅创建时返回，数据库保存摘要，7 天、单次兑换、可撤销。所有成员同权，最后一人不能退出。

OAuth 的 issuer、resource、scopes 和协议地址保持不变。家庭选择按授权请求的 session/client/state/PKCE 等上下文保存，服务端仍由原 OAuth provider 校验签名、回调和授权请求。授权 reference 固定到成员记录及账号凭据版本；Web 切换家庭不修改它。成员退出再加入也不会使旧授权复活。令牌使用及刷新都重新检查成员关系／版本。

本机缓存、草稿以 user + household 分区。不同用户重新认证时清除旧数据；同用户同家庭会话失效保留草稿。主动退出清除私有缓存并通知其他标签页；已知退出某家庭后清除其缓存。设备完全离线时无法接收远端撤销信号，联网后重新核对。

## 迁移、验证与发布

`005_accounts.sql` 为新增迁移，保留原用户、家庭、actor、密码、库存和历史 ID，回填原所有者成员记录及现有 OAuth refresh/access/consent 的 reference。旧所有者 JWT 仅在原成员关系仍有效、凭据版本仍为 0 时兼容；新凭据不走这个兼容路径。

沿用现有 CI → main → 未占用版本标签 → GHCR digest → 单应用部署。迁移前由发布控制器备份；不修改共享 Caddy、端口或原演示库。首次发布保持邮件功能关闭。开放多用户后不得回滚到仅支持单所有者的旧认证实现；失败恢复应使用兼容当前成员关系的镜像，不能通过还原旧数据库覆盖新写入。

自动验收：真实 PostgreSQL 的迁移保全、邮箱与权限集成测试、OAuth/PKCE/refresh/MCP、Chromium 虚拟认证器、手机宽度页面、邀请返回、缓存及草稿回归。测试服务器独有的 `/__test/mail` 只读取隔离内存发件箱，生产应用没有这个路由。

实机验收需另在 iPhone Safari 与添加到主屏幕的 Web App 中完成创建、取消、登录、退出和重新验证；虚拟认证器不证明 iCloud 同步或系统弹窗的实机行为。正式邮箱投递与这些实机结果应单独记录，不以 CI 成功替代。
