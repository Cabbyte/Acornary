import { test, expect, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:3212';
const view = (page: Page) => page.frameLocator('#inventory');
async function fixture(page: Page, dialog = '') {
  await page.goto(origin);
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const f = await page.evaluate(async () => {
    const h = (window as any).host;
    const call = (name: string, args: any) =>
      h.call(name, { idempotency_key: crypto.randomUUID(), ...args });
    const name = '插件验收 ' + crypto.randomUUID().slice(0, 6);
    const sku = (await call('create_catalog_node', { kind: 'SKU', name })).structuredContent
      .affected_objects[0].id;
    const container = h.initial._meta['acornary/view'].snapshot.container_catalog_id;
    const place = (
      await call('create_items', {
        catalog_node_id: container,
        count: 1,
        display_name: name + '书房',
        initial_attributes: [
          { template_id: 'container', template_version: 1, values: { can_contain: true } },
        ],
      })
    ).structuredContent.affected_objects[0].id;
    const id = (
      await call('create_items', {
        catalog_node_id: sku,
        count: 1,
        display_name: name,
        initial_attributes: [
          {
            template_id: 'contents',
            template_version: 1,
            values: { remaining: { value: '1000', unit: 'mL' }, accuracy: 'MEASURED' },
          },
        ],
      })
    ).structuredContent.affected_objects[0].id;
    return { id, sku, place, name };
  });
  await page.evaluate(
    async ({ f, dialog }) => {
      const h = (window as any).host;
      h.saved = {
        privateContent: {
          acornary: {
            version: 1,
            scope: h.initial._meta['acornary/view'].session.cache_key,
            records: {},
            route: `/items/${f.id}${dialog ? '?dialog=' + dialog + '&target=' + f.id : ''}`,
          },
        },
      };
      await h.mount();
    },
    { f, dialog },
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.id))
    .toBe(f.id);
  return f;
}
const writes = (page: Page) =>
  page.evaluate(() =>
    (window as any).host.calls
      .filter((c: any) => c.name === 'apply_inventory_command')
      .map((c: any) => ({ name: c.name, arguments: c.arguments })),
  );

async function restoreRoute(page: Page, route: string) {
  await page.evaluate(async (route) => {
    const h = (window as any).host;
    h.saved = {
      privateContent: {
        acornary: {
          version: 1,
          scope: h.initial._meta['acornary/view'].session.cache_key,
          records: {},
          route,
        },
      },
    };
    await h.mount();
  }, route);
}

test('a late opener notification cannot invalidate the authoritative startup fallback', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as any).host;
    const notify = h.notify.bind(h);
    const rpc = h.rpc.bind(h);
    h.notify = (result: any) => {
      h.pendingInitial = result;
    };
    h.calls = [];
    h.rpc = async (method: string, params: any) => {
      const result = await rpc(method, params);
      if (method === 'tools/call' && params.name === 'get_inventory_view') {
        // Deliver the delayed opener while the fallback RPC is outstanding.
        notify(h.pendingInitial);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return result;
    };
    await h.mount();
  });
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  await expect(view(page).getByText(/无法连接库存/)).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).host.calls.filter((c: any) => c.name === 'get_inventory_view'),
    ),
  ).toHaveLength(1);
  await page.screenshot({ path: 'output/playwright/plugin-late-opener-startup.png' });
});

test('sandbox resource, shared UI, selection, actual conversational move and missing/duplicate notifications', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const f = await fixture(page);
  expect(await page.evaluate(() => (window as any).host.mode)).toBe('fullscreen');
  const frame = page.frames().find((f) => f.parentFrame());
  expect(
    await frame!.evaluate(() => {
      try {
        localStorage.getItem('a');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await page.screenshot({ path: 'output/playwright/plugin-selected-1440.png' });
  await page.evaluate(async (f) => {
    const h = (window as any).host,
      selection = h.context.selection;
    h.moved = await h.call('move_item', {
      item_id: selection.id,
      parent_id: f.place,
      expected_revisions: { [selection.id]: selection.revision },
      idempotency_key: crypto.randomUUID(),
    });
    h.notify(h.moved);
    h.notify(h.initial);
    h.notify(h.moved);
  }, f);
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.revision))
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.location))
    .toContain('书房');
  // Deliberately drop the next notification: visible polling must still see the committed state.
  await page.evaluate(async (f) => {
    const h = (window as any).host;
    await h.call('update_item', {
      item_id: f.id,
      display_name: '没有通知也会刷新',
      expected_revisions: { [f.id]: 2 },
      idempotency_key: crypto.randomUUID(),
    });
  }, f);
  await expect(
    view(page).getByRole('heading', { name: '没有通知也会刷新', exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await view(page).getByRole('link', { name: '我的物品', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).host.context?.selection)).toBeNull();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).host.sizes.length)).toBeGreaterThan(0);
});

