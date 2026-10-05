# Product language — Acornary / 松仓

## 1. 产品命名

- **英文名：** Acornary
- **中文名：** 松仓
- **工作描述：** 家庭物资的结构化记忆
- **英文定位：** A structured memory for the physical things in your home.

Acornary 延续松鼠收集、储藏并记住物品位置的意象；松仓强调家庭、储藏与记忆。中英文名称不要求逐字互译。

## 2. 产品语言与领域语言

| 产品概念 | 建议 UI 表达 | 领域表达 |
| --- | --- | --- |
| 家庭数据空间 | My Nest / 我的家庭 | Household，数据与权限边界 |
| 分类与商品 | Catalog / 商品目录 | CatalogNode 树，GROUP / SKU |
| 某种商品 | 商品 / SKU | CatalogNode 中的 SKU；稳定 ID |
| 所有实物 | Stash / 松仓 | Item 集合，每件有独立 UUID |
| 具体一件 | 这瓶 / 这根 / 这件 | Item |
| 实际的家或房间 | Home / 家、厨房等名称 | 引用通用容器 SKU 的 Item，与 Household 含义不同 |
| 位置与容器 | Places / 存放位置 | Item 容纳树及派生路径 |
| 属性与状态 | Details / 详情 | 内嵌 attributes + AttributeTemplate |
| 物品记忆 | Notes / Memories | Note + NoteAttachment |
| 变化记录 | History / 历史 | Event；operation_id 关联一次操作 |

核心代码和公共工具使用中性的领域名称，不使用 Acorn、Nut 等品牌词代替实体名。CatalogNode 是目录节点，Item 是具体对象；kind=SKU 是目录节点种类，不是第三个实体。

“六瓶相同牛奶”表示同一个 SKU 下有六件实物，不意味着它们所有属性一致。“喝剩半瓶”表示这件实物的内容变化，不表示它的 UUID 或物理件数变成半个。“移到冰箱”表示更改父 Item；位置路径是展示结果。

UI 可按商品、到期日、位置分组显示数量，但分组不是存储身份。操作结果展示实际选中的实例和变化；无需用户输入 UUID，但不能在界面聚合时丢掉单件身份。

属性按 product、lifecycle、contents、container、catalog、clothing、device 七个模板组织，界面可以显示“开封”“保质期”“状况”等分区，不要求用户理解模板绑定。一个 lifecycle 中的状态、开封、日期、状况仍是独立维度，不能合成互斥的总状态。

用户可以只记录一个日期，也可以暂不填写任何属性。默认库存显示包含状态未知的对象并标明未知数量；“未记录”不能展示成“未开封”“完好”或“可用”。明确操作只记录相应事实，不强迫用户预先补齐整个详情页。

## 3. 产品边界

系统同时保留机器可查询的结构化事实和用户自由表达的记忆。云端是唯一正式库存，用户通过 Codex／ChatGPT 的 MCP 或产品页面管理物品与文字 Note。Web 与 MCP Apps 共用工作台；`/inspect` 保留只读模型核对能力。

用户无需手写 UUID；多个候选无法唯一定位时，助手展示候选并等待确认，不自动选择。检查器将数据库记录、派生结果和 API 响应分区展示；完整带前缀 UUID 与 revision 用于核对。属性绑定无独立 ID，缺失属性显示“未记录”。图片附件、自动选取与 FEFO 尚未实现；云托管、OAuth、账号与家庭成员关系已实现，具体边界见当前实现说明。

用户可以问：我拥有什么、某件在哪里、还剩多少、什么时候到期、现在能否使用、发生过什么、我给它留过什么笔记。未知事实要明确显示，不能因自动选择、日期推导或自然语言表达而变成伪造的确定事实。

产品规则和技术接口的完整定义分别见 [Domain model](./domain-model.md) 和 [Architecture](./architecture.md)。实现、发布与验收状态分别记录于 [项目进度](./progress.md)，历史阶段描述不替代当前产品能力。
