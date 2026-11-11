// Private review projection; no production controller imports fixture facts.
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
import { lifecycleBinding } from './management-fixtures';
import { trialToday } from '../trial/clock';
import { managementValueAt as atPath } from '../../src/app-vnext/management-task';

export function bindingFromFacts(facts: DailyItemFacts | undefined): typeof lifecycleBinding {
  const values: Record<string, unknown> = {};
  if (facts?.date?.dueOn)
    values.expiry = {
      date: facts.date.dueOn,
      ...(facts.date.dateKind ? { date_kind: facts.date.dateKind } : {}),
    };
  if (facts?.item.status.label === '已开封') values.opening = { state: 'OPENED' };
  else if (facts?.item.status.label === '未开封') values.opening = { state: 'SEALED' };
  return { ...lifecycleBinding, values };
}
export function projectLifecycle(
  facts: DailyItemFacts,
  binding: typeof lifecycleBinding | null,
): DailyItemFacts {
  const values = binding?.values || {};
  const expiry = atPath(values, 'expiry.date');
  const dateKind = atPath(values, 'expiry.date_kind');
  const opening = atPath(values, 'opening.state');
  const acquired = atPath(values, 'acquisition.acquired_on');
  const condition = atPath(values, 'condition');
  const result: DailyItemFacts = {
    ...facts,
    item: {
      ...facts.item,
      revision: facts.item.revision + 1,
      facts: facts.item.facts.filter(
        (f) => f.source?.templateId !== 'lifecycle' && f.kind !== 'opening' && f.kind !== 'expiry',
      ),
    },
  };
  if (typeof expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiry))
    result.date = {
      kind: 'EXPIRY',
      dateKind:
        dateKind === 'BEST_BEFORE' || dateKind === 'USE_BY' || dateKind === 'ESTIMATED'
          ? dateKind
          : null,
      dueOn: expiry,
      basis: facts.date?.basis || null,
      state: expiry < trialToday() ? 'OVERDUE' : expiry === trialToday() ? 'DUE' : 'UPCOMING',
      source: 'LIFECYCLE',
      label:
        dateKind === 'BEST_BEFORE'
          ? '最佳食用期'
          : dateKind === 'USE_BY'
            ? '使用期限'
            : dateKind === 'ESTIMATED'
              ? '估计日期'
              : '标注日期',
    };
  else if (!facts.date?.source || facts.date.source === 'LIFECYCLE') result.date = undefined;
  if (opening === 'OPENED' || opening === 'SEALED') {
    const label = opening === 'OPENED' ? '已开封' : '未开封';
    result.item.facts.push({
      kind: 'opening',
      label: '开封',
      value: label,
      priority: 2,
      source: {
        templateId: 'lifecycle',
        version: binding!.template_version,
        path: 'opening.state',
      },
    });
    if (!['已用完', '已处置', '已拆包'].includes(result.item.status.label))
      result.item.status = { label, tone: 'neutral' };
  } else if (['已开封', '未开封'].includes(result.item.status.label))
    result.item.status = { label: '开封状态未记录', tone: 'neutral' };
  if (typeof acquired === 'string')
    result.item.facts.push({
      kind: 'custom',
      label: '取得日期',
      value: acquired,
      priority: 4,
      source: {
        templateId: 'lifecycle',
        version: binding!.template_version,
        path: 'acquisition.acquired_on',
      },
    });
  if (typeof condition === 'string')
    result.item.facts.push({
      kind: 'condition',
      label: '成色',
      value:
        (
          { NEW: '全新', GOOD: '良好', WORN: '磨损', DAMAGED: '损坏', BROKEN: '故障' } as Record<
            string,
            string
          >
        )[condition] || condition,
      priority: 3,
      source: { templateId: 'lifecycle', version: binding!.template_version, path: 'condition' },
    });
  return result;
}
