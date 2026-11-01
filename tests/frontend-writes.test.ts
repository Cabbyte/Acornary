import { describe, expect, it } from 'vitest';
import { validateWorkspaceSearch } from '../apps/web/src/app/search.js';
import { parseWriteCommand } from '../apps/web/src/features/writes/note-command.js';
import { draftSchema } from '../apps/web/src/lib/draft.js';
import { supportsCapability } from '../apps/web/src/features/writes/selectors.js';

const item = 'item_11111111-1111-4111-8111-111111111111';
const note = 'note_22222222-2222-4222-8222-222222222222';
const base = {
  expected_revisions: { [item]: 4 },
  idempotency_key: 'retained-attempt',
  body: 'A note',
};
describe('production write compatibility', () => {
  it('preserves v1 note payloads and only uses target-shaped writes for notes_v2', () => {
    const legacy = parseWriteCommand('add_note', { ...base, item_id: item });
    expect(legacy.success && legacy.data).toEqual({ ...base, item_id: item });
    const next = { ...base, target: { kind: 'ITEM', id: item } };
    expect(parseWriteCommand('add_note', next).success).toBe(false);
    expect(parseWriteCommand('add_note', next, true).success).toBe(true);
    expect(
      parseWriteCommand('update_note', { ...base, note_id: note, title: null }, true).success,
    ).toBe(true);
  });
  it('restores both note command generations without mutating the original attempt', () => {
    for (const payload of [
      { ...base, item_id: item },
      { ...base, target: { kind: 'ITEM', id: item } },
    ]) {
      const draft = {
        values: { body: 'A note' },
        original: { body: '' },
        revisions: { [item]: 4 },
        attempt: { operation: 'add_note', payload },
      };
      expect(draftSchema.parse(draft).attempt).toEqual(draft.attempt);
    }
    expect(
      draftSchema.safeParse({
        values: {},
        original: {},
        revisions: {},
        attempt: { operation: 'add_note', payload: { body: 'missing target' } },
      }).success,
    ).toBe(false);
  });
  it('does not infer capability defaults from a profile', () => {
    expect(supportsCapability({ profile: 'CONSUMABLE' }, 'contents', true)).toBe(false);
    expect(supportsCapability({ effective_capabilities: [] }, 'contents', true)).toBe(false);
    expect(supportsCapability({ effective_capabilities: ['contents'] }, 'contents', true)).toBe(
      true,
    );
    expect(supportsCapability({}, 'contents', false)).toBe(true);
  });
});
describe('workspace search boundary', () => {
  it('validates core search while preserving old dialog aliases and dropping cursors', () => {
    expect(
      validateWorkspaceSearch({
        view: 'attention',
        q: '牛奶',
        sort: 'name',
        location: item,
        category: 'category',
        dialog: 'consume',
        target: item,
        cursor: 'opaque',
      }),
    ).toEqual({
      view: 'attention',
      q: '牛奶',
      sort: 'name',
      location: item,
      category: 'category',
      dialog: 'consume',
      target: item,
    });
    const invalid = validateWorkspaceSearch({ ui: 'no', view: 123, sort: 'bad', q: ['a'] });
    expect(invalid.ui).toBeUndefined();
    expect(invalid.q).toBeUndefined();
    expect(invalid.sort).toBeUndefined();
  });
});
