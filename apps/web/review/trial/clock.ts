import { isTrial } from './session';
import { reviewStorage, trialSubmitting } from './storage';
export function trialToday() {
  return isTrial() ? reviewStorage.getItem('trial-clock') || '2026-11-07' : '2026-11-07';
}
export function trialInstant() {
  return `${trialToday()}T14:30:00+08:00`;
}
export function trialDayOffset(days: number) {
  const date = new Date(`${trialToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function setTrialDate(value: string) {
  if (trialSubmitting()) throw Error('任务正在提交，请等待结果后调整时钟。');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw Error('请输入有效日期。');
  reviewStorage.setItem('trial-clock', value);
}

export function dateAtTrialClock<
  T extends import('../../src/ui/patterns/types').DateFactPresentation,
>(fact: T): T {
  if (!isTrial() || !fact.dueOn || fact.state === 'COMPLETED' || fact.state === 'UNKNOWN')
    return fact;
  return {
    ...fact,
    state: fact.dueOn < trialToday() ? 'OVERDUE' : fact.dueOn === trialToday() ? 'DUE' : 'UPCOMING',
  };
}
