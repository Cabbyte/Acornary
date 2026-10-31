# Android 品牌资产

视觉来源：[Acornary Figma 工作台](https://www.figma.com/design/Xt5Dcp0NHtYPC0UbSF3iHO/Acornary?node-id=136-374)。移动工作台与详情节点为 `136:374` / `136:375`；本次只借用其品牌、图标、色板和紧凑层级，布局按 Pixel 3 横屏重排。

| 本地原始资产 | Figma 节点 | 用途 |
| --- | --- | --- |
| `source/items.svg` | `137:397` | 物品侧栏图标 |
| `source/settings.svg` | `137:403` | 设置侧栏图标 |
| `source/brand.svg` | `133:384`，D 透明品牌 | 侧栏品牌、单色桌面图标 |
| `source/launcher.svg` | `133:358`，D 默认品牌 | 自适应桌面图标前景 |

原始 SVG 保持导出内容；尺寸、来源及 SHA256 见 [assets.json](assets.json)。其余操作图标来自固定版本 `lucide-static@0.468.0`，本地保留原始 SVG 及 ISC 许可证，许可证同时随 APK 打包。没有网络图标或临时 Figma URL。

Android VectorDrawable 由 SDK 的 `Svg2Vector` 转换，不手工描摹路径。先完成 Gradle 依赖下载，再在仓库根目录执行：

```sh
/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java \
  apps/android/tools/ConvertSvg.java apps/android/design/source \
  apps/android/app/src/main/res/drawable
```

转换器仅将 Android 不支持的 CSS `currentColor` 替换为黑色；Compose `AcIcon` 统一施加主题前景色。品牌使用原有色彩和长宽比例，桌面图标通过自适应掩膜安全区内缩。API 33 增加单色图层。

固定主题定义于 `AcornaryTheme.kt`：陶土 `#AB5F40`、暖灰 `#F4F1EE`、白色内容、正文 `#191A1B`、辅助文字 `#68615C`、分隔线 `#D8D0C9`。深色为相应暖灰色板；系统选项仅跟随明暗，不读取壁纸动态配色。

界面证据由 `WorkspaceDesignTest` 输出，CI 上传至 `android-verification` 的 `output/android-design/`。验收包括 600×360dp、两个横屏方向、大字体、搜索键盘和批次预览；真实手机与实体标签证据另见验收记录。
