import type { DateFact } from '../../../../../../packages/contracts/src/read-v2.js';
import type { DateFactView } from '../model/types.js';

export type OpenDateState = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'UNKNOWN';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateParts = (value: string): [number, number, number] | null => {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  )
    return null;
  return [year, month, day];
};

const todayIn = (timezone: string, now: Date): string | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
};

export function dateState(dueOn: string, timezone: string, now: Date = new Date()): OpenDateState {
  if (!dateParts(dueOn)) return 'UNKNOWN';
  const today = todayIn(timezone, now);
  if (!today) return 'UNKNOWN';
  if (dueOn < today) return 'OVERDUE';
  if (dueOn > today) return 'UPCOMING';
  return 'DUE';
}

export function reminderToFacts(
  reminder: { date?: string; basis: string[] } | null | undefined,
  timezone: string,
  now: Date = new Date(),
): DateFactView[] {
  const dueOn = reminder?.date;
  if (typeof dueOn !== 'string' || !dateParts(dueOn)) return [];
  const basis = Array.isArray(reminder?.basis)
    ? reminder.basis.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const opening = basis.some((entry) => entry.startsWith('lifecycle.opening'));
  const expiry = basis.some((entry) => entry.startsWith('lifecycle.expiry'));
  const isOpening = opening && !expiry;
  const label = opening && expiry ? '到期' : isOpening ? '开封后期限' : '保质期';
  return [
    {
      key: isOpening ? 'lifecycle.opening' : 'lifecycle.expiry',
      source: 'LIFECYCLE',
      kind: 'EXPIRY',
      dueOn,
      basis: basis.length ? basis.join('；') : null,
      state: dateState(dueOn, timezone, now),
      completedOn: null,
      label,
    },
  ];
}

export function nextDateFact(next: DateFact | null | undefined): DateFactView | null {
  if (!next || typeof next.due_on !== 'string' || !dateParts(next.due_on)) return null;
  return {
    key: next.key,
    source: next.source,
    kind: next.kind,
    dueOn: next.due_on,
    basis: next.basis ?? null,
    state: next.state,
    completedOn: next.completed_on ?? null,
    label: next.label,
  };
}
