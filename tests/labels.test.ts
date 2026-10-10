import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  compactItemId,
  expandItemId,
  itemDate,
  itemLabelURL,
  printLabelBatch,
} from '../apps/web/src/lib/labels.js';
import { labelNameLines, labelQR } from '../apps/web/src/lib/label-renderer.js';
import type { ItemRecord } from '../packages/contracts/src/web.js';

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
