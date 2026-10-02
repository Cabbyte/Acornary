import { draftSchema } from '../lib/draft';
import { useEffect, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { schemas, type Operation, type TemplateId } from '../../../../packages/contracts/src/index';
import {
  ancestors,
  attr,
  isContainer,
  isTerminal,
  itemName,
  locationName,
  type WriteResult,
} from '../../../../packages/contracts/src/web';
import { useInventory } from '../lib/inventory';
import { useSession } from '../lib/session';
import { ApiError, write } from '../lib/api';
import { persist, stored } from '../lib/storage';
import { amount, itemTitle, label, remaining } from '../lib/presentation';
import {
  AttributeFields,
  changes,
  correctionFields,
  definitions,
  fieldValues,
  nested,
  templateLabels,
  type Values,
} from './fields';
import { Button, Field, Notice, Sheet } from './components';
import { consumptionError, fullPath, specification } from '../lib/browse';
import { WorkbenchMovePicker } from './workbench';
import { availabilityOptions, moveValidation } from '../lib/workbench';

export interface Action {
  kind: string;
  target?: string;
  template?: TemplateId;
  note?: string;
  parent?: string;
  ids?: string;
  from?: string;
}
interface Attempt {
  operation: Operation;
  payload: Record<string, unknown>;
}
interface Draft {
  values: Values;
  original: Values;
  revisions: Record<string, number>;
  attempt?: Attempt;
  result?: WriteResult;
}
const titles: Record<string, string> = {
  edit: '编辑物品',
  intake: '入库',
  consume: '记录消耗',
  finish: '确认整件用完',
  open: '记录开封',
  move: '移动位置',
  rename: '修改名称',
  attributes: '编辑资料',
  correct: '纠正记录',
  note: '文字笔记',
  place: '新建位置',
  catalog: '创建目录',
};

export function ActionSheet({
  action,
  onClose,
  onSaved,
  onCreateProduct,
}: {
  action: Action;
  onClose: () => void;
  onSaved: (result: WriteResult) => void;
  onCreateProduct: () => void;
}) {
  const { data, refresh, stale } = useInventory();
  const { session, online } = useSession();
  const item = data.items.find((i) => i.id === action.target),
    catalog = data.catalog.find((c) => c.id === action.target);
  const target = item ?? catalog;
  const moveIds = action.ids?.split(',').filter(Boolean) ?? (item ? [item.id] : []);
  const movingItems = data.items.filter((i) => moveIds.includes(i.id));
  const workbench = action.kind === 'edit' || (action.kind === 'move' && movingItems.length > 0);
  const moving = action.kind === 'move' && movingItems.length > 0;
  const template = action.template ?? 'lifecycle';
  const fields = ['attributes', 'correct'].includes(action.kind)
    ? [
        ...(action.kind === 'correct' && template === 'lifecycle' ? correctionFields : []),
        ...(definitions[template] ?? []),
        ...(action.kind === 'correct' && template === 'lifecycle'
          ? (definitions.contents ?? []).map((f) => ({ ...f, path: `content.${f.path}` }))
          : []),
      ]
    : [];
  const sourceValues = () =>
    target
      ? action.kind === 'correct' && template === 'lifecycle'
        ? { ...attr(target, 'lifecycle'), content: attr(target, 'contents') }
        : attr(target, template)
      : {};
  const draftKey = `${session.cache_key}:draft:${action.kind}:${action.target ?? ''}:${template}:${action.note ?? ''}:${action.ids ?? ''}:${action.parent ?? ''}`;
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [review, setReview] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const original = target ? fieldValues(sourceValues(), fields) : {};
    const note = data.notes.find((n) => n.id === action.note && n.item_id === action.target);
    const values: Values = {
      name: item?.display_name ?? catalog?.name ?? '',
      availability: item ? (attr(item, 'lifecycle')?.availability ?? '') : '',
      acquired_on: item ? (attr(item, 'lifecycle')?.acquisition?.acquired_on ?? '') : '',
      sku: catalog?.kind === 'SKU' ? catalog.id : '',
      parent:
        target?.parent_id ??
        (action.ids
          ? data.items.find((i) => i.id === action.ids?.split(',')[0])?.parent_id
          : undefined) ??
        action.parent ??
        '',
      count: '1',
      opening: '',
      expiry: '',
      quantity: '',
      unit: 'mL',
      accuracy: '',
      kind: 'SKU',
      title: note?.title ?? '',
      body: note?.body ?? '',
      reason: '',
      destinationChosen: 'false',
      amount: '',
      opened_at: '',
      ...original,
    };
    const selected = action.ids?.split(',').filter(Boolean) ?? [];
    const revisions = Object.fromEntries(
      data.items.filter((i) => selected.includes(i.id)).map((i) => [i.id, i.revision]),
    );
    if (target) revisions[target.id] = target.revision;
    void stored<Draft>(draftKey)
      .then((saved) => {
        if (!cancelled) {
          if (saved && !draftSchema.safeParse(saved).success) {
            setError('保存的草稿无法安全恢复。请保留此记录并在松仓网站核对操作结果。');
            return;
          }
          setDraft(saved ?? { values, original: { ...values }, revisions });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDraft({ values, original: { ...values }, revisions });
          setStorageError('无法保存本地草稿，请保持此页面打开。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);
  useEffect(() => {
    if (draft && !done)
      void persist(draftKey, draft).catch(() =>
        setStorageError('草稿未能写入本地；关闭页面可能丢失输入。'),
      );
  }, [draft, draftKey, done]);
  const set = (key: string, value: string) => {
    setDraft((d) => (d ? { ...d, values: { ...d.values, [key]: value } } : d));
    setReview(false);
    setError('');
  };
  const values = draft?.values ?? {};
  const physicalMove = moving;
  const core = action.kind === 'consume' || moving;
  const currentAmount = item && attr(item, 'contents')?.remaining;
  const amountError =
    action.kind === 'consume' ? consumptionError(values.amount ?? '', currentAmount) : '';
  const moveError = moving
    ? values.destinationChosen !== 'true'
      ? '请选择目标位置。'
      : movingItems.length !== moveIds.length
        ? '部分物品已不可用，请返回重新选择。'
        : moveValidation(data, movingItems, values.parent ?? '')
    : '';
  const kind = item ? 'ITEM' : 'CATALOG_NODE';
  const positions = data.items.filter(
    (i) => isContainer(i) && (!item || !ancestors(i.id, data.items).some((p) => p.id === item.id)),
  );
  const categories = data.catalog.filter(
    (c) =>
      c.kind === 'GROUP' &&
      (!catalog || !ancestors(c.id, data.catalog).some((p) => p.id === catalog.id)),
  );
  const selectParent = (isCatalog = false) => (
    <Field label={isCatalog ? '所属分类' : '存放位置'}>
      <select value={values.parent ?? ''} onChange={(e) => set('parent', e.target.value)}>
        <option value="">{isCatalog ? '顶层目录' : '暂不指定位置'}</option>
        {(isCatalog ? categories : positions).map((p) => (
          <option key={p.id} value={p.id}>
            {'name' in p
              ? ancestors(p.id, data.catalog)
                  .map((c) => c.name)
                  .join(' / ')
              : `${locationName(p, data) === '未记录位置' ? '' : locationName(p, data) + ' / '}${itemName(p, data)}`}
          </option>
        ))}
      </select>
    </Field>
  );
  function command(): Attempt {
    if (!draft) throw new Error('正在恢复草稿');
    const base = { expected_revisions: draft.revisions };
    let operation: Operation;
    let input: Record<string, unknown>;
    const attribute = { template_id: template, template_version: 1 };
    switch (action.kind) {
      case 'intake': {
        operation = 'create_items';
        const initial: unknown[] = [];
        const lifecycle = {
          ...(values.opening ? { opening: { state: values.opening } } : {}),
          ...(values.expiry ? { expiry: { date: values.expiry } } : {}),
        };
        if (Object.keys(lifecycle).length)
          initial.push({ template_id: 'lifecycle', template_version: 1, values: lifecycle });
        if (values.quantity)
          initial.push({
            template_id: 'contents',
            template_version: 1,
            values: {
              remaining: { value: values.quantity, unit: values.unit },
              ...(values.accuracy ? { accuracy: values.accuracy } : {}),
            },
          });
        input = {
          catalog_node_id: values.sku,
          count: Number(values.count),
          parent_id: values.parent || null,
          initial_attributes: initial,
        };
        break;
      }
      case 'place':
        operation = 'create_items';
        input = {
          catalog_node_id: data.container_catalog_id,
          count: 1,
          display_name: values.name.trim(),
          parent_id: values.parent || null,
          initial_attributes: [
            { template_id: 'container', template_version: 1, values: { can_contain: true } },
          ],
        };
        break;
      case 'catalog':
        operation = 'create_catalog_node';
        input = { kind: values.kind, name: values.name.trim(), parent_id: values.parent || null };
        break;
      case 'rename':
        operation = item ? 'update_item' : 'update_catalog_node';
        input = item
          ? { item_id: item.id, display_name: values.name.trim() || null }
          : { catalog_node_id: catalog?.id, name: values.name.trim() };
        break;
      case 'edit':
        operation = 'edit_item';
        input = {
          item_id: item?.id,
          ...(values.name !== draft.original.name
            ? { display_name: values.name.trim() || null }
            : {}),
          ...(values.availability !== draft.original.availability
            ? { availability: values.availability || null }
            : {}),
          ...(values.acquired_on !== draft.original.acquired_on
            ? { acquired_on: values.acquired_on || null }
            : {}),
          ...(values.body !== draft.original.body
            ? { note: { ...(action.note ? { note_id: action.note } : {}), body: values.body } }
            : {}),
        };
        break;
      case 'move':
        operation = action.ids ? 'move_items' : item ? 'move_item' : 'move_catalog_node';
        input = {
          ...(action.ids
            ? { item_ids: moveIds }
            : item
              ? { item_id: item.id }
              : { catalog_node_id: catalog?.id }),
          parent_id: values.parent || null,
        };
        break;
      case 'open':
        operation = 'open_item';
        input = {
          item_id: item?.id,
          ...(values.opened_at ? { opened_at: new Date(values.opened_at).toISOString() } : {}),
        };
        break;
      case 'consume': {
        operation = 'consume_item_content';
        const current = item && attr(item, 'contents')?.remaining;
        if (!current) throw new Error('请先记录剩余内容，再进行消耗。');
        if (
          !values.amount ||
          !new Decimal(values.amount).gt(0) ||
          new Decimal(values.amount).gt(current.value)
        )
          throw new Error('消耗量应大于 0，且不超过当前剩余量。');
        input = {
          item_id: item?.id,
          amount: { value: values.amount, unit: current.unit },
          ...(values.accuracy ? { accuracy: values.accuracy } : {}),
        };
        break;
      }
      case 'finish':
        operation = 'consume_items';
        input = { item_ids: action.ids?.split(',').filter(Boolean) ?? [item?.id] };
        break;
      case 'note':
        operation = action.note ? 'update_note' : 'add_note';
        input = {
          item_id: item?.id,
          ...(action.note
            ? { note_id: action.note, title: values.title || null }
            : values.title
              ? { title: values.title }
              : {}),
          body: values.body,
        };
        break;
      case 'correct': {
        operation = 'correct_item';
        const patch = changes(values, draft.original, fields);
        if (!values.reason.trim()) throw new Error('请填写纠错原因。');
        if (!Object.keys(patch.set).length && !patch.unset.length)
          throw new Error('请先修改需要纠正的内容。');
        // Clearing a formerly known opening also clears its timestamp, explicitly within this correction.
        if (
          template === 'lifecycle' &&
          (patch.set['opening.state'] === 'SEALED' || patch.unset.includes('opening.state'))
        )
          patch.unset.push('opening.opened_at');
        const contents = {
          template_id: 'contents',
          template_version: 1,
          set: Object.fromEntries(
            Object.entries(patch.set)
              .filter(([k]) => k.startsWith('content.'))
              .map(([k, v]) => [k.slice(8), v]),
          ),
          unset: patch.unset.filter((k) => k.startsWith('content.')).map((k) => k.slice(8)),
        };
        const primary = {
          ...attribute,
          set: Object.fromEntries(
            Object.entries(patch.set).filter(([k]) => !k.startsWith('content.')),
          ),
          unset: patch.unset.filter((k) => !k.startsWith('content.')),
        };
        input = {
          item_id: item?.id,
          reason: values.reason.trim(),
          attributes: [
            primary,
            ...(Object.keys(contents.set).length || contents.unset.length ? [contents] : []),
          ],
        };
        break;
      }
      default: {
        if (!target) throw new Error('记录不可用');
        const patch = changes(values, draft.original, fields);
        if (!Object.keys(patch.set).length && !patch.unset.length)
          throw new Error('没有需要保存的改动。');
        const bound = target.attributes.some((a) => a.template_id === template);
        operation = bound ? 'update_attributes' : 'bind_attributes';
        input = {
          target: { kind, id: target.id },
          ...attribute,
          ...(bound ? patch : { values: nested(patch.set) }),
        };
      }
    }
    const payload = { ...input, ...base, idempotency_key: crypto.randomUUID() };
    const parsed = schemas[operation].safeParse(payload);
    if (!parsed.success) throw new Error('请检查必填项、日期、件数和数量格式。');
    return { operation, payload: parsed.data };
  }
  async function complete(result: WriteResult) {
    await refresh();
    setDone(true);
    await persist(draftKey, undefined).catch(() => {});
    onSaved(result);
  }
  async function submit() {
    if (session.can_write === false) {
      setError('当前连接只有读取权限。');
      return;
    }
    if (lock.current || !draft || !online || (stale && !draft.result) || conflict) return;
    if (!draft.attempt && !draft.result && (amountError || moveError)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (draft.result) {
        await complete(draft.result);
        return;
      }
      const attempt = draft.attempt ?? command();
      const pending = { ...draft, attempt };
      setDraft(pending);
      // Persist the exact key and payload before dispatch: even a reload after a lost response is a safe retry.
      await persist(draftKey, pending);
      const result = await write(
        attempt.operation,
        attempt.payload,
        session.household_id,
        session.user_id,
        session.cache_key,
      );
      const committed = { ...pending, result };
      setDraft(committed);
      await persist(draftKey, committed);
      await complete(result);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'REVISION_CONFLICT') {
          setConflict(true);
          setDraft((d) => (d ? { ...d, attempt: undefined } : d));
          await refresh().catch(() => {});
        } else if (err.status >= 400 && err.status < 500 && err.status !== 401)
          setDraft((d) => (d ? { ...d, attempt: undefined } : d));
        setError(err.message);
      } else setError(err instanceof Error ? err.message : '无法保存，请重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function reviewOrSubmit() {
    if (!draft) return;
    if (action.kind === 'intake' && !review && !draft.attempt && !draft.result) {
      try {
        command();
        setReview(true);
      } catch (err) {
        setError((err as Error).message);
      }
      return;
    }
    if (physicalMove && !workbench && !review && !draft.attempt && !draft.result) {
      if (!moveError) setReview(true);
      return;
    }
    void submit();
  }
  const desktopPage =
    ['attributes', 'rename', 'note', 'intake', 'place', 'catalog', 'correct'].includes(
      action.kind,
    ) || core;
  const context = (
    <>
      {!core && (
        <Notice>
          {item
            ? '这页只修改这一件实物，其他同款物品保持各自的记录。'
            : catalog && action.kind !== 'intake'
              ? '这里维护商品共有资料；每件实物的数量、位置和状态单独管理。'
              : '保存前请核对商品、件数与位置。未填写的可选信息保留为未记录。'}
        </Notice>
      )}
      {target && (
        <section className="card">
          <h2>{item ? itemTitle(item, data) : catalog?.name}</h2>
          <p>{item ? fullPath(item.parent_id, data) : '商品资料'}</p>
          {core && item && (
            <>
              <p>{specification(data.catalog.find((c) => c.id === item.catalog_node_id))}</p>
              <small className="identity">实物编号 {item.id}</small>
            </>
          )}
          {item && <p className="quantity">{remaining(item)}</p>}
        </section>
      )}
    </>
  );
  if (!draft)
    return (
      <Sheet
        workbench={workbench}
        desktopPage={desktopPage}
        context={context}
        title={titles[action.kind] ?? '编辑'}
        onClose={onClose}
      >
        <p role="status">{error || '正在恢复草稿…'}</p>
      </Sheet>
    );
  let preview = '';
  try {
    if (action.kind === 'consume' && currentAmount && values.amount && !amountError)
      preview = amount(
        new Decimal(currentAmount.value).minus(values.amount).toFixed(),
        currentAmount.unit,
      );
  } catch {
    /* Invalid input is handled on submit. */
  }
  return (
    <Sheet
      workbench={workbench}
      desktopPage={desktopPage}
      core={core}
      context={context}
      title={
        moving
          ? `移动 ${movingItems.length} 件物品`
          : action.kind === 'attributes'
            ? (templateLabels[template] ?? '编辑资料')
            : (titles[action.kind] ?? '编辑')
      }
      onClose={onClose}
      busy={busy}
    >
      <form
        className="stack"
        onKeyDown={(e) => {
          if (
            session.host === 'mcp' &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229 &&
            e.key === 'Enter' &&
            e.target instanceof HTMLInputElement
          ) {
            e.preventDefault();
            if (e.currentTarget.reportValidity()) reviewOrSubmit();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          reviewOrSubmit();
        }}
      >
        {item && !workbench && (
          <Notice>
            {itemTitle(item, data)} · {remaining(item)}
            <br />
            {core ? fullPath(item.parent_id, data) : '此次只修改明确选中的实物。'}
          </Notice>
        )}
        {catalog && action.kind !== 'intake' && (
          <Notice>{catalog.name} · 商品共有资料的修改会应用于同款实物的展示。</Notice>
        )}
        {(!online || stale) && (
          <>
            <Notice>当前离线或连接不可用。输入已保留，恢复联网后请手动提交。</Notice>
            {online && stale && !draft.result && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void refresh().catch(() => setError('连接仍不可用，输入已保留。'))}
              >
                重新读取库存
              </Button>
            )}
          </>
        )}
        {storageError && <Notice danger>{storageError}</Notice>}
        {draft.attempt && !draft.result && (
          <Notice>有一笔尚待确认的提交。重试会核对同一次操作，不会重复入库或消耗。</Notice>
        )}
        {draft.result && <Notice>操作已保存。请刷新读取最新结果。</Notice>}
        <fieldset disabled={busy || !!draft.attempt || !!draft.result} className="stack">
          {action.kind === 'intake' && (
            <>
              <Field label="选择商品">
                <select required value={values.sku} onChange={(e) => set('sku', e.target.value)}>
                  <option value="">请选择已有商品</option>
                  {data.catalog
                    .filter((c) => c.kind === 'SKU' && c.id !== data.container_catalog_id)
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Button type="button" variant="secondary" onClick={onCreateProduct}>
                创建新商品
              </Button>
              <Field label="入库件数" hint="每件实物都有独立身份；以下属性仅应用于这次入库。">
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                  value={values.count}
                  onChange={(e) => set('count', e.target.value)}
                />
              </Field>
              {selectParent()}
              <Field label="开封状态">
                <select value={values.opening} onChange={(e) => set('opening', e.target.value)}>
                  <option value="">未记录</option>
                  <option value="SEALED">未开封</option>
                  <option value="OPENED">已开封</option>
                </select>
              </Field>
              <Field label="到期日期">
                <input
                  type="date"
                  value={values.expiry}
                  onChange={(e) => set('expiry', e.target.value)}
                />
              </Field>
              <Field label="每件剩余量" hint="可选。请填写已知数量，不会自动按包装规格填满。">
                <span className="measurement">
                  <input
                    inputMode="decimal"
                    pattern="(0|[1-9][0-9]*)(\.[0-9]+)?"
                    value={values.quantity}
                    onChange={(e) => set('quantity', e.target.value)}
                    placeholder="未记录"
                  />
                  <select
                    aria-label="每件剩余量单位"
                    value={values.unit}
                    onChange={(e) => set('unit', e.target.value)}
                  >
                    {['mL', 'g', 'count', 'percent'].map((u) => (
                      <option key={u} value={u}>
                        {label(u)}
                      </option>
                    ))}
                  </select>
                </span>
              </Field>
            </>
          )}
          {['place', 'catalog', 'rename'].includes(action.kind) && (
            <Field label="名称">
              <input
                required={action.kind !== 'rename' || !item}
                maxLength={500}
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
          )}
          {action.kind === 'catalog' && (
            <>
              <Field label="目录类型">
                <select value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                  <option value="SKU">商品</option>
                  {action.from !== 'intake' && <option value="GROUP">分类</option>}
                </select>
              </Field>
              {selectParent(true)}
            </>
          )}
          {action.kind === 'place' && selectParent()}
          {action.kind === 'edit' && item && (
            <>
              <Field label="名称" hint="留空时使用商品名称。">
                <input
                  maxLength={500}
                  value={values.name}
                  placeholder={itemName(item, data)}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>
              <Field label="规格" hint="同款商品共有资料。在商品目录中编辑。">
                <input
                  readOnly
                  value={
                    specification(data.catalog.find((c) => c.id === item.catalog_node_id)) ||
                    '未记录'
                  }
                />
              </Field>
              <a href={`/catalog/${item.catalog_node_id}`}>编辑商品共有资料 ›</a>
              <Field label="状态">
                <select
                  value={values.availability}
                  onChange={(e) => set('availability', e.target.value)}
                >
                  {availabilityOptions.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="购入日期">
                <input
                  type="date"
                  value={values.acquired_on}
                  onChange={(e) => set('acquired_on', e.target.value)}
                />
              </Field>
              <Field label="备注">
                <textarea
                  rows={4}
                  maxLength={100000}
                  value={values.body}
                  onChange={(e) => set('body', e.target.value)}
                />
              </Field>
            </>
          )}
          {action.kind === 'move' &&
            (moving ? (
              <WorkbenchMovePicker
                items={movingItems}
                value={values.parent ?? ''}
                onChange={(value) => {
                  set('parent', value);
                  set('destinationChosen', 'true');
                }}
              />
            ) : (
              selectParent(!item)
            ))}
          {action.kind === 'open' && (
            <Field label="开封时间" hint="可选，仅填写你确认的时间；留空会保留为未记录。">
              <input
                type="datetime-local"
                value={values.opened_at}
                onChange={(e) => set('opened_at', e.target.value)}
              />
            </Field>
          )}
          {action.kind === 'consume' && (
            <>
              <Field
                label="本次消耗量"
                error={values.amount ? amountError : undefined}
                hint={`${currentAmount ? label(currentAmount.unit) : ''} · 应大于 0，且不超过当前剩余量`}
              >
                <input
                  required
                  inputMode="decimal"
                  maxLength={100}
                  pattern="(0|[1-9][0-9]*)(\.[0-9]+)?"
                  value={values.amount}
                  onChange={(e) => set('amount', e.target.value)}
                />
              </Field>
            </>
          )}
          {['intake', 'consume'].includes(action.kind) && (
            <Field label="数量依据">
              <select value={values.accuracy} onChange={(e) => set('accuracy', e.target.value)}>
                <option value="">未记录</option>
                <option value="ESTIMATED">估计值</option>
                <option value="MEASURED">实测值</option>
              </select>
            </Field>
          )}
          {action.kind === 'finish' && (
            <Notice>
              将所选 {action.ids?.split(',').filter(Boolean).length ?? 1}{' '}
              件实物标记为已用完，已记录的剩余量归零。
              <ul>
                {(action.ids?.split(',') ?? [item?.id]).map((id) => {
                  const selected = data.items.find((i) => i.id === id);
                  return selected ? (
                    <li key={id}>
                      {itemTitle(selected, data)} · {locationName(selected, data)}
                    </li>
                  ) : null;
                })}
              </ul>
            </Notice>
          )}
          {['attributes', 'correct'].includes(action.kind) && (
            <AttributeFields fields={fields} values={values} onChange={set} />
          )}
          {action.kind === 'correct' && (
            <Field label="纠错原因">
              <textarea
                required
                maxLength={500}
                value={values.reason}
                onChange={(e) => set('reason', e.target.value)}
                placeholder="例如：上次估计有误，重新测量后更正"
              />
            </Field>
          )}
          {action.kind === 'note' && (
            <>
              <Field label="笔记标题">
                <input
                  maxLength={500}
                  value={values.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
              <Field label="笔记内容">
                <textarea
                  required
                  maxLength={100000}
                  rows={6}
                  value={values.body}
                  onChange={(e) => set('body', e.target.value)}
                />
              </Field>
            </>
          )}
        </fieldset>
        {preview && (
          <section className="consume-preview">
            <p>使用后剩余</p>
            <p className="quantity">剩余 {preview}</p>
            {currentAmount && new Decimal(currentAmount.value).eq(values.amount) && (
              <small>确认后这件实物将标记为已用完。</small>
            )}
          </section>
        )}
        {moving && (
          <section className="wb-move-confirmation">
            <p>
              目标位置 ·{' '}
              {values.destinationChosen !== 'true'
                ? '尚未选择'
                : values.parent
                  ? fullPath(values.parent, data)
                  : '未指定位置'}
            </p>
            {values.destinationChosen === 'true' && (
              <p>
                移入后共{' '}
                {data.items.filter(
                  (i) =>
                    !isContainer(i) &&
                    !isTerminal(i) &&
                    (i.parent_id ?? '') === values.parent &&
                    !moveIds.includes(i.id),
                ).length + movingItems.filter((i) => !isContainer(i)).length}{' '}
                件物品（当前层）
              </p>
            )}
            {moveError && <small>{moveError}</small>}
          </section>
        )}
        {review && action.kind === 'intake' && (
          <Notice>
            将新增 {values.count} 件「{data.catalog.find((c) => c.id === values.sku)?.name}
            」，位置：
            {values.parent
              ? itemName(
                  data.items.find((i) => i.id === values.parent)!,
                  data,
                )
              : '未记录'}
            。请核对以上信息。
          </Notice>
        )}
        {error && <Notice danger>{error}</Notice>}
        {conflict && (
          <section className="conflict">
            <h3>核对最新记录</h3>
            <p>你的输入仍保留。以下是服务器当前内容：</p>
            <dl>
              {moving &&
                movingItems.map((i) => (
                  <div key={i.id}>
                    <dt>{itemName(i, data)}</dt>
                    <dd>{fullPath(i.parent_id, data)}</dd>
                  </div>
                ))}
              {action.kind === 'edit' && item && (
                <div>
                  <dt>最新资料</dt>
                  <dd>
                    {itemName(item, data)} · {label(attr(item, 'lifecycle')?.availability)} ·{' '}
                    {attr(item, 'lifecycle')?.acquisition?.acquired_on || '日期未记录'}
                    <p>{data.notes.find((n) => n.id === action.note)?.body || '备注未记录'}</p>
                  </dd>
                </div>
              )}
              {target &&
                fields.map((f) => {
                  const latest = fieldValues(sourceValues(), fields);
                  return (
                    <div key={f.path}>
                      <dt>{f.label}</dt>
                      <dd>
                        当前：{label(latest[f.path])}；你的输入：{label(values[f.path])}
                      </dd>
                    </div>
                  );
                })}
              {target && (
                <div>
                  <dt>名称与位置</dt>
                  <dd>
                    {item ? itemTitle(item, data) : catalog?.name} ·{' '}
                    {item ? locationName(item, data) : (catalog?.parent_id ?? '顶层目录')}
                  </dd>
                </div>
              )}
              {action.kind === 'consume' && (
                <div>
                  <dt>剩余量与本次消耗</dt>
                  <dd>
                    当前：{item ? remaining(item) : '未记录'}；你的输入：{values.amount}{' '}
                    {currentAmount?.unit}
                  </dd>
                </div>
              )}
            </dl>
            <Button
              type="button"
              variant="secondary"
              disabled={!online || stale}
              onClick={() => {
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        revisions: Object.fromEntries(
                          Object.keys(d.revisions).map((id) => [
                            id,
                            data.items.find((i) => i.id === id)?.revision ??
                              data.catalog.find((c) => c.id === id)?.revision ??
                              d.revisions[id],
                          ]),
                        ),
                      }
                    : d,
                );
                setConflict(false);
                setError('');
              }}
            >
              已核对，保留我的输入
            </Button>
          </section>
        )}
        <Button
          type={session.host === 'mcp' ? 'button' : 'submit'}
          onClick={
            session.host === 'mcp'
              ? (e) => {
                  if (e.currentTarget.form?.reportValidity()) reviewOrSubmit();
                }
              : undefined
          }
          disabled={
            busy ||
            session.can_write === false ||
            !online ||
            (stale && !draft.result) ||
            conflict ||
            (!draft.attempt && !draft.result && !!(amountError || moveError))
          }
          variant={action.kind === 'finish' ? 'danger' : 'primary'}
        >
          {busy
            ? '正在保存…'
            : draft.result
              ? '刷新查看结果'
              : draft.attempt
                ? '重试同一次操作'
                : action.kind === 'intake'
                  ? review
                    ? '确认入库'
                    : '核对入库信息'
                  : action.kind === 'consume'
                    ? '确认记录消耗'
                    : action.kind === 'finish'
                      ? '确认整件用完'
                      : moving
                        ? `确认移动 ${movingItems.length} 件`
                        : action.kind === 'edit'
                          ? '保存修改'
                          : '保存'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
          取消
        </Button>
      </form>
    </Sheet>
  );
}
