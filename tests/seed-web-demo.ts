// Fictional household for the Web preview. Refuses non-isolated or populated databases.
import { initialize } from '../apps/server/src/initialize.js';
import { execute } from '../apps/server/src/service.js';
import { pool, query } from '../apps/server/src/db.js';
import type { Operation } from '../packages/contracts/src/index.js';
if (!process.env.DATABASE_URL?.match(/\/acornary_e2e_\d+$/))
  throw new Error('Isolated demo database required.');
const installation = await initialize();
const ctx = { ...installation, source: 'WEB_DEMO' };
let sequence = 0;
const call = (name: Operation, input: Record<string, unknown>) =>
  execute(ctx, name, { idempotency_key: `web-demo-${++sequence}`, ...input });
const attribute = (template_id: string, values: Record<string, unknown>) => ({
  template_id,
  template_version: 1,
  values,
});
try {
  if ((await query(pool, 'SELECT id FROM items LIMIT 1')).rows.length)
    throw new Error('Demo database must be empty.');
  const category = async (name: string) =>
    (await call('create_catalog_node', { kind: 'GROUP', name })).affected_objects[0].id;
  const food = await category('食品与饮品'),
    daily = await category('日用与清洁'),
    clothes = await category('衣物'),
    equipment = await category('设备与配件');
  const product = async (
    name: string,
    parent_id: string,
    values: Record<string, unknown>,
    extra: unknown[] = [],
  ) =>
    (
      await call('create_catalog_node', {
        kind: 'SKU',
        name,
        parent_id,
        initial_attributes: [attribute('product', values), ...extra],
      })
    ).affected_objects[0].id;
  const milk = await product('蒙牛鲜牛奶', food, {
    brand: '蒙牛',
    specification: '1 L / 瓶',
    net_content: { value: '1000', unit: 'mL' },
    storage: { requirement: 'REFRIGERATED' },
  });
  const detergent = await product('洗衣液', daily, { specification: '1 L / 瓶' });
  const shirt = await product('棉质短袖 T 恤', clothes, {}, [
    attribute('clothing', { material: '棉', size: 'M', color: '暖白' }),
  ]);
  const hub = await product('USB-C 扩展坞', equipment, {}, [
    attribute('device', { connector: 'USB-C', rated_power_w: '100' }),
  ]);
  const rice = await product('东北大米', food, {
    specification: '5 kg / 袋',
    storage: { requirement: 'AMBIENT' },
  });
  const place = async (display_name: string, parent_id: string | null = null) =>
    (
      await call('create_items', {
        catalog_node_id: installation.container_catalog_id,
        count: 1,
        display_name,
        parent_id,
        initial_attributes: [attribute('container', { can_contain: true })],
      })
    ).affected_objects[0].id;
  const kitchen = await place('厨房'),
    dining = await place('餐厅'),
    bedroom = await place('卧室'),
    study = await place('书房'),
    balcony = await place('阳台');
  const fridge = await place('冰箱冷藏层', kitchen),
    smallFridge = await place('小冰箱', dining),
    wardrobe = await place('衣柜', bedroom),
    box = await place('旅行收纳箱', wardrobe),
    desk = await place('书桌', study),
    cabinet = await place('家务柜', balcony),
    riceBox = await place('米箱', kitchen);
  const milkIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const result = await call('create_items', {
      catalog_node_id: milk,
      count: 1,
      display_name: `牛奶 · 第 ${i + 1} 瓶`,
      parent_id: i < 4 ? fridge : smallFridge,
      initial_attributes: [
        attribute('contents', { remaining: { value: '1000', unit: 'mL' }, accuracy: 'MEASURED' }),
        attribute('lifecycle', {
          state: 'ACTIVE',
          expiry: { date: `2026-10-0${i + 2}`, date_kind: 'USE_BY' },
          ...(i === 3 ? {} : { opening: { state: 'SEALED' } }),
        }),
      ],
    });
    milkIds.push(result.affected_objects[0].id);
  }
  const first = milkIds[0];
  await call('open_item', {
    item_id: first,
    expected_revisions: { [first]: 1 },
    opened_at: '2026-09-28T00:30:00.000Z',
  });
  await call('consume_item_content', {
    item_id: first,
    expected_revisions: { [first]: 2 },
    amount: { value: '500', unit: 'mL' },
    accuracy: 'ESTIMATED',
  });
  await call('add_note', {
    item_id: first,
    expected_revisions: { [first]: 3 },
    title: '先用这一瓶',
    body: '早餐已经用了一半，放在冰箱门边。剩余量是估计值。',
  });
  await call('create_items', {
    catalog_node_id: detergent,
    count: 1,
    parent_id: cabinet,
    initial_attributes: [
      attribute('contents', { remaining: { value: '650', unit: 'mL' }, accuracy: 'ESTIMATED' }),
      attribute('lifecycle', { state: 'ACTIVE', opening: { state: 'OPENED' } }),
    ],
  });
  await call('create_items', {
    catalog_node_id: shirt,
    count: 1,
    parent_id: wardrobe,
    initial_attributes: [
      attribute('lifecycle', { state: 'ACTIVE', condition: 'GOOD', availability: 'AVAILABLE' }),
    ],
  });
  await call('create_items', {
    catalog_node_id: shirt,
    count: 1,
    parent_id: box,
    initial_attributes: [attribute('lifecycle', { state: 'ACTIVE', condition: 'NEW' })],
  });
  await call('create_items', {
    catalog_node_id: hub,
    count: 1,
    parent_id: box,
    initial_attributes: [attribute('lifecycle', { state: 'ACTIVE', condition: 'GOOD' })],
  });
  await call('create_items', {
    catalog_node_id: rice,
    count: 1,
    parent_id: riceBox,
    initial_attributes: [
      attribute('contents', { remaining: { value: '1200', unit: 'g' }, accuracy: 'MEASURED' }),
      attribute('lifecycle', { state: 'ACTIVE', opening: { state: 'OPENED' } }),
    ],
  });
  console.log(
    JSON.stringify({
      preview: '/items',
      milk: `/items/group/${milk}`,
      item: `/items/${first}`,
      container: `/places/${box}`,
      study: desk,
    }),
  );
} finally {
  await pool.end();
}
