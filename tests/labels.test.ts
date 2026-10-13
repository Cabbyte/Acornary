import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  compactItemId,
  expandItemId,
  itemDate,
  itemLabelContent,
  itemLabelURL,
  printLabelBatch,
} from '../apps/web/src/lib/labels.js';
import { LABEL_PROFILES } from '../apps/web/src/lib/label-profiles.js';
import { labelNameLines, labelQR, renderLabel } from '../apps/web/src/lib/label-renderer.js';
import type { ItemRecord, InventoryData } from '../packages/contracts/src/web.js';

describe('physical item labels', () => {
  it('keeps each UUID distinct and reversible without leaking a credential', () => {
    const ids = Array.from({ length: 100 }, () => `item_${randomUUID()}`);
    expect(new Set(ids.map(compactItemId)).size).toBe(100);
    for (const id of ids) {
      const compact = compactItemId(id);
      expect(compact).toHaveLength(22);
      expect(expandItemId(compact)).toBe(id);
      expect(itemLabelURL(id, 'https://acornary.protium.top')).toBe(
        `https://acornary.protium.top/i/${compact}`,
      );
    }
    expect(() => compactItemId('catalog_node_' + randomUUID())).toThrow();
  });
  it('rejects malformed, noncanonical and invalid UUID short links', () => {
    for (const value of [
      '../items',
      '',
      'A'.repeat(22),
      '_'.repeat(22),
      '<script>',
      'x'.repeat(23),
    ])
      expect(expandItemId(value)).toBeUndefined();
    const code = compactItemId('item_11111111-1111-4111-8111-000000000001');
    expect(expandItemId(code.slice(0, -1) + 'R')).toBeUndefined();
  });
  it('fits the production URL at two dots per module with four modules of quiet zone', () => {
    const url = itemLabelURL(
      'item_11111111-1111-4111-8111-000000000001',
      'https://acornary.protium.top',
    );
    const { size, quiet, scale, qr } = labelQR(url);
    expect(quiet).toBe(4);
    expect(scale).toBe(2);
    expect(qr.version).toBe(4);
    expect(size).toBe(82);
    expect(() => labelQR('https://' + 'x'.repeat(150) + '.example/i/test')).toThrow('过长');
  });
  it('keeps date semantics explicit and does not mutate old or unknown dates', () => {
    const record = (expiry?: object) =>
      ({
        attributes: expiry
          ? [{ template_id: 'lifecycle', template_version: 1, values: { expiry } }]
          : [],
      }) as unknown as ItemRecord;
    expect(itemDate(record()).text).toBe('日期未记录');
    const old = record({ date: '2026-10-12' });
    expect(itemDate(old)).toEqual({ title: '到期日期', date: '2026-10-12', text: '2026-10-12' });
    expect(itemDate(record({ date: '2026-10-12', date_kind: 'ESTIMATED' })).title).toBe('计划吃完');
    expect(itemDate(record({ date_kind: 'USE_BY' })).title).toBe('保质期');
    expect(itemDate(record({ date_kind: 'BEST_BEFORE' })).title).toBe('最佳食用期');
    expect(old.attributes[0].values).toEqual({ expiry: { date: '2026-10-12' } });
  });
  it('wraps Chinese names in two measured lines, without splitting emoji', () => {
    const measure = (s: string) => Array.from(s).length * 16;
    expect(labelNameLines('冷藏米饭', measure, 140)).toEqual(['冷藏米饭']);
    const lines = labelNameLines('🍎'.repeat(30), measure, 140);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('🍎'.repeat(7) + '…');
    expect(lines.every((s) => measure(s) <= 140)).toBe(true);
  });
  it('stops on an uncertain sheet and never retries it or sends the remaining sheets', async () => {
    const print = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disconnect'));
    const events: string[] = [];
    await expect(
      printLabelBatch(
        ['a', 'b', 'c'].map((id) => ({ id, image: id })),
        { print },
        new AbortController().signal,
        (id, status) => events.push(`${id}:${status}`),
      ),
    ).rejects.toThrow('disconnect');
    expect(print.mock.calls).toEqual([['a'], ['b']]);
    expect(events).toEqual(['a:printing', 'a:done', 'b:printing', 'b:uncertain']);
  });
  it('finishes only the in-flight sheet when the user stops the batch', async () => {
    const abort = new AbortController();
    const print = vi.fn(async () => {
      abort.abort();
    });
    const events: string[] = [];
    await printLabelBatch(
      ['a', 'b'].map((id) => ({ id, image: id })),
      { print },
      abort.signal,
      (id, status) => events.push(`${id}:${status}`),
    );
    expect(print).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['a:printing', 'a:done']);
  });
  it('does not send anything for a cancelled session', async () => {
    const abort = new AbortController();
    abort.abort();
    const print = vi.fn();
    await printLabelBatch([{ id: 'a', image: 'a' }], { print }, abort.signal, vi.fn());
    expect(print).not.toHaveBeenCalled();
  });
});