test('workbench search, query inspector and atomic editing share the sandbox model context', async ({
  page,
}) => {
  const f = await fixture(page);
  await view(page).getByRole('link', { name: '我的物品', exact: true }).click();
  const search = view(page).getByRole('searchbox', { name: '搜索物品、位置、规格…' });
  await search.fill(f.name);
  await search.press('Enter');
  await view(page).getByRole('button', { name: f.name, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.id))
    .toBe(f.id);
  await view(page).getByRole('button', { name: '编辑', exact: true }).click();
  await view(page)
    .getByRole('dialog')
    .getByLabel('名称', { exact: true })
    .fill(f.name + '已核对');
  await view(page)
    .getByRole('dialog')
    .getByLabel('备注', { exact: true })
    .fill('工作台原子保存的备注');
  await view(page).getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(view(page).getByRole('dialog')).toHaveCount(0);
  await expect(
    view(page).getByRole('heading', { name: f.name + '已核对', exact: true }),
  ).toBeVisible();
  await expect(view(page).locator('.wb-inspector')).toContainText('工作台原子保存的备注');
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.revision))
    .toBe(2);
  const commands = await writes(page);
  expect(commands).toHaveLength(1);
  expect(commands[0].arguments.operation).toBe('edit_item');
  expect(
    await view(page)
      .locator('img')
      .evaluateAll((images) =>
        (images as HTMLImageElement[]).every(
          (image) => image.complete && image.naturalWidth > 0 && image.src.startsWith('data:'),
        ),
      ),
  ).toBe(true);
});

test('lost write response restores the exact request after sandbox remount and commits only once', async ({
  page,
}) => {
  const f = await fixture(page, 'rename');
  await view(page).getByLabel('名称', { exact: true }).fill('恢复同一次请求');
  await page.evaluate(() => {
    (window as any).host.loseWrite = true;
  });
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByRole('button', { name: '重试同一次操作' })).toBeVisible();
  const first = (await writes(page))[0];
  await page.evaluate(() => (window as any).host.mount());
  await expect(view(page).getByRole('button', { name: '重试同一次操作' })).toBeVisible();
  await view(page).getByRole('button', { name: '重试同一次操作' }).click();
  await expect(view(page).getByRole('dialog')).toHaveCount(0);
  expect((await writes(page))[1]).toEqual(first);
  const item: any = await page.evaluate(
    async (id) => (await (window as any).host.call('get_item', { item_id: id })).structuredContent,
    f.id,
  );
  expect(item.revision).toBe(2);
  await page.screenshot({ path: 'output/playwright/plugin-recovered-write.png' });
});

test('committed result survives refresh failure and remount without replaying the write', async ({
  page,
}) => {
  await fixture(page, 'rename');
  await view(page).getByLabel('名称', { exact: true }).fill('已提交结果恢复');
  await page.evaluate(() => {
    (window as any).host.failReadsAfterWrite = 20;
  });
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByRole('button', { name: '刷新查看结果' })).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as any).host;
    h.failReads = 0;
    await h.mount();
  });
  await expect(view(page).getByRole('button', { name: '刷新查看结果' })).toBeVisible();
  await view(page).getByRole('button', { name: '刷新查看结果' }).click();
  await expect(view(page).getByRole('dialog')).toHaveCount(0);
  expect(await writes(page)).toHaveLength(1);
});

