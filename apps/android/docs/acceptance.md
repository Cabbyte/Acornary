# Android 终端验收记录

本记录区分实现、测试和正式环境验收。尚未满足日常使用闭环的全部交付标准，不能视为正式上线完成。

## 小屏横屏与最近批量打印（2026-10-31，0.4.0）

实现固定品牌主题、Figma D 桌面图标、56dp 侧栏、最近默认筛选、双栏详情、单层消耗面板、紧凑扫码和分组设置。最近使用家庭自然日，服务端按有效标签变化的记录时间投影。Room v1→v2 非破坏迁移增加批次和逐张收据；批量联网核对、逐张 ACK、停止后续、后台中断和显式恢复均已接线。AOD 临期规则不随主页面筛选变化。

- 本地 Android 编译、lint、JVM 测试通过；独立 Node 24 / PostgreSQL 18 中 19 个文件、142 项测试通过，包括真实 OAuth 接口返回最近字段、SKU 传播、自定义名称、日期清除和无关操作排除；36 张表的备份恢复比对一致。
- [首轮 Android CI](https://github.com/Cabbyte/Acornary/actions/runs/41177014305) 的 35 项隔离模拟器仪器测试全部通过：Room 迁移、批次预选、逐张持久化、停止、断线／进程恢复、前后台与作用域隔离，以及 600×360dp、大字体、反向横屏、深色和搜索键盘。首轮截图发现测试夹具固定宽度造成裁切及旋转帧未就绪，已修正取证，并压缩预览高度；最终视觉、实体三张测试、后端和 APK 部署结果仍待填写。
- 本地完整 Node 24 容器回归通过：142 项 Vitest、Chromium 52 项、WebKit 18 项，真实备份恢复比对一致。新增硬件验收夹具仅在显式 `hardwareD101=true` 时运行，使用独立本机测试数据及数据库，正式库存无读写请求。
- 本轮证据目录为 `output/android/design/`；旧界面已取证为 `before-items.png`。资产来源、版本和摘要见 [设计资产](../design/README.md)。正式库存保持只读。

后续核对：

- `bc2544a` 的[完整 CI](https://github.com/Cabbyte/Acornary/actions/runs/41178600025) 全部通过：37 项隔离模拟器仪器测试成功，2 项真实硬件夹具按设计跳过；主应用 21 项 JVM 测试、构建、lint，以及完整服务端／Web／真实容器恢复均通过。
- Pixel 3 已安装同一正式证书签名的临时测试宿主，保留账号和缓存；未运行 Gradle 的安装卸载测试任务。14:56:58–14:57:16（Asia/Shanghai）D101 三张“打印测试 1／2／3”逐张取得完成确认。测试先勾选／取消、打印一张后停止，重建本机批次后只继续未完成的两张。独立测试库共 3 个 `DONE` 收据，正式库存 API 请求为 0。证据为 `physical-batch-test.log`、`physical-evidence/receipts.json` 和进度截图。用户随后确认三张纸样的文字、方向和边距均正常，并已将标签放到前摄前；本轮前摄识别结果尚未取得成功证据。首轮相机测试因等待 120 秒超时，不记为通过。
- 15:13 在 Pixel 3 上执行最终五项 `WorkspaceDesignTest`，全部通过：600×360dp／1.5 倍字体／反向横屏、1.3 倍字体键盘、深色、搜索、批次预览。保留原用户输入草稿。Gboard 完全展开后，消耗面板横排输入和两个提交按钮，实际可见触控高度至少 48dp；没有提交任何消耗命令。最终截图在 `physical-ui-final/`，测试日志为 `physical-ui-tests.log`。
- 关闭测试取景后 `Active Camera Clients` 为空，崩溃缓冲为空；临时修改的屏幕超时已恢复 60000 ms。最终正式包与服务器核对结果见下。

最终部署与当前边界：

- [v0.12.0 正式流水线](https://github.com/Cabbyte/Acornary/actions/runs/41180114382) 全部通过，包括最终消耗布局的 37 项模拟器仪器测试（2 项硬件夹具按设计跳过）、完整服务端／浏览器回归、镜像与受限部署。公网 `/health` 已核对 `v0.12.0` / `ce6979921a23ff8c9f4c905300eea7f94130fddc`，终端公开配置正常，匿名 Web／MCP／终端私有接口仍为 401。
- 使用既有 MCP 读取及服务器内同一只读投影核对正式家庭：111 件当前库存，全部包含有效创建／标签更新时间，最近 7 天为 2 件；未提交任何库存命令。记录在 `production-projection-read.json`、`production-release-checks.json`。这验证服务端真实投影，不代替手机正常 bearer 链路的同步验收。
- 正式主 APK `0.4.0-terminal` / code 5 已覆盖临时测试宿主；设备与本机 SHA256 一致，且安装标志无 `DEBUGGABLE`。主应用源代码与发布标签一致。三个同证书恢复包及摘要在 `output/android/design/release/`，清单为 `manifest.json` / `SHA256SUMS`；主应用证据为 `final-device-manifest.json`。AOD 与 overlay 本轮不需安装更新。
- 最终设备设置页显示 `Owner · 我的家庭`、`已连接 · 30 × 12 mm`；原登录与缓存仍在，打印常连服务处于前台。60 秒待机与插电常亮 0 已核对，相机客户端为空。真实离线主界面截图为 `final-native-recent.png`，设置读证为 `final-settings.xml`。
- 手机当前 `Active default network: none`，Wi-Fi 开启但未连接。正式包上的 `ProductionReadAuditTest` 因无法联网而未通过，日志为 `production-read-audit.log`；未导出凭据或用其他客户端令牌代替。旧缓存缺少新增时间字段，因此最近明确显示“同步后可查看最近变化”，允许浏览全部库存。**手机联网后的真实最近列表／AOD 同步与前摄实物识别仍待复核；三张纸样外观已由用户确认正常。** 用户联网后可显式启用只读仪器核对，默认模拟器运行会跳过此测试。
- GitHub 的 APK 上传两次遇到网络超时，未留下部分资产；[公开发布](https://github.com/Cabbyte/Acornary/releases/tag/v0.12.0) 提供源码与构建说明，本机签名 APK 已交付并安装。没有将发布私钥送入仓库或 CI。

## D101 待机连接与前摄扫码改进（2026-10-31，0.3.1）

应用户反馈，主应用现在默认记住经过型号核验的 BLE 地址，以静音 `connectedDevice` 前台服务保持连接，空闲约每 15 秒查询状态，断线退避重连；通知或设置可明确暂停。手机系统中经典蓝牙的配对地址不再混入 BLE 连接候选。打印任务与心跳串行，自动重连绝不恢复旧打印任务。没有永久唤醒锁或打印机自动关机配置变更。

- 标签右侧二维码（含四模块白边）撑满短边：30 × 12 mm 为 96 × 96 像素，原为 82 × 82；40 × 20 mm 为 160 × 160 像素。编号移至文字区，不插值生成灰边，物品链接保持兼容。
- 实机选择标准自动对焦前摄 2，确认分析流为 1920 × 1440、连续图片自动对焦；支持点按对焦、ML Kit 自动变焦建议和 1× / 2× / 3× 切换。硬件报告最近对焦距离约 10 cm，数字变焦不能修复过近失焦。
- 10:29:02（Asia/Shanghai）新样张收到单张打印完成确认，用户随后确认“新版可以识别”。只打印明确标记的测试样张，没有修改正式库存。旧版样张“普通扫码工具可识别”的验收不能替代本次前摄验收。
- 实际 AOD `Dozing` 状态下仍持续收到 D101 心跳确认；10:32:21 应用进程重启后自动核验并重连，10:44:50 最终 APK 热更新后由 `MY_PACKAGE_REPLACED` 恢复前台服务并自动重连。没有自动重打。
- `0.3.1-terminal` 最终代码 `e21b5bd` 已同签名安装，设备与本机 APK SHA256 一致。屏幕超时恢复为 60000 ms，插电常亮为 0；扫码退出后 `Active Camera Clients` 为空。AOD 伴随应用与系统模块未更改。
- 本地编译、lint、17 项主应用单元测试通过；5 项同签名标签仪器测试在 Pixel 上通过。最终[完整 CI](https://github.com/Cabbyte/Acornary/actions/runs/41160596439) 已通过，包括 Android 构建/lint/单元测试、20 项隔离模拟器仪器测试，以及 Web/OAuth/PostgreSQL/浏览器/真实容器恢复回归。新增完整静区、后台保留连接、心跳超时自动重连、不重放未确认任务、心跳/打印互斥测试。

证据保存在 `output/android/printer/`：`revision-label-tests.txt`、`aod-connection-proof.txt`、`camera-active-031.txt`、`revision-physical-verification.json`、`final-031-manifest.json`、`final-031-printer-log.txt`、`final-031-printer-service.txt`、`final-031-camera-clients.txt`、`ci-e21b5bd/`。安装包另存为 `acornary-terminal-0.3.1-e21b5bd.apk`。40 × 20 mm 纸卷、打印机长时间断电重开、整机重启及全天运行仍不能用这次短时验收代替。

## D101 打印扩展（2026-10-31）

用户现已要求接入打印，确认 D101 开机且装入 30 × 12 mm 标签纸，扩展范围见 [打印说明](printing.md)。主应用 `0.3.0-terminal` 新增按需附近设备权限、D101 型号核验、原生预览和单张打印、纸张/浓度偏好、发送前资料核对和中断后待确认标记。打印不修改库存。

- Android 编译、lint 和主应用 17 项 JVM 测试通过。两种尺寸的完整图像编码摘要与既有 Web 驱动一致，覆盖错误型号、上盖打开、丢失响应不重发和结束确认失败。
- 最终代码 `d6f3e97` 的 [Android CI](https://github.com/Cabbyte/Acornary/actions/runs/41092608325/job/124190104201) 已通过：构建、lint、单元测试和 Android 12 隔离模拟器的 16 项仪器测试全部成功，包括反向横屏、1.5 倍字体下测试打印按钮可见。
- 同一代码的[完整 CI](https://github.com/Cabbyte/Acornary/actions/runs/41092608325) 也已通过，包含 Web、OAuth、PostgreSQL、浏览器以及真实容器迁移/应用恢复回归；日志保存在 `output/android/printer/ci-full-d6f3e97.log`。
- 已使用现有发布密钥更新主应用，保留数据与 AOD 系统模块。手动安装同签名测试包，仅运行新的 `LabelPrinterTest`，4 项实机测试通过：两种尺寸的最终黑白位图可解码为原物品 ID、测试码与库存分离、长名称换行、持久待确认标记。未运行会卸载正式主应用的 Gradle 仪器任务。
- 最终代码 `d6f3e97` 的主应用 APK 已安装到 Pixel 3，设备文件 SHA256 与本机发布文件一致，记录于 `output/android/printer/release-manifest.json`；更新后崩溃缓冲为空。AOD 继续显示正式家庭及临期投影，但不扩大为全天稳定性验收。
- 手机已联网，并在原生页面显示现有账号家庭和实时临期信息；未读取或迁移登录令牌。Chrome 仍为 91，本机 App Link 状态仍为 1024，因此浏览器更新和正常域名验证仍未完成。
- 用户已通过系统界面解锁并允许附近设备权限。首次 Pixel 扫描未发现 D101，Mac 的 BLE/经典蓝牙交叉扫描也未发现；用户重启打印机并在系统设置配对后，Mac 可发现 D101 广播，Pixel 原生应用连接成功，无需改动打印代码。
- 2026-10-31 09:53:40（Asia/Shanghai）主应用核验型号 2560；09:53:45 开始单张打印，09:53:50 收到完成确认。用户随后明确确认成功出纸。纸张设置为 30 × 12 mm、浓度 2；`output/android/printer/physical-print-log.txt` 保留不含标签内容的协议完成记录。只打印测试样张，没有修改库存。
- 用户进一步确认“版式正常，二维码也可识别”，30 × 12 mm 测试标签的连接、出纸、方向/边距/字迹及纸上二维码验收通过。40 × 20 mm 纸卷以及真实物品标签的联网资料核对仍未做物理验收。此次手机暂无默认网络，实际物品打印会按设计要求联网，测试样张可独立打印。

本轮证据保存于 `output/android/printer/`：`tests.log`、`final-checks.log`、`label-instrumentation.txt`、`final-release-build.log`、`final-signing.log`、`final-install.txt`、`release-manifest.json`、`ci-d6f3e97/` 和页面取证。最终 APK 另存为 `acornary-terminal-0.3.0-d6f3e97.apk`，避免后续构建覆盖。此前无打印版本的证据保留如下；其中“无 BLE 权限”描述的是当时版本。

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
| 手机 Chrome 更新 / Custom Tabs / App Link | 10 月 31 日手机已联网，Chrome 仍为 91、域名验证状态仍为 1024；需解锁后更新浏览器并完成正常域名验证 |
| 手机正式账号登录、真实库存与电脑核对 | 10 月 31 日已在原生应用看到现有账号家庭及实时库存；登录过程未旁观，逐项与电脑核对及家庭切换仍待验收 |
| 当前完整版本真实二维码识别、权限拒绝、相机占用恢复 | CameraX 先前硬件验证通过，完整账号流程尚需实机验证 |
| 写入成功 → 真实投影 → AOD 更新 | 服务端隔离写入测试通过；不得用正式物品自动消耗测试 |
| 插电五分钟同步、断网/拔电/省电降级、刷新响应丢失 | 调度与恢复已实现，需授权登录后实际连续测量 |
| 挥手开关、物理持续遮挡 | 状态机测试通过，物理手势仍待验证；默认关闭 |
| 24 小时稳定性与温度/唤醒锁 | 尚未开始，不以短时 AOD 或构建通过替代 |

10 月 30 日验收结束时，手机已恢复 USB/ADB，用户存储为 `RUNNING_UNLOCKED`，但屏幕仍锁定且无默认网络。10 月 31 日已恢复网络并显示正式账号库存，打印授权仍需用户解锁当前屏幕；这两种“解锁”状态不能混为一谈。没有绕过 PIN、强制把 App Link 标记为成功或迁入其他客户端凭据。原始设置基线仍保留在 `output/android/pixel3-baseline/settings.json`，伴随应用设备保护存储也保留已捕获基线。

## 恢复实机验收的顺序

1. 用户方便时解锁并连接可访问正式站点的网络，在 Google Play 更新 Chrome。通过 Android 正常域名验证确认 `acornary.protium.top` 为 `verified`。
2. 用户在松仓终端发起 Custom Tabs 登录，选择家庭并授权；核对临期、库存及家庭时区与电脑一致。保持正式库存只读。
3. 在隔离测试家庭验证真实标签、三类写入、版本冲突及不确定结果恢复；退出测试家庭后重新授权正式家庭，核对缓存及 AOD 隔离。
4. 检查两个横屏方向、键盘、相机释放、60 秒待机、物理双击和挥手遮挡；记录实际五分钟同步及断网、拔电后的降级。
5. 基础验收通过后开始下述 24 小时取证。当前尚未启动全天运行验收。

## 连续运行取证

登录并完成基础验收后，使用 `tools/soak.py --hours 24` 从这台 Mac 每 5 分钟读取设备状态。记录开始/结束时间、连接中断、同步日志、崩溃、唤醒锁、温度及相机客户端。该脚本不读取账号令牌或修改库存。中断后保留原始 JSONL，不能把不足 24 小时的片段标记为全天通过。
