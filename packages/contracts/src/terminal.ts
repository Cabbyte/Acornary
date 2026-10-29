import { z } from 'zod';
import { schemas } from './index.js';

export const terminalPrefix = '/api/terminal/v1';
export const terminalCallback = '/android/oauth/callback';
export const terminalCommands = ['open_item', 'consume_item_content', 'consume_items'] as const;
export type TerminalCommand = (typeof terminalCommands)[number];
export function terminalCommand(name: string, input: unknown) {
  if (!terminalCommands.includes(name as TerminalCommand)) return null;
  const parsed = schemas[name as TerminalCommand].parse(input);
  if (name === 'consume_items' && 'item_ids' in parsed && parsed.item_ids.length !== 1)
    throw new Error('Terminal commands require exactly one item.');
  const id = 'item_id' in parsed ? parsed.item_id : parsed.item_ids[0];
  if (parsed.expected_revisions?.[id] === undefined) throw new Error('Item revision required.');
  if (name === 'open_item' && !('opened_at' in parsed && parsed.opened_at))
    throw new Error('Opening time required.');
  return parsed;
}
export interface TerminalItem {
  id: string;
  name: string;
  brand: string;
  specification: string;
  revision: number;
  is_container: boolean;
  terminal: boolean;
  state: string | null;
  opening_state: string | null;
  opened_at: string | null;
  expiry_date: string | null;
  expiry_kind: string | null;
  after_opening_days: number | null;
  remaining: { value: string; unit: string } | null;
  accuracy: string | null;
  reminder: { date?: string; basis: string[] };
  location_ids: string[];
  location: string;
}
export interface TerminalSnapshot {
  version: 1;
  household: { id: string; name: string; timezone: string };
  synced_at: string;
  items: TerminalItem[];
}
export const historyQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