it('lays out both sizes with integer QR dots, quiet zones and no text overlap', () => {
  const url = itemLabelURL(
    'item_11111111-1111-4111-8111-000000000001',
    'https://acornary.protium.top',
  );
  for (const profile of Object.values(LABEL_PROFILES)) {
    const { size, quiet, scale } = labelQR(url, profile);
    expect(Number.isInteger(scale)).toBe(true);
    expect(quiet).toBe(4);
    expect(profile.margin + profile.textWidth).toBeLessThan(profile.width - size - profile.margin);
    expect(size).toBeLessThan(profile.height);
    expect(profile.dateTop + profile.dateFont).toBeLessThan(profile.height);
  }
  expect(labelQR(url, LABEL_PROFILES['40x20']).size).toBe(123);
});

it('uses recorded specifications and a validated UUID suffix without changing identity', () => {
  const item = {
    id: 'item_11111111-1111-4111-8111-000000a5c92e',
    catalog_node_id: 'sku',
    attributes: [],
  } as unknown as ItemRecord;
  const data = {
    items: [item],
    catalog: [
      {
        id: 'sku',
        name: '冷萃乌龙茶',
        attributes: [
          {
            template_id: 'product',
            template_version: 1,
            values: { specification: '500 mL · 无糖' },
          },
        ],
      },
    ],
  } as unknown as InventoryData;
  expect(itemLabelContent(item, data)).toEqual({
    name: '冷萃乌龙茶',
    specification: '500 mL · 无糖',
    title: '到期日期',
    date: undefined,
    suffix: 'a5c92e',
  });
  expect(itemLabelContent(item, { ...data, catalog: [] }).specification).toBe('');
});
it('truncates specifications at the fixed line limit and preserves grapheme clusters', () => {
  const measure = (s: string) =>
    [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length * 16;
  for (const profile of Object.values(LABEL_PROFILES)) {
    const lines = labelNameLines('👨‍👩‍👧‍👦'.repeat(40), measure, profile.textWidth, profile.specLines);
    expect(lines).toHaveLength(profile.specLines);
    expect(lines.at(-1)).toMatch(/…$/);
    expect(lines.every((line) => measure(line) <= profile.textWidth)).toBe(true);
    expect(lines.join('').replaceAll('👨‍👩‍👧‍👦', '').replaceAll('…', '')).toBe('');
    expect(profile.specTop + profile.specLine * profile.specLines).toBeLessThan(
      profile.dateTitleTop,
    );
    expect(profile.qrTop + profile.qrMax).toBeLessThan(profile.suffixTop);
    expect(profile.suffixTop + profile.suffixFont).toBeLessThanOrEqual(profile.height);
  }
});
it('prints no placeholder or date title when date and specifications are absent', () => {
  const fillText = vi.fn();
  const ctx = {
    fillText,
    fillRect: vi.fn(),
    measureText: (s: string) => ({ width: s.length * 8 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  try {
    for (const profile of Object.values(LABEL_PROFILES)) {
      fillText.mockClear();
      renderLabel(
        { name: '电源适配器', specification: '', title: '计划吃完', suffix: '3ba71f' },
        itemLabelURL('item_11111111-1111-4111-8111-0000003ba71f', 'https://acornary.protium.top'),
        profile,
      );
      expect(fillText.mock.calls.map((c) => c[0])).toEqual(['电源适配器', '3ba71f']);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
