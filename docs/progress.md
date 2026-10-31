# 项目进度

2026-10-31 小屏改版：Android `0.4.0-terminal` 的 Figma 品牌横屏界面、最近筛选与逐张批量打印已实现并同签名更新；兼容后端 [v0.12.0](https://github.com/Cabbyte/Acornary/releases/tag/v0.12.0) 已部署。完整 CI、Pixel 五项界面检查和 D101 三张停止／恢复测试通过；服务器只读核对当前 111 件、最近 7 天 2 件，未修改库存。手机 Wi-Fi 尚未连接，真实客户端同步与纸样前摄复核仍待完成，详见 [验收记录](../apps/android/docs/acceptance.md)。

2026-10-31 后续：Android `0.3.1-terminal` 默认保持 D101 连接并自动重连；已实测 AOD 下心跳持续、应用进程重启和 APK 更新后恢复连接。二维码含白边铺满纸张短边，前摄改用标准自动对焦镜头及 1920 × 1440 分析，加入点按对焦和变焦；用户确认新样张前摄可识别。最终 APK 已安装，60 秒待机设置已恢复，详见 [验收记录](../apps/android/docs/acceptance.md)。

2026-10-31：Android 主应用接入 D101 单张标签打印，支持双尺寸预览、浓度、联网核对和出纸结果待确认；正式签名 APK 已安装并核对摘要。本地 17 项主应用单元测试、4 项标签实机仪器测试、最终 CI 的 16 项模拟器仪器测试及完整仓库回归通过。Pixel 已通过 BLE 核验 D101 并收到单张完成确认，用户确认 30 × 12 mm 测试标签成功出纸、版式正常且二维码可识别，见 [打印说明](../apps/android/docs/printing.md) 和 [验收记录](../apps/android/docs/acceptance.md)。

2026-10-30：兼容后端 [v0.11.0](https://github.com/Cabbyte/Acornary/releases/tag/v0.11.0) 已发布，公网版本和既有 MCP 只读链路已核对。Android 终端 public client 已注册，公开签名及 App Link 声明已发布并通过 Google 声明查询，匿名授权校验通过；最终正式签名 APK 已安装到 Pixel 3 并核对摘要。手机当前锁屏且未联网，Chrome 更新、本机 App Link 验证、正式登录、完整日常闭环和 24 小时稳定性仍待验收，见 [终端验收记录](../apps/android/docs/acceptance.md)。

2026-10-05 维护：响应式工作台和 MCP Apps 共用界面已合入 `main`，自 `v0.4.2` 起正式发布。用户已反馈初步验收通过；未提供逐项设备和宿主记录，因此不扩大为全部平台验收。

后续版本以 [GitHub Releases](https://github.com/Cabbyte/Acornary/releases) 和线上 `/health` 为准。普通分支和 main push 只运行 CI，正式标签才触发生产更新，流程见 [发布手册](./releases.md)。

## 当前能力

| 范围 | 状态与依据 |
| --- | --- |
| 领域与持久化 | CatalogNode、Item、版本化属性模板、Event、文字 Note；家庭内 revision、幂等与事务校验见 [领域模型](./domain-model.md) |
| 唯一正式库存 | 云端 PostgreSQL；原本地库存保持停写，独立开发库不充当第二份正式库存，见 [云端运行](./cloud-runtime.md) |
| 账号与家庭 | 邮箱、Passkey、可选密码、多家庭成员关系及独立 OAuth 授权；公开注册和邮箱找回默认关闭，见 [账号系统](./accounts.md) |
| Web 产品 | 桌面与手机共用工作台，搜索、筛选、排序、UUID 多选、原子批量移动和物品／备注编辑；保留消耗、纠错、笔记、历史和只读检查器，见 [Web UI](./webui.md)、[工作台](./responsive-workbench.md) |
| MCP Apps | Web 和插件复用 Workspace；宿主桥、身份作用域、选中项上下文、私有草稿及精确重试见 [插件实现](./plugin.md) |
| Android 终端 | Kotlin / Compose / Material 3、前摄扫码、库存操作、Room 缓存、PKCE、独立 AOD 与 D101 单件打印；已显示正式账号库存，完整实机验收仍未完成 |
| 交付 | Node 24 / PostgreSQL 18 的 CI、公开 GHCR 镜像、受限 SSH 和独立发布任务已运行；[v0.4.2 Release](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2) 记录镜像、任务和公网验证 |

## 本轮维护

清理已由工作台替代且没有调用者的旧位置浏览组件、旧导航样式与 SVG；保留仍被商品目录、详情、登录和表单使用的共享组件与样式。2026-10-01 的 Soft Gray／插件本地交接移入 [历史归档](./archive/README.md)，当前文档统一描述已合入主线的实现。

已执行的 `001`–`005` migration、旧 fingerprint／幂等重放、所有者兼容映射及备份恢复工具仍有运行或验证用途，不作为死代码删除。清理没有新增 migration，也不写入生产库存。

## 验证边界与后续

- `v0.4.2` 发布记录包含 66 项单元／集成测试、36 项 Chromium 测试、15 项部署控制器测试和真实容器迁移／恢复结果。本轮检查结果随对应 PR、CI 和 Release 留档，不把旧数量视为新提交已通过。
- 用户初步验收通过；真实 iPhone Safari、主屏幕离线重开、输入法和 VoiceOver 的逐项证据仍需分别记录。模拟插件沙箱覆盖不等于所有真实宿主均已验证。
- 库存仍采用完整家庭快照与客户端分页；超大库存、深树、服务端分页和增量快照没有负载验收。
- 真实 SMTP 配置和收信验收完成前，不开放注册与邮箱找回。
- 图片附件、OCR、模板升级、自动选取／FEFO、主动提醒和离线写入同步未实现。日常定时备份仍默认关闭，异机灾难恢复未验收。

早期阶段事实保留在 [Stage1](./stage1-verification.md)、[Stage2](./stage2-verification.md) 和各版本发布记录中，不再作为当前待办重复列出。
