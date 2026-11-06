# 候选 Token 对比度计算

版本：P1-RC1；计算日期：2026-11-06。值源为 [design-tokens.json](design-tokens.json)。这是不透明 sRGB 色对的数值计算，未执行实际界面/axe/读屏验收。

算法：每通道 c=8bit/255；c≤0.04045 时 c/12.92，否则 ((c+0.055)/1.055)^2.4；L=0.2126R+0.7152G+0.0722B；ratio=(L亮+0.05)/(L暗+0.05)。判定使用未舍入数值，展示保留两位。正文4.5:1、必要控件边界和焦点3:1。禁用态本候选也按4.5检查，虽不属于相同规范要求。

计算 62 组，低于指定阈值 0 组。border是装饰分隔线，不用于控件唯一识别；controlBorder才是控件边界。focus为偏移2px的外轮廓，比较周围surface而非按钮内部；真实遮挡/对比仍须页面核实。

| 模式       | 前景 / 背景 Token                    | 颜色              | 对比度  | 阈值  | 结果 |
| ---------- | ------------------------------------ | ----------------- | ------- | ----- | ---- |
| daily      | foreground / background              | #2B2420 / #F6F0E6 | 13.46:1 | 4.5:1 | PASS |
| daily      | foreground / surface                 | #2B2420 / #FFFCF6 | 14.90:1 | 4.5:1 | PASS |
| daily      | foreground / surfaceRaised           | #2B2420 / #FFFFFF | 15.26:1 | 4.5:1 | PASS |
| daily      | mutedForeground / background         | #68615C / #F6F0E6 | 5.36:1  | 4.5:1 | PASS |
| daily      | mutedForeground / surface            | #68615C / #FFFCF6 | 5.94:1  | 4.5:1 | PASS |
| daily      | mutedForeground / surfaceRaised      | #68615C / #FFFFFF | 6.08:1  | 4.5:1 | PASS |
| daily      | accentText / background              | #87472F / #F6F0E6 | 6.23:1  | 4.5:1 | PASS |
| daily      | accentText / surface                 | #87472F / #FFFCF6 | 6.90:1  | 4.5:1 | PASS |
| daily      | accentText / surfaceRaised           | #87472F / #FFFFFF | 7.06:1  | 4.5:1 | PASS |
| daily      | accentForeground / accent            | #FFFFFF / #AB5F40 | 4.73:1  | 4.5:1 | PASS |
| daily      | accentForeground / accentHover       | #FFFFFF / #965136 | 5.95:1  | 4.5:1 | PASS |
| daily      | accentForeground / accentActive      | #FFFFFF / #7D422C | 7.81:1  | 4.5:1 | PASS |
| daily      | selectionForeground / selection      | #87472F / #F5E5D8 | 5.75:1  | 4.5:1 | PASS |
| daily      | controlBorder / background           | #8B8077 / #F6F0E6 | 3.40:1  | 3:1   | PASS |
| daily      | controlBorder / surface              | #8B8077 / #FFFCF6 | 3.76:1  | 3:1   | PASS |
| daily      | controlBorder / surfaceRaised        | #8B8077 / #FFFFFF | 3.85:1  | 3:1   | PASS |
| daily      | focus / background                   | #315B7C / #F6F0E6 | 6.35:1  | 3:1   | PASS |
| daily      | focus / surface                      | #315B7C / #FFFCF6 | 7.03:1  | 3:1   | PASS |
| daily      | focus / surfaceRaised                | #315B7C / #FFFFFF | 7.20:1  | 3:1   | PASS |
| daily      | focus / selection                    | #315B7C / #F5E5D8 | 5.85:1  | 3:1   | PASS |
| management | foreground / background              | #24313E / #F2F5F7 | 12.11:1 | 4.5:1 | PASS |
| management | foreground / surface                 | #24313E / #FFFFFF | 13.26:1 | 4.5:1 | PASS |
| management | foreground / surfaceRaised           | #24313E / #FFFFFF | 13.26:1 | 4.5:1 | PASS |
| management | mutedForeground / background         | #566574 / #F2F5F7 | 5.47:1  | 4.5:1 | PASS |
| management | mutedForeground / surface            | #566574 / #FFFFFF | 5.98:1  | 4.5:1 | PASS |
| management | mutedForeground / surfaceRaised      | #566574 / #FFFFFF | 5.98:1  | 4.5:1 | PASS |
| management | accentText / background              | #315570 / #F2F5F7 | 7.20:1  | 4.5:1 | PASS |
| management | accentText / surface                 | #315570 / #FFFFFF | 7.88:1  | 4.5:1 | PASS |
| management | accentText / surfaceRaised           | #315570 / #FFFFFF | 7.88:1  | 4.5:1 | PASS |
| management | accentForeground / accent            | #FFFFFF / #456B8A | 5.64:1  | 4.5:1 | PASS |
| management | accentForeground / accentHover       | #FFFFFF / #365772 | 7.60:1  | 4.5:1 | PASS |
| management | accentForeground / accentActive      | #FFFFFF / #29445C | 10.12:1 | 4.5:1 | PASS |
| management | selectionForeground / selection      | #315570 / #E6EEF4 | 6.72:1  | 4.5:1 | PASS |
| management | controlBorder / background           | #768493 / #F2F5F7 | 3.49:1  | 3:1   | PASS |
| management | controlBorder / surface              | #768493 / #FFFFFF | 3.82:1  | 3:1   | PASS |
| management | controlBorder / surfaceRaised        | #768493 / #FFFFFF | 3.82:1  | 3:1   | PASS |
| management | focus / background                   | #315B7C / #F2F5F7 | 6.57:1  | 3:1   | PASS |
| management | focus / surface                      | #315B7C / #FFFFFF | 7.20:1  | 3:1   | PASS |
| management | focus / surfaceRaised                | #315B7C / #FFFFFF | 7.20:1  | 3:1   | PASS |
| management | focus / selection                    | #315B7C / #E6EEF4 | 6.13:1  | 3:1   | PASS |
| shared     | danger / dangerSurface               | #A33828 / #F7E2DC | 5.35:1  | 4.5:1 | PASS |
| daily      | danger / background                  | #A33828 / #F6F0E6 | 5.87:1  | 4.5:1 | PASS |
| daily      | danger / surface                     | #A33828 / #FFFCF6 | 6.50:1  | 4.5:1 | PASS |
| management | danger / background                  | #A33828 / #F2F5F7 | 6.08:1  | 4.5:1 | PASS |
| management | danger / surface                     | #A33828 / #FFFFFF | 6.66:1  | 4.5:1 | PASS |
| shared     | warning / warningSurface             | #875919 / #FFF0D4 | 5.37:1  | 4.5:1 | PASS |
| daily      | warning / background                 | #875919 / #F6F0E6 | 5.33:1  | 4.5:1 | PASS |
| daily      | warning / surface                    | #875919 / #FFFCF6 | 5.90:1  | 4.5:1 | PASS |
| management | warning / background                 | #875919 / #F2F5F7 | 5.52:1  | 4.5:1 | PASS |
| management | warning / surface                    | #875919 / #FFFFFF | 6.05:1  | 4.5:1 | PASS |
| shared     | success / successSurface             | #466241 / #E8EFE4 | 5.80:1  | 4.5:1 | PASS |
| daily      | success / background                 | #466241 / #F6F0E6 | 6.01:1  | 4.5:1 | PASS |
| daily      | success / surface                    | #466241 / #FFFCF6 | 6.65:1  | 4.5:1 | PASS |
| management | success / background                 | #466241 / #F2F5F7 | 6.22:1  | 4.5:1 | PASS |
| management | success / surface                    | #466241 / #FFFFFF | 6.81:1  | 4.5:1 | PASS |
| shared     | info / infoSurface                   | #365F78 / #E4EDF0 | 5.77:1  | 4.5:1 | PASS |
| daily      | info / background                    | #365F78 / #F6F0E6 | 6.04:1  | 4.5:1 | PASS |
| daily      | info / surface                       | #365F78 / #FFFCF6 | 6.69:1  | 4.5:1 | PASS |
| management | info / background                    | #365F78 / #F2F5F7 | 6.26:1  | 4.5:1 | PASS |
| management | info / surface                       | #365F78 / #FFFFFF | 6.85:1  | 4.5:1 | PASS |
| shared     | disabledForeground / disabledSurface | #59616A / #E5E7E9 | 5.07:1  | 4.5:1 | PASS |
| shared     | white / danger                       | #FFFFFF / #A33828 | 6.66:1  | 4.5:1 | PASS |

## 复现

在仓库根目录使用 Python 3 标准库读取JSON，按上式重算表内色对；不能以四舍五入后的4.50替代实际值。新增hover、error背景、opacity或图片底后，新增对应实际色对。当前JSON没有半透明Token；若实现加入透明度，必须先与实际底色混合后再算。

文本/非文本阈值依据：[W3C文本对比度](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)、[W3C非文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)。这是计算记录，不是WCAG整体认证。
