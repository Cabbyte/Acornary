// Synthetic design-review fixtures. This script refuses normal application databases.
import { initialize } from '../apps/server/src/initialize.js';
import { execute } from '../apps/server/src/service.js';
import { pool } from '../apps/server/src/db.js';
if (!process.env.DATABASE_URL?.match(/\/acornary_e2e_\d+$/))
  throw new Error('Isolated E2E database required.');
const installation = await initialize();
const ctx = { ...installation, source: 'WORKBENCH_FIXTURE' };
let seq = 0;
const call = (name: any, input: any) =>
  execute(ctx, name, { idempotency_key: `workbench-fixture-${++seq}`, ...input });
const a = (template_id: string, values: unknown) => ({ template_id, template_version: 1, values });
const place = async (name: string, parent_id: string | null = null) =>
  (
    await call('create_items', {
      catalog_node_id: installation.container_catalog_id,
      display_name: name,
      parent_id,
      count: 1,
      initial_attributes: [a('container', { can_contain: true })],
    })
  ).affected_objects[0].id;
try {
  const home = await place('我的家'),
    study = await place('书房', home),
    cabinet = await place('抽屉柜', study),
    box = await place('电子物品箱', cabinet),
    cables = await place('线材分格', box),
    parts = await place('配件分格', box),
    bag = await place('旅行收纳包', study);
  await place('客厅', home);
  await place('储藏室', home);
  await place('厨房', home);
  await place('书桌', study);
  const samples = [
    ['USB-C 编织线', '2 m · 100 W · 黑色', '桌面设备备用线'],
    ['USB-C 充电线', '1 m · 60 W · 白色', 'iPhone 备用'],
    ['HDMI 线', '2 m · 4K · 黑色', '显示器连接线'],
    ['雷电 4 线', '0.8 m · 40 Gbps · 黑色', 'Mac 外接显示器'],
    ['USB-A 转接头', 'USB-A 转 USB-C · 灰色', ''],
    ['65 W 氮化镓充电器', '65 W · 3 口 · 白色', 'MacBook 充电器'],
    ['30 W 充电器', '30 W · USB-C · 白色', 'iPad 备用'],
    ['多口扩展坞', '7 合 1 · HDMI · USB · 灰色', '出差使用'],
    ['SD 读卡器', 'SD / microSD · USB-C · 灰色', '相机存储卡'],
    ['移动固态硬盘', '1 TB · USB-C · 深灰', '工作资料'],
    ['无线鼠标', '罗技 MX Anywhere 3 · 灰色', ''],
    ['键盘接收器', 'Logi Bolt · USB-A · 黑色', '键盘备用接收器'],
    ['相机电池', 'LP-E6NH · 黑色', '佳能 R6 电池'],
    ['电池充电座', 'LP-E6 · 双槽 · 黑色', ''],
    ['魔术扎带', '3 m · 黑色', '整理线材'],
    ['清洁布', '超细纤维 · 灰色', '镜头 / 屏幕清洁'],
    ['网线', '2 m · Cat6 · 蓝色', ''],
    ['收纳袋', '网格收纳袋 · 中号 · 黑色', '出差收纳'],
  ];
  const group = (await call('create_catalog_node', { kind: 'GROUP', name: '电子配件' }))
    .affected_objects[0].id;
  for (const [index, [name, spec, note]] of samples.entries()) {
    const sku = (
      await call('create_catalog_node', {
        kind: 'SKU',
        name,
        parent_id: group,
        initial_attributes: [a('product', { specification: spec })],
      })
    ).affected_objects[0].id;
    const item = (
      await call('create_items', {
        catalog_node_id: sku,
        count: 1,
        parent_id: index < 4 ? cables : parts,
        initial_attributes:
          index === 16
            ? []
            : [a('lifecycle', { availability: index % 3 === 0 ? 'IN_USE' : 'AVAILABLE' })],
      })
    ).affected_objects[0].id;
    if (note)
      await call('add_note', { item_id: item, body: note, expected_revisions: { [item]: 1 } });
  }
  console.log(JSON.stringify({ box, bag, cables, parts }));
} finally {
  await pool.end();
}
