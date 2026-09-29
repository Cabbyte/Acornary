# v0.2.0 账号系统发布验收

2026-09-29（北京时间）。邮箱验证、Passkey、可选密码和多家庭成员关系已通过 GitHub 标签流程部署；公开注册与邮箱找回保持关闭。

## 版本与迁移

- [PR #3](https://github.com/TANG617/Acornary/pull/3) 合入 main，正式提交 `d42d6bf774df1a15841ad5606ec6b0c63a5731b5`，附注标签 `v0.2.0`。
- [分支 CI](https://github.com/TANG617/Acornary/actions/runs/36552740181)、[PR CI](https://github.com/TANG617/Acornary/actions/runs/36552742777)、[main CI](https://github.com/TANG617/Acornary/actions/runs/36553400855) 均通过。
- [Release](https://github.com/TANG617/Acornary/actions/runs/36553482191) 的 identity、test、publish、deploy 全部成功。
- 镜像为 `ghcr.io/tang617/acornary@sha256:5c2f521e52a394f6d89c869bc65a7d1f2c757531ca48673ba18052383b850fcd`。
- 服务器任务 `8df57d41a81a8a8f64a2950b` 为 `succeeded`，新增 `005_accounts.sql` 已提交。服务器发布记录与公网 `/health` 的版本及完整 commit 一致。
- 发布控制器先生成 `/var/lib/acornary/backups/releases/8df57d41a81a8a8f64a2950b/database.dump`，随后执行迁移与受限运行角色授权。恢复边界见 [账号系统](./accounts.md)，不能用旧库覆盖新写入。

## 自动化与公网证据

- Node 24 类型检查和生产构建、45 项 Vitest、17 项云模式 Chromium 浏览器测试、15 项发布控制器测试通过。
- 实际 PostgreSQL 验证邮箱验证的用途、过期、重放、限流和发送失败；禁用能力无法被后端绕过；迁移保留原用户、家庭、actor、密码、库存、历史及 OAuth 引用。
- 虚拟认证器完成真实签名的注册、登录与恢复；浏览器覆盖取消后重试、跳过密码、密码回退、添加／移除密码、最后凭据保护、单次邀请、家庭切换及在另一标签页退出家庭后的检查器查询刷新。
- OAuth 选择家庭后固定授权范围，刷新与版本检查保持绑定；凭据恢复／替换使旧会话和旧令牌失效。既有允许／拒绝、PKCE、失效恢复、外部返回地址拒绝、离线缓存、编辑草稿和跨标签页退出均回归通过。
- 受限 `acornary_app` 角色的真实容器验证覆盖家庭创建、Passkey challenge、会话保留、镜像升级、迁移前备份及独立恢复、SQL 失败回滚、启动失败恢复和迁移提交后禁止不安全回退。
- 公网能力查询确认 `registration=false`、`recovery=false`、`passkey=true`。新页面均可达；匿名业务、检查器、凭据查询及 MCP 请求均为 401。issuer 仍为 `https://acornary.protium.top/api/auth`，MCP 地址不变。
- 发布前的真实所有者浏览器会话在刷新后仍有效，原库存和只读检查器正常显示；账号与安全页面显示原密码仍已设置，并在会话不够新时要求重新验证后才能添加 Passkey。
- 两个既有 MCP 连接（直接 MCP 和 Acornary App 连接）均完成正式库存只读查询，UUID、版本、数量和内容汇总与发布前一致；没有要求重配客户端，也未声称重走了 ChatGPT 对话界面的人工授权流程。
- 正式十一张业务及支撑表的逐行内容摘要与发布前完全一致：17 个 Item、13 个 CatalogNode、2 条 Note、37 条 Event、33 条幂等操作；生产没有执行库存写入验收。
- PostgreSQL、共享 Caddy、Runbuoy API／worker 的启动时间不变，Runbuoy 健康正常。保留同一 HTTPS 443 入口和应用内部 3210；本机 `http://127.0.0.1:33211/items` 调试预览仍健康，未重建或重新播种演示库。

## 待完成的外部验收

真实 SMTP 尚未配置和验收，公开注册与邮箱找回按约定关闭。配置流程见 [账号系统](./accounts.md)。

iPhone Safari／主屏幕 Web App 的系统 Passkey 创建、取消和登录已向用户提出实机验收请求，记录时尚未收到结果。虚拟认证器不证明实际 Face ID／Touch ID、iCloud 同步或系统弹窗行为。本轮不增加原生 iOS App、第三方登录或离线写入。
