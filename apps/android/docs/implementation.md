# Pixel 3 终端实施记录（历史）

当前无打印版本的实现与验收请以 [验收记录](acceptance.md) 和 [工程说明](../README.md) 为准。以下保留此前硬件阶段证据，打印不在当前实施范围。

## 产品约束

- 固定、插电的家庭终端；Pixel / Material 3 原生控件；横屏优先，临期列表和详情双栏。
- 首页展示全家庭库存的未来 7 天临期项，日期按家庭时区由服务端派生。
- 一期包含扫码、详情、开封、部分消耗、整件消耗确认和单件打印；复杂管理留在电脑，不内嵌管理 WebView。
- 普通家庭使用不反复确认身份；登录及授权通过系统浏览器完成。
- 待机约每 5 分钟同步，唤醒和本机操作后立即刷新；展示最后同步时间，离线不执行库存写入。
- AOD 独立低功耗显示；双击进入主界面；相机只在扫描页工作。
- 打印机为 NIIMBOT D101。未知打印结果不自动重发，避免重复出纸。

## 2026-10-29 已验证

- Mac M1 Pro / 16 GB；Android Studio、Java 17、Android SDK 36 和固定版本 Gradle Wrapper 可构建。
- Pixel 3 Android 12 / API 31，Magisk root 可用。
- 主应用成功安装，Material 3 动态配色、侧边导航及横屏布局已实机显示。
- CameraX 成功打开前摄 Camera 1，系统有实际图像流；真实纸面标签解码仍需验收。
- 静态 RRO 已使 DreamManager 选择 `top.protium.acornary.aod/.AcornaryDreamService`。
- 实际 DreamService 为 `mCurrentDreamCanDoze=true`、`mCurrentDreamIsDozing=true`、显示 `DOZE`、亮度 10；屏幕显示自定义内容。
- 双击传感器已订阅：`com.google.sensor.double_touch`，one-shot / wake-up。
- 5 项 JVM 测试通过：标签链接校验、协议编码、分片/合帧、校验和错误；主应用和 AOD lint 无错误。仍有依赖新版本、横屏限制和图标等警告。

显示 DOZE 证明走系统低功耗显示路径，不等于已量测整机功耗或验证长时间烧屏防护。分钟刷新、长期稳定性、温度和断电恢复仍需连续运行验收。

## 待完成

1. 解锁后 Provider 读取、反向横屏及长期 AOD 稳定性验收。
2. 前摄真实纸面 QR 识别及正反横屏检查。
3. D101 实机发现、连接、型号确认、指定纸型测试标签、完成状态/断线处理。用户确认当前打印机不在旁边，本项暂不能实测。
4. 正式账号与库存接入：AppAuth + Custom Tabs + PKCE，专用 public client 和 resource，校验 App Link；不把浏览器 cookie 或现有 MCP 令牌写进 APK。
5. 服务端 `/api/terminal/v1`：绑定令牌家庭和成员授权版本；快照包含 revision、家庭时区、服务端 reminderDate；写操作只开放一期范围并复用现有 execute、revision 和幂等语义，来源 ANDROID。
6. 本地 Room 展示缓存、Android Keystore 保护令牌、单飞刷新令牌、缓存隔离及退出清理；WorkManager 待机工作服从系统调度，若需精确五分钟需另行验证插电终端的调度方式，不能将周期 WorkManager 设为五分钟。
7. 原生库存列表/详情与确认交互；标签像素布局沿用 Web 规格，Native BLE 以有界串行请求执行 D101 打印协议。
8. 端到端真实数据验收、回归和发布签名后，才称为可日常使用的终端。

当前版本不展示虚构库存，也未改动正式后端或库存。设备证据保存在忽略目录 `output/android/`。

## 2026-10-30 更新

- 用户确认物理双击已亮屏并打开松仓终端，且完成首次解锁。
- 已安装横屏 Canvas 修正、BLE 扫描超时清理及页面调整；截图 `aod-landscape-fixed.png` 验证内容按横屏绘制，DreamManager 仍显示 DOZE / 亮度 10。截图文件本身可能仍以屏幕原生竖向像素保存，这不代表内容竖排。
- 修正 DreamActivity 窗口重新附着时的首次绘制，避免在用户已解锁时短暂保留默认“等待解锁”。本次 AOD 构建和 lint 通过，日志 `aod-update-build.log`。
- 相机退出实测通过：`camera-active-updated.txt` 记录前摄 Camera 1 连接；`camera-closed-updated.txt` 记录 DISCONNECT 且 Active Camera Clients 为空。
- 官方 AOD 恢复往返已通过：禁用模块并重启，`aod-restored.txt` 确认官方 SystemUI DozeService 处于 DOZE；重新启用并重启，`aod-verified.txt` 确认 Acornary 服务处于 DOZE / 亮度 10，`aod-after-restore.png` 确认横屏内容仍正确。最终保留 Acornary AOD，验证标记已写入；本次重启后需要用户再解锁一次。
- 传感器清单见 `sensors.txt`：前部接近传感器为 AMS TMD2725，类型 `android.sensor.proximity`，on-change / wakeUp，无额外权限。它输出近/远状态；记录中的 5.0 不应解释为物体真实距离 5 cm。没有发现独立前置 ToF 测距传感器。可用于近距离遮挡/挥手唤醒；不能据此承诺半米至一米的人体接近检测。尚未新增接近自动唤醒功能。

以上证据均位于 `output/android/`。主应用和 AOD 可用同签名 `adb install -r` 迭代；系统伴随应用的 `/data` 更新可能优先于 Magisk APK，因此安装脚本会同步更新已存在的 AOD 包。
