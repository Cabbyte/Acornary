# 无打印终端验收记录

本记录区分实现、测试和正式环境验收。尚未满足日常使用闭环的全部交付标准，不能视为正式上线完成。

## 已有证据（2026-10-30）

- 已接入主分支 `c3f0b1e` 的后续库存与目录确认更新。服务端类型检查、构建通过；独立 Node 24 + PostgreSQL 数据库中，18 个测试文件、135 项测试通过。终端专项 11 组，真实 OAuth PKCE、跨家庭隔离、scope/audience/client、提醒、精确小数、三类命令、版本冲突、幂等重放、刷新轮换重用、账号停用与 auth_version 撤销已覆盖。36 张表的备份恢复比对一致。
- Android 原生四入口、登录/缓存/库存/操作/扫码/设置与投影已接线。无打印入口和 BLE 权限。
- Android 单元测试包含标签、保留的 D101 协议、精确数量、临期投影、挥手去抖/遮挡/冷却。
- Pixel 3 上 5 项仪器测试通过：缓存与待确认请求重开恢复、作用域清理、Keystore 加密/损坏恢复、反向横屏与 1.5 倍字体、已结束物品和容器不出现操作按钮。仅使用测试 fixture，没有消耗真实库存。
- Android 12 隔离模拟器的 11 项仪器测试全部通过，含 5 项 AppAuth/Keystore 场景：并发刷新只轮换一次、刷新响应丢失、进程重启时刷新状态未决、取消刷新、回调 state 不符，以及后台服务拒绝后的持久降级和陈旧时间判断。测试使用合成令牌；不能替代用户实际 Custom Tabs 登录验收。最终 Android 代码 `0c08fb1` 的[构建/lint/单元/仪器测试](https://github.com/Cabbyte/Acornary/actions/runs/40930839424/job/123648518059) 已通过。
- 实现提交 `8e09362` 的[完整 CI](https://github.com/Cabbyte/Acornary/actions/runs/40926032503) 已通过：Android 验证，服务端 135 项测试，Chromium 52 项、WebKit 18 项，15 项发布控制器测试和真实容器迁移/应用恢复检查。后续代码修复仅涉及 Android 后台同步降级。
- 兼容后端 [v0.11.0](https://github.com/Cabbyte/Acornary/releases/tag/v0.11.0) 的[正式发布流水线](https://github.com/Cabbyte/Acornary/actions/runs/40928830607) 全部通过。2026-10-30 公网 `/health` 确认版本与提交 `4a818ea`；既有 MCP 授权和只读库存查询正常。
- 2026-10-30 通过用户另一台已授权 Mac 提供的服务器 Host Key 验证 SSH 身份，完成专用 Android public client 注册和公开证书指纹配置。操作使用现有发布锁，保留私有配置备份，只重建 app 容器；没有修改正式库存。`/config` 返回 200，`assetlinks.json` 包名和正式签名正确，Google Digital Asset Links 查询也返回匹配声明。匿名终端、Web 和 MCP 私有接口仍返回 401。
- 正式环境匿名授权探测通过：正常 PKCE S256 请求跳转登录页；错误回调地址返回 `invalid_redirect`；缺少 PKCE 返回 `invalid_request`。后两项只跳转服务自身错误页或已注册回调，没有授权码。此检查未登录账号，不能替代手机 Custom Tabs 登录验收。
- 新主界面已在 Pixel 3 横屏实际显示。无操作自然进入 AOD，系统 `stay_on_while_plugged_in=0`、`screen_off_timeout=60000`。
- 正式签名三个 APK 已构建；私钥在本机工程外，密码在 macOS 钥匙串。使用 APK v3 proof of rotation 将主应用和伴随应用从调试证书迁移；静态 overlay 随 Magisk 模块重启后升级为同一正式证书。
- Pixel 3 重新连接后，最终 Android 代码 `0c08fb1` 的主应用和 AOD 迁移 APK 已更新。设备已安装文件的 SHA256 与发布清单逐项一致；Magisk 模块中的 AOD 同步更新、overlay 已一致，保留首次设置基线和 `validated` 标记，本次无需更改覆盖层或重启。
- AOD 热更新后服务曾断连；只唤醒锁屏并等待自然超时，最终版本已重新进入 Acornary DreamService，`mCurrentDreamIsDozing=true`、`DOZE`、亮度 10。没有解锁、重启或修改待机设置。当前崩溃缓冲为空；这只证明本次服务恢复，不代表登录后的真实库存展示或全天稳定性。
- 重启后再次验证实际 Acornary DreamService、`mCurrentDreamIsDozing=true`、`DOZE`、亮度 10，恢复看门狗验证标记已写入。重启首次解锁前不读取库存。
- 2026-10-29 的实机前摄释放、物理双击、官方 AOD 恢复往返证据继续保留在 implementation.md。

本机证据位于 Git 忽略目录 `output/android/`：`ci-current-main.log`、`terminal-tests.log`、`instrumentation.log`、`android-final-checks.log`、`auth-verification-build.log`、`github-android-scheduler.log`、`github-scheduler-verification/`、`github-server-verified.log`、`production-release-checks.json`、`terminal-provision-result.json`、`terminal-enabled-checks.json`、`production-authorization-checks.json`、`google-assetlinks-check.json`、`release-manifest.json`、`release-build.log`、`release-install.log`、`final-main-install.log`、`final-device-install-checks.json`、`final-aod-after-update.txt`、`aod-verified.txt`、`native-main.png`、`native-aod.png`。6 个正式/迁移 APK 均通过 API 31 签名验证，文件摘要在 release-manifest 中。后续构建可能覆盖同名日志，以最新成功/失败结果为准。

## 未完成的正式验收

| 验收 | 当前状态 / 必要条件 |
| --- | --- |
| 手机 Chrome 更新 / Custom Tabs / App Link | Chrome 仍为 91；手机未连接网络，域名验证状态为 1024，服务端及 Google 声明核对通过不等于本机验证成功；需用户方便时解锁并联网 |
| 手机正式账号登录、真实库存与电脑核对 | 未进行；由用户本人在浏览器登录，不复制现有 cookie 或 MCP 凭证 |
| 当前完整版本真实二维码识别、权限拒绝、相机占用恢复 | CameraX 先前硬件验证通过，完整账号流程尚需实机验证 |
| 写入成功 → 真实投影 → AOD 更新 | 服务端隔离写入测试通过；不得用正式物品自动消耗测试 |
| 插电五分钟同步、断网/拔电/省电降级、刷新响应丢失 | 调度与恢复已实现，需授权登录后实际连续测量 |
| 挥手开关、物理持续遮挡 | 状态机测试通过，物理手势仍待验证；默认关闭 |
| 24 小时稳定性与温度/唤醒锁 | 尚未开始，不以短时 AOD 或构建通过替代 |

手机现已恢复 USB/ADB，用户存储为 `RUNNING_UNLOCKED`，但当前屏幕仍锁定且无默认网络；这两种“解锁”状态不能混为一谈。用户暂时无法操作手机，已暂缓浏览器及交互验收。没有绕过 PIN、强制把 App Link 标记为成功或迁入其他客户端凭据。原始设置基线仍保留在 `output/android/pixel3-baseline/settings.json`，伴随应用设备保护存储也保留已捕获基线。

## 恢复实机验收的顺序

1. 用户方便时解锁并连接可访问正式站点的网络，在 Google Play 更新 Chrome。通过 Android 正常域名验证确认 `acornary.protium.top` 为 `verified`。
2. 用户在松仓终端发起 Custom Tabs 登录，选择家庭并授权；核对临期、库存及家庭时区与电脑一致。保持正式库存只读。
3. 在隔离测试家庭验证真实标签、三类写入、版本冲突及不确定结果恢复；退出测试家庭后重新授权正式家庭，核对缓存及 AOD 隔离。
4. 检查两个横屏方向、键盘、相机释放、60 秒待机、物理双击和挥手遮挡；记录实际五分钟同步及断网、拔电后的降级。
5. 基础验收通过后开始下述 24 小时取证。当前尚未启动全天运行验收。

## 连续运行取证

登录并完成基础验收后，使用 `tools/soak.py --hours 24` 从这台 Mac 每 5 分钟读取设备状态。记录开始/结束时间、连接中断、同步日志、崩溃、唤醒锁、温度及相机客户端。该脚本不读取账号令牌或修改库存。中断后保留原始 JSONL，不能把不足 24 小时的片段标记为全天通过。
