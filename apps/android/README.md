# 松仓 Android 终端

Kotlin、Jetpack Compose、Material 3 原生应用，专为已核验的 Pixel 3 / Android 12 双向横屏使用。支持前摄扫码和 NIIMBOT D101 单件标签打印，打印接入说明见 [D101 打印](docs/printing.md)。

当前实现与真实验收的边界见 [验收记录](docs/acceptance.md)。APK 构建成功不代表已完成正式账号、真实库存或 24 小时运行验收。

## 工程与本机开发

Android Studio 打开本目录；Gradle JDK 选择 Java 17：
`/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`。
SDK：`/Users/timli/Library/Android/sdk`。Wrapper 9.1.0、AGP 9.0.1、Kotlin 2.2.10、compile/target 36、min 31。依赖固定版本，本次没有升级已验证的工具链。

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
cd apps/android
./gradlew :app:assembleDebug :aod:assembleDebug :overlay:assembleDebug \
  :app:lintDebug :aod:lintDebug :app:testDebugUnitTest :aod:testDebugUnitTest
# 使用独立模拟器或尚未登录的测试手机；Gradle 会安装和卸载被测包
./gradlew :app:connectedDebugAndroidTest
```

切勿在已经承载正式账号的手机上直接运行会卸载被测应用的仪器测试。正式签名安装后，调试签名不能直接覆盖；日常实机更新使用下列正式构建。

| 模块 | 职责 |
| --- | --- |
| `app` | Compose / ViewModel / StateFlow、AppAuth、OkHttp、Room、DataStore、前摄 ML Kit、D101 BLE 打印、同步调度 |
| `aod` | 无网络和令牌的 DreamService、原生 Canvas、双击及可选接近手势、有限待机设置接口 |
| `overlay` | 静态 RRO，仅替换 Android `config_dozeComponent` |

手机不取得通用 root shell。电脑脚本只向同签名伴随组件授予 `WRITE_SECURE_SETTINGS` 及 `WRITE_SETTINGS`；接口仅能应用或恢复待机配置。设备首次解锁前 AOD 只画时钟与解锁提示。

## 正式签名与安装

在仓库根目录：

```sh
# 仅首次创建；密钥已存在会拒绝覆盖
python3 apps/android/tools/release.py --create-key
# 后续构建
python3 apps/android/tools/release.py
```

专用私钥位于 `~/.config/acornary/android-signing/terminal-release.jks`（0600），密码保存在 macOS 钥匙串 `Acornary Android release signing`。Gradle 只从当前构建进程环境读取密码，不写入工程。公开证书 SHA256：

```text
43:86:9E:7E:B6:34:F1:4A:18:FC:EE:65:1B:C8:FF:60:2E:59:D5:50:F1:56:DA:7E:01:3D:15:7B:69:E4:47:B9
```

这台 Pixel 3 从调试签名迁移使用 Android APK Signature Scheme v3 的 proof of rotation，不清除 AOD 的原始设置基线：

```sh
python3 apps/android/tools/rotate-signing.py
python3 apps/android/tools/device.py install-aod --variant release --migration
adb -s 8AJX0TMS5 reboot
# 启动后用电源键熄屏进入 AOD，在 300 秒内验证
python3 apps/android/tools/device.py validate-aod
```

三个 migration APK 仍由同一正式密钥签名，只额外携带此前调试证书到正式证书的迁移证明。App Link 只公布正式证书。迁移证明的历史签名权限能力用于升级原来声明签名权限的包；不允许回滚到调试密钥。后续更新可以直接用正式 APK；若需要继续保留签名历史，重复运行 `rotate-signing.py`。

`overlay` 为系统静态覆盖，不能用 `adb install -r` 更新，必须通过 Magisk 模块并重启。主应用和 AOD 伴随应用可同签名热更新；AOD 的 `/data` 更新和模块 APK 必须保持一致。

热更新 AOD 会断开正在运行的 DreamService，屏幕可能暂时完全熄灭。亮屏后再正常待机应重新进入 Acornary AOD；更新后用 `tools/device.py status` 检查实际服务和 `DOZE` 状态，不能只凭安装成功判断恢复。

脚本限定序列号 `8AJX0TMS5`、固件 `SP1A.210812.016.C2`，只管理 `/data/adb/modules/acornary_pixel3_aod`。首次系统设置基线必须保留在 `output/android/pixel3-baseline/settings.json`。新模块未在启动后 300 秒内验证会自动禁用并重启；此保护不能替代设备恢复模式。

## 接入账号与后端

后端契约及运营命令见 [终端 API](../../docs/terminal-api.md)。发布顺序：兼容后端 → 注册专用 public client → 配置客户端 ID 与公开证书指纹 → 核对 `config` / `assetlinks.json` → 手机验证 App Link → 用户在 Custom Tab 中登录并选择家庭。

```sh
adb -s 8AJX0TMS5 shell pm verify-app-links --re-verify top.protium.acornary
adb -s 8AJX0TMS5 shell pm get-app-links top.protium.acornary
```

只接受 `https://acornary.protium.top/android/oauth/callback`。AppAuth 验证 state、PKCE、客户端及回调；没有自建 WebView 登录。不要从浏览器或 MCP 提取现成凭证到手机。