test('unconfirmed host persistence blocks dispatch in an opaque sandbox', async ({ page }) => {
  await fixture(page, 'rename');
  await page.evaluate(async () => {
    const h = (window as any).host;
    h.storage = 'drop';
    await h.mount();
  });
  await view(page).getByLabel('名称', { exact: true }).fill('这笔不能发送');
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByText('宿主尚未确认草稿保存，本次修改尚未发送。')).toBeVisible();
  expect(await writes(page)).toHaveLength(0);
  await page.screenshot({ path: 'output/playwright/plugin-storage-unavailable.png' });
});

test('authoritative refresh preserves an open draft and detects a real revision conflict', async ({
  page,
}) => {
  const f = await fixture(page, 'rename');
  await view(page).getByLabel('名称', { exact: true }).fill('保留我的草稿');
  await page.evaluate(async (f) => {
    const h = (window as any).host;
    h.notify(
      await h.call('update_item', {
        item_id: f.id,
        display_name: '外部新名称',
        expected_revisions: { [f.id]: 1 },
        idempotency_key: crypto.randomUUID(),
      }),
    );
  }, f);
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.revision))
    .toBe(2);
  await expect(view(page).getByLabel('名称', { exact: true })).toHaveValue('保留我的草稿');
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByText('记录已发生变化。请核对最新内容后重新提交。')).toBeVisible();
  await expect(view(page).getByRole('button', { name: '已核对，保留我的输入' })).toBeVisible();
  expect(await writes(page)).toHaveLength(1);
  await page.screenshot({ path: 'output/playwright/plugin-revision-conflict.png' });
});

test('read-only UI and revoked authorization do not dispatch changes and clear selection', async ({
  page,
}) => {
  await fixture(page, 'rename');
  await page.evaluate(async () => {
    const h = (window as any).host;
    h.readonly = true;
    await h.mount();
  });
  await expect(view(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(await writes(page)).toHaveLength(0);
  await page.evaluate(() => {
    const h = (window as any).host;
    h.expired = true;
    h.notify({ content: [] });
  });
  await expect(view(page).getByText(/连接授权已失效/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).host.context?.selection)).toBeNull();
});

test('switching the backend household clears old inventory, selection and private draft scope', async ({
  page,
}) => {
  const f = await fixture(page, 'rename');
  await view(page).getByLabel('名称', { exact: true }).fill('第一家庭的私有草稿');
  await page.evaluate(() => {
    const h = (window as any).host;
    h.family = 1;
    h.notify({ content: [] });
  });
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  await expect(view(page).getByText(f.name, { exact: true })).toHaveCount(0);
  await expect(view(page).getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).host.context?.selection)).toBeNull();
  expect(await writes(page)).toHaveLength(0);
});

test('narrow shared UI has no overflow and untrusted sibling messages cannot replace host data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page);
  await page.evaluate(() => {
    const h = (window as any).host;
    const sibling = document.createElement('iframe');
    document.body.append(sibling);
    (sibling.contentWindow as any).eval(
      `parent.host.frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{_meta:{'acornary/view':{version:1}}}},'*')`,
    );
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection?.id))
    .toBe(f.id);
  const frame = page.frames().find((f) => f.parentFrame() && f.url() === 'about:srcdoc')!;
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/plugin-selected-390.png' });
});

test('failed context clearing retries after authorization loss without further user input', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const h = (window as any).host;
    h.failContext = 2;
    h.expired = true;
    h.notify({ content: [] });
  });
  await expect(view(page).getByText(/连接授权已失效/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).host.context?.selection), { timeout: 10000 })
    .toBeNull();
  expect(await page.evaluate(() => (window as any).host.failContext)).toBe(0);
});

