---
name: '松仓 · Acornary'
description: '暖纸底、陶土强调的家庭库存工作台。'
colors:
  primary: '#AB5F40'
  primary-hover: '#965136'
  primary-active: '#7D422C'
  primary-text: '#87472F'
  primary-text-hover: '#723B29'
  link: '#8F4C32'
  paper: '#F6F0E6'
  panel: '#FFFCF6'
  ink: '#2B2420'
  muted: '#68615C'
  placeholder: '#756D66'
  divider: '#E8DFD2'
  instance-divider: '#EEE6DB'
  selection: '#F5E5D8'
  location-ink: '#51463D'
  date-past: '#A33828'
  consumption-border: '#DDC9B7'
typography:
  brand:
    fontFamily: '"Songti SC", "STSong", "SimSun", serif'
    fontSize: '24px'
    fontWeight: 600
    letterSpacing: '0.08em'
  headline:
    fontFamily: '"Songti SC", "STSong", "SimSun", serif'
    fontSize: '28px'
    fontWeight: 600
    lineHeight: 1.4
  headline-mobile:
    fontFamily: '"Songti SC", "STSong", "SimSun", serif'
    fontSize: '24px'
    fontWeight: 600
  dossier-title:
    fontFamily: '"Songti SC", "STSong", "SimSun", serif'
    fontSize: '24px'
    fontWeight: 600
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '14px'
  body-mobile:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '16px'
  group-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '16px'
  instance-meta:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '13px'
  instance-meta-mobile:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '14px'
  remaining:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: '26px'
rounded:
  control: '8px'
  panel: '12px'
spacing:
  tight: '4px'
  small: '8px'
  compact: '12px'
  section: '16px'
  detail: '20px'
  page: '24px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    rounded: '{rounded.control}'
    height: '36px'
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  button-primary-active:
    backgroundColor: '{colors.primary-active}'
  button-default:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    height: '36px'
  input:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    typography: '{typography.body}'
    height: '36px'
  bottom-navigation:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.muted}'
    padding: '8px 12px'
  attention-filter:
    rounded: '{rounded.control}'
  inventory-panel:
    backgroundColor: '{colors.panel}'
    rounded: '{rounded.panel}'
    padding: '24px'
  group-toggle:
    textColor: '{colors.ink}'
    padding: '8px'
  instance-selected:
    backgroundColor: '{colors.selection}'
    rounded: '{rounded.control}'
    padding: '10px 8px'
  remaining-panel:
    backgroundColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '16px'
---

# Design System: 松仓 · Acornary

## Overview

**Creative North Star: "暖纸家庭储藏工作台"**

松仓用暖纸底与浅色内容面承载家庭物品，陶土色标记主要动作和选择。系统宋体只出现在品牌与少量标题，列表、数字和表单维持系统无衬线字体的清晰密度。

界面以商品摘要、可展开实物和按需出现的单件档案组织阅读。沿用 React 与 Ant Design 的控件行为，通过主题和业务布局表达已批准的方向；当前只提供浅色方案。

**Key Characteristics:**

- 暖纸与浅色内容面形成轻层次。
- 商品摘要与紧凑实物条目共享同一阅读面。
- 陶土强调动作与选择，状态保留语义。
- 内容宽度决定分栏，移动端保留可触达操作。

本文件从当前实现提取，来源为 `apps/web/src/ui/theme.tsx`、`layout.css`、`inventory-layout.tsx`、`workbench.tsx`、`stash-results.tsx`、`item-inspector.tsx`、`activity.tsx`、`forms.tsx`、`components.tsx` 与 `apps/web/src/lib/stash.ts`。已对照 `.impeccable/review/` 的桌面、手机、展开分组及两种档案截图。前置 token 为规范值；未覆盖的 Ant Design 颜色、阴影和控件状态由当前主题算法管理，不另造一套默认值。

## Colors

### Primary

陶土 `primary` 用于主按钮、余量进度与交互强调。`primary-hover`、`primary-active` 记录实际按钮状态；较深的 `primary-text` 与 `primary-text-hover` 用于选中导航、树节点和交互文字；`link` 用于文本链接。

### Neutral

暖纸 `paper` 是页面背景及余量区域，浅纸 `panel` 是内容面。暖墨 `ink` 承担正文，`muted` 承担次要说明，`placeholder` 用于输入提示。`divider` 与 `instance-divider` 分隔商品与实物；`selection` 标记选中实物，`location-ink` 使位置说明清楚可辨。`consumption-border` 用于消耗选项边框。

`date-past` 是已过日期的语义文字色。其余警告、错误和信息提示继续使用 Ant Design 语义样式；例如档案信息条保留库的信息色，不强行改为品牌色。

**The Semantic Color Rule.** 陶土表达动作与选择，已过日期和库内状态提示保留各自语义，不把所有状态统一染成品牌色。

## Typography

品牌与工作台标题使用系统宋体栈；正文、列表、表单和数字使用系统无衬线栈，具体栈见前置 token。无远程字体请求。

标题角色分别对应品牌、物品页标题和档案标题；不是所有 Ant Design 标题都改成宋体。商品摘要标题与实物说明沿用无衬线，手机实物说明增大一档。余量数字使用 `remaining` 角色，并启用等宽数字（`tabular-nums`）。完整 UUID 与 revision 收在技术信息，列表需要区分时展示稳定尾号。

## Layout

