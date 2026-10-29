# 无打印终端验收记录

本记录区分实现、测试和正式环境验收。尚未满足日常使用闭环的全部交付标准，不能视为正式上线完成。

## 已有证据（2026-10-30）

- 已接入主分支 `c3f0b1e` 的后续库存与目录确认更新。服务端类型检查、构建通过；独立 Node 24 + PostgreSQL 数据库中，18 个测试文件、135 项测试通过。终端专项 11 组，真实 OAuth PKCE、跨家庭隔离、scope/audience/client、提醒、精确小数、三类命令、版本冲突、幂等重放、刷新轮换重用、账号停用与 auth_version 撤销已覆盖。36 张表的备份恢复比对一致。
- Android 原生四入口、登录/缓存/库存/操作/扫码/设置与投影已接线。无打印入口和 BLE 权限。
- Android 单元测试包含标签、保留的 D101 协议、精确数量、临期投影、挥手去抖/遮挡/冷却。
- Pixel 3 上 5 项仪器测试通过：缓存与待确认请求重开恢复、作用域清理、Keystore 加密/损坏恢复、反向横屏与 1.5 倍字体、已结束物品和容器不出现操作按钮。仅使用测试 fixture，没有消耗真实库存。
- 新增 5 项 AppAuth/Keystore 仪器测试：并发刷新只轮换一次、刷新响应丢失、进程重启时刷新状态未决、取消刷新、回调 state 不符。已通过编译和 lint，尚待隔离模拟器执行；不能算作实机通过。
- 新主界面已在 Pixel 3 横屏实际显示。无操作自然进入 AOD，系统 `stay_on_while_plugged_in=0`、`screen_off_timeout=60000`。
- 正式签名三个 APK 已构建；私钥在本机工程外，密码在 macOS 钥匙串。使用 APK v3 proof of rotation 将主应用和伴随应用从调试证书迁移；静态 overlay 随 Magisk 模块重启后升级为同一正式证书。
- 重启后再次验证实际 Acornary DreamService、`mCurrentDreamIsDozing=true`、`DOZE`、亮度 10，恢复看门狗验证标记已写入。重启首次解锁前不读取库存。
- 2026-10-29 的实机前摄释放、物理双击、官方 AOD 恢复往返证据继续保留在 implementation.md。

本机证据位于 Git 忽略目录 `output/android/`：`ci-current-main.log`、`terminal-tests.log`、`instrumentation.log`、`android-final-checks.log`、`auth-verification-build.log`、`release-build.log`、`release-install.log`、`aod-verified.txt`、`native-main.png`、`native-aod.png`。仪器测试报告位于 `apps/android/app/build/reports/androidTests/connected/debug/`。后续构建可能覆盖同名日志，以最新成功/失败结果为准。

## 未完成的正式验收

| 验收 | 当前状态 / 必要条件 |
| --- | --- |
| 后端正式发布、注册客户端、发布 assetlinks | 本机实现和隔离测试完成，尚未部署；等待已验证的服务器 SSH 运维连接信息 |
| 手机 Chrome 更新 / Custom Tabs / App Link | Chrome 仍为 91；手机需要本人解锁后继续 |
| 手机正式账号登录、真实库存与电脑核对 | 未进行；由用户本人在浏览器登录，不复制现有 cookie 或 MCP 凭证 |
| 最新源码 APK 安装 | 正式签名版本已迁移安装，后续小修仍需手机重新连接后更新 |
| 当前完整版本真实二维码识别、权限拒绝、相机占用恢复 | CameraX 先前硬件验证通过，完整账号流程尚需实机验证 |
| 写入成功 → 真实投影 → AOD 更新 | 服务端隔离写入测试通过；不得用正式物品自动消耗测试 |
| 插电五分钟同步、断网/拔电/省电降级、刷新响应丢失 | 调度与恢复已实现，需授权登录后实际连续测量 |
| 挥手开关、物理持续遮挡 | 状态机测试通过，物理手势仍待验证；默认关闭 |
| 24 小时稳定性与温度/唤醒锁 | 尚未开始，不以短时 AOD 或构建通过替代 |
| 远端 Android CI / Web 浏览器回归 | CI job 已加入，尚待提交运行 |

手机最后一次重启后 Mac USB/ADB 连接消失，已请求重新连接并首次解锁。此时原始设置基线仍保留在 `output/android/pixel3-baseline/settings.json`，伴随应用设备保护存储也保留已捕获基线。

## 连续运行取证

登录并完成基础验收后，使用 `tools/soak.py --hours 24` 从这台 Mac 每 5 分钟读取设备状态。记录开始/结束时间、连接中断、同步日志、崩溃、唤醒锁、温度及相机客户端。该脚本不读取账号令牌或修改库存。中断后保留原始 JSONL，不能把不足 24 小时的片段标记为全天通过。