test('failure to persist a committed result still restores the original idempotent request', async ({
  page,
}) => {
  const f = await fixture(page, 'rename');
  await page.evaluate(async () => {
    const h = (window as any).host;
    h.storage = 'commit-fail';
    await h.mount();
  });
  await view(page).getByLabel('名称', { exact: true }).fill('结果保存失败仍不重复');
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByRole('button', { name: '刷新查看结果' })).toBeVisible();
  const first = (await writes(page))[0];
  await page.evaluate(async () => {
    const h = (window as any).host;
    h.storage = 'ok';
    await h.mount();
  });
  await expect(view(page).getByRole('button', { name: '重试同一次操作' })).toBeVisible();
  await view(page).getByRole('button', { name: '重试同一次操作' }).click();
  await expect(view(page).getByRole('dialog')).toHaveCount(0);
  expect((await writes(page))[1]).toEqual(first);
  expect(
    await page.evaluate(
      async (id) =>
        (await (window as any).host.call('get_item', { item_id: id })).structuredContent.revision,
      f.id,
    ),
  ).toBe(2);
});

test('Chinese composition Enter does not submit, while ordinary Enter preserves keyboard saving', async ({
  page,
}) => {
  const f = await fixture(page, 'rename');
  const input = view(page).getByLabel('名称', { exact: true });
  await input.fill('输入法确认后的名称');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    keyCode: 13,
  });
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: false,
    keyCode: 229,
  });
  await expect(input).toHaveValue('输入法确认后的名称');
  expect(await writes(page)).toHaveLength(0);
  await input.press('Enter');
  // Wide layouts use an editor page, so no dialog exists even before the write completes.
  await expect(input).toHaveCount(0);
  expect(await writes(page)).toHaveLength(1);
  expect(
    await page.evaluate(
      async (id) =>
        (await (window as any).host.call('get_item', { item_id: id })).structuredContent.revision,
      f.id,
    ),
  ).toBe(2);
});

test('a definite barcode rejection remains editable after remount and a corrected request succeeds', async ({
  page,
}) => {
  const f = await fixture(page);
  const barcode = 'PLUGIN-REJECTION-' + f.sku;
  const owner = await page.evaluate(async (barcode) => {
    const result = await (window as any).host.call('create_catalog_node', {
      kind: 'SKU',
      name: '条码已有归属',
      initial_attributes: [
        { template_id: 'product', template_version: 1, values: { barcodes: [barcode] } },
      ],
      idempotency_key: crypto.randomUUID(),
    });
    return result.structuredContent.affected_objects[0].id;
  }, barcode);
  await restoreRoute(page, `/catalog/${f.sku}?dialog=attributes&template=product&target=${f.sku}`);
  await view(page).getByLabel('商品条码', { exact: true }).fill(barcode);
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByText('该条码已被其他商品使用。')).toBeVisible();
  await expect(view(page).getByLabel('商品条码', { exact: true })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values((window as any).host.saved.privateContent.acornary.records).some(
          (d: any) => d.attempt,
        ),
      ),
    )
    .toBe(false);
  const rejected = await page.evaluate(
    async (id) =>
      (await (window as any).host.call('get_catalog_node', { catalog_node_id: id }))
        .structuredContent,
    f.sku,
  );
  expect(rejected.revision).toBe(1);
  expect(rejected.attributes).toEqual([]);
  await page.screenshot({ path: 'output/playwright/plugin-business-rejection-editable.png' });
  await page.evaluate(() => (window as any).host.mount());
  await expect(view(page).getByLabel('商品条码', { exact: true })).toBeEnabled();
  await expect(view(page).getByLabel('商品条码', { exact: true })).toHaveValue(barcode);
  await view(page)
    .getByLabel('商品条码', { exact: true })
    .fill(barcode + '-CORRECTED');
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(view(page).getByRole('dialog')).toHaveCount(0);
  const attempts = await writes(page);
  expect(attempts).toHaveLength(2);
  expect(attempts[0].arguments.expected_scope).toBe(attempts[1].arguments.expected_scope);
  expect(attempts[0].arguments.input.idempotency_key).not.toBe(
    attempts[1].arguments.input.idempotency_key,
  );
  expect(attempts[1].arguments.input.values.barcodes).toEqual([barcode + '-CORRECTED']);
  const final = await page.evaluate(
    async ({ id, owner }) => {
      const h = (window as any).host;
      return {
        edited: (await h.call('get_catalog_node', { catalog_node_id: id })).structuredContent,
        owner: (await h.call('get_catalog_node', { catalog_node_id: owner })).structuredContent,
        history: (await h.call('get_history', { target: { kind: 'CATALOG_NODE', id } }))
          .structuredContent,
      };
    },
    { id: f.sku, owner },
  );
  expect(final.edited.revision).toBe(2);
  expect(
    final.edited.attributes.find((a: any) => a.template_id === 'product').values.barcodes,
  ).toEqual([barcode + '-CORRECTED']);
  expect(final.owner.revision).toBe(1);
  expect(final.history.data.filter((e: any) => e.event_type === 'ATTRIBUTE_BIND')).toHaveLength(1);
});