工作台在桌面使用侧栏和内容区；侧栏在宽屏为 224px、普通桌面为 200px，可收起为 64px。手机以顶部品牌/家庭切换与底部四项导航承载页面入口。添加物品属于页面操作，不属于导航。

视口小于 768px 时采用手机布局，1200px 起启用宽屏条件。物品工作区再通过 ResizeObserver 测量内容宽度：`contentWidth = workspace.width - 48`。位置栏需同时满足宽屏和内容宽度至少 836px；并列档案还需内容宽度至少 1360px（320 + 656 + 384）。位置栏默认 224px，可在 180–320px 范围内调整，并按剩余宽度约束；列表保留 656px，档案占 360px 加 24px 间距。不要把这些条件简化成固定三栏。

空间不足时位置使用抽屉，桌面档案使用 360px 抽屉；手机档案替换主列表视图。统一编辑 ActionDrawer 在桌面为 560px，手机为全宽，响应式变化保留同一草稿实例。主面板桌面内边距使用 `page`，手机使用 `section`；手机外层左右留 12px，底部预留导航空间。动态内容最大宽度为 900px。

采用前置 spacing 的紧凑间距。长名称、位置与笔记允许换行；手机搜索独占首行，分组、位置和筛选排在下一行，关注按钮换行显示。宿主 safe area、可视视口高度与底部间隙参与布局和抽屉边界，需保留现有计算。

## Elevation & Depth

自定义工作台与实物条目依靠色面、细线和间距形成层次，没有新增自定义阴影 token。按钮、抽屉、弹出层仍继承 Ant Design 的阴影与状态实现；不要将其描述为整个应用完全无阴影。

**The Quiet Surface Rule.** 自定义内容面以暖色层次和细分隔线建立结构，控件浮层深度交由 Ant Design 处理。

减少动态效果模式将动画和过渡时长压到 0.01ms。其余状态过渡沿用组件库；当前没有独立业务动效时长或缓动曲线 token。

## Shapes

控件、选中行、余量与消耗区域使用 `control` 圆角；主内容面与档案面使用 `panel` 圆角。商品结果以细横线连接紧凑条目，不把每件实物包装成独立装饰挂牌。库内标签、分页与弹层继续遵循组件自身形状。

## Components

### Buttons

主要动作使用陶土实底 Ant Design Button；移动、编辑、返回及筛选保留普通按钮，商品标题与实物入口使用文字按钮。默认控件高度为 36px；手机主控件和粗指针按钮至少 44px。主按钮 hover/active 颜色由前置 token 明确覆盖，其余状态由库负责。保留 disabled、loading、键盘焦点及可读名称。

### Inputs / Fields

使用 Ant Design 输入、选择、日期及数字控件。容器与文字来自主题 token；桌面字号为 `body`，手机为 `body-mobile`。焦点、错误和禁用样式保留库行为。可选资料分区用细上边线与可展开标题，已有输入时保持可见。提交区在编辑容器底部保持可达。

### Chips / Attention

关注入口是带计数的筛选按钮，激活时使用主按钮状态，多个关注条件按“任一”组合并在界面说明。档案状态使用 Ant Design Tag 区分库存、可用性、开封与状况。标签样式不承担写入授权。

### Cards / Containers

主物品面板与宽屏档案采用浅纸面、较大圆角和内边距。余量区域使用暖纸底、小圆角，只有已记录余量才显示；只有百分比或有效同单位基准才显示进度。笔记与最近动态继续使用小尺寸 Ant Design Card。

### Navigation

桌面菜单使用透明背景、较深陶土选中文字，设置靠侧栏底部。手机导航四项为我的物品、商品目录、动态、设置，每项最小高度 44px、最小宽度 64px，并以 `aria-current` 表达当前页面。收起侧栏仍保留家庭切换入口。

### Product Groups / Item Dossier

商品摘要显示名称、件数、已知位置数及适用提醒，展开按钮最小高度 54px。展开后为带独立复选框的实物条目，入口最小高度 52px；选中实物用 `selection` 底色。单件组可直接进入档案，不能将分组名称代替实物 ID。

档案顺序为识别与位置、已知事实及相关操作、资料、笔记、动态。技术字段折叠呈现，未知值不伪造填充。打开手机或并列档案时焦点移到标题，关闭后回到原入口；激活的编辑抽屉优先保持焦点。位置分隔条支持方向键、Home/End 与可见焦点边框（2px，偏移 2px）；入库核对区焦点边框为 2px、偏移 4px。

侧车组件是用于展示的静态 HTML/CSS 转译，沿用这些角色和状态；生产行为仍由 React/Ant Design 实现。侧车合成 tonal ramps 仅供色彩浏览，不是新增应用颜色 token。

## Do's and Don'ts

### Do:

- Do 使用前置 token 与现有 Ant Design 组件，继承其表单、焦点和错误反馈行为。
- Do 保留未知事实、估计标识、日期类型与家庭时区语义；只为有效余量数据画进度。
- Do 按可用内容宽度安排位置和详情，保留移动端 44px 主操作与 16px 输入文字。
- Do 保留键盘展开、明确的选择范围、详情返回焦点和同一个编辑草稿实例。

### Don't:

- Don't 自动切换深色主题或增加远程字体依赖。
- Don't 用装饰打孔、粗阴影或重复大卡片增加实物列表负担。
- Don't 把商品组当成可直接消耗的实物，或用视觉简化隐藏写入目标。
- Don't 把浏览器截图或文档完成称为真机、真实宿主或生产验收完成。