正式后端已完成客户端和签名配置。`pm get-app-links` 必须看到域名状态 `verified` 才算本机验证通过；服务器声明或 Google 查询成功不能代替此项。若设备没有网络，先恢复联网再重新验证，不使用 shell 强制设置成功状态。Chrome 更新通过 Google Play 完成，当前实机进度见 [验收记录](docs/acceptance.md)。

## 日常运行与异常

- 临期：服务端提醒日期，包含已过提醒日及未来 7 天；库存：名称/品牌搜索、位置和开封状态筛选，未知状态单独显示。
- 扫码：仅正式 `/i/<短 ID>` 标签，识别后暂停并显示详情；120 秒无结果释放相机，离开页面或后台也释放。
- 打印：在设置中允许附近设备权限并连接 D101；物品详情标题旁的打印按钮打开预览。支持 30 × 12 mm / 40 × 20 mm，浓度 1–3，单次一张。发送前重新读取物品，资料变化时刷新预览并要求再次确认。打印中暂时保持亮屏；退到后台断开连接，出纸结果不确定时先核对纸张，不自动补打。
- 消耗使用十进制字符串和 `BigDecimal`，固定原单位。整件消耗需要确认；完成后保留该物品。数量未知不能部分消耗，容器只作为位置浏览。
- Room 是缓存，云端是唯一库存。写入前持久化原参数、revision 和幂等键；超时核对结果，重试保留原请求。没有离线写入队列。
- 网络可用性先检查互联网能力，再通过真实接口验证；不把 Google 网络探测失败等同于松仓服务不可达。
- 终端模式关闭“插电保持唤醒”，设置系统 60 秒待机。输入/扫码/提交期间暂时保持屏幕；输入草稿保存，5 分钟不操作释放亮屏。
- 插电、非省电且有精确闹钟权限时，五分钟一次短时 dataSync 前台服务；15 分钟 WorkManager 兜底。实际间隔服从 Android 调度，必须实测。单轮服务总超时 35 秒，唤醒锁最长 40 秒。
- 系统限制后台活动或拒绝启动同步服务时，明确显示降级并停止快速闹钟，按 15 分钟以上的预期判断陈旧数据。返回主应用时尝试恢复；系统仍限制后台活动时继续兜底。
- AOD 通过同签名只读 Provider 读取投影，ContentObserver 即时更新、每分钟刷新时钟并微移位。最多四件临期项；不联网、不访问令牌。
- 挥手默认关闭，仅在 AOD 订阅 TMD2725 接近传感器；先远至少 300ms、近 100–1500ms、移开才触发，冷却 10 秒。不支持远距离人体检测。
- 暂停终端模式恢复原待机设置并停止定时同步、挥手。退出账号清理缓存与 AOD 投影。身份失效不继续后台重试。

## 恢复官方 AOD

```sh
python3 apps/android/tools/device.py restore-aod
adb -s 8AJX0TMS5 reboot
python3 apps/android/tools/device.py status
```

恢复标记模块禁用并还原首次基线；静态覆盖必须重启后解除。异常时在 Magisk 禁用 Acornary 模块。不要修改其他 Magisk 模块或删除原基线。