test('host credential switching at dispatch rejects the old UI command before any write', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  await restoreRoute(page, '/catalog/manage?dialog=catalog');
  const name = '禁止跨家庭误写-' + Date.now();
  await view(page).getByLabel('名称', { exact: true }).fill(name);
  await expect(view(page).getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const h = (window as any).host;
    const rpc = h.rpc.bind(h);
    h.uiWriteResults = [];
    h.rpc = async (method: string, params: any) => {
      if (method === 'tools/call' && params.name === 'apply_inventory_command') h.family = 1;
      const result = await rpc(method, params);
      if (params.name === 'apply_inventory_command') h.uiWriteResults.push(result);
      return result;
    };
  });
  await view(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).host.uiWriteResults.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).host.uiWriteResults[0])).toMatchObject({
    isError: true,
    structuredContent: { error: { code: 'SESSION_CHANGED' } },
  });
  const attempted = await writes(page);
  expect(attempted).toHaveLength(1);
  expect(attempted[0].arguments.expected_scope).toBe(
    await page.evaluate(
      () => (window as any).host.initial._meta['acornary/view'].session.cache_key,
    ),
  );
  const counts = await page.evaluate(async (name) => {
    const h = (window as any).host;
    // Explicit RPC family arguments avoid changing the UI's host connection during verification.
    const catalog = async (family: number) => {
      const response = await fetch('/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          family,
          method: 'tools/call',
          params: { name: 'get_inventory_view', arguments: {} },
        }),
      });
      return (await response.json())._meta['acornary/view'].snapshot.catalog.filter(
        (c: any) => c.name === name,
      );
    };
    return { a: await catalog(0), b: await catalog(1) };
  }, name);
  expect(counts).toEqual({ a: [], b: [] });
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  expect(await writes(page)).toHaveLength(1);
  await page.screenshot({ path: 'output/playwright/plugin-cross-family-write-blocked.png' });
});

test('late authorization errors from cancelled history cannot expire the new household', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.evaluate(() => {
    const h = (window as any).host;
    const rpc = h.rpc.bind(h);
    h.rpc = (method: string, params: any) => {
      if (method === 'tools/call' && params.name === 'get_history' && !h.historyBlocked) {
        h.historyBlocked = true;
        return new Promise((resolve) => {
          h.releaseOld = () =>
            resolve({
              isError: true,
              content: [{ type: 'text', text: 'UNAUTHORIZED' }],
              structuredContent: {
                error: { code: 'UNAUTHORIZED', message: 'Old credential expired' },
              },
            });
        });
      }
      return rpc(method, params);
    };
  });
  await restoreRoute(page, `/catalog/${f.sku}/history`);
  await expect.poll(() => page.evaluate(() => !!(window as any).host.releaseOld)).toBe(true);
  await page.evaluate(() => {
    const h = (window as any).host;
    h.family = 1;
    h.notify({ content: [] });
  });
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const readsBefore = await page.evaluate(
    () => (window as any).host.calls.filter((c: any) => c.name === 'get_inventory_view').length,
  );
  await page.evaluate(() => {
    const h = (window as any).host;
    h.releaseOld();
    h.notify({ content: [] });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).host.calls.filter((c: any) => c.name === 'get_inventory_view').length,
      ),
    )
    .toBeGreaterThan(readsBefore);
  await expect(view(page).getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  await expect(view(page).getByText(/连接授权已失效/)).toHaveCount(0);
  expect(await writes(page)).toHaveLength(0);
  expect(
    await page.evaluate(
      async () => !(await (window as any).host.call('get_inventory_view')).isError,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'output/playwright/plugin-late-auth-new-session-active.png' });
});
