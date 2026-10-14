import { CatalogReview } from './catalog-review';
import { Card, Descriptions } from 'antd';
import { CalendarInput, DecimalInput } from './inputs';
import { Button, Form, Input, Select, TreeSelect } from 'antd';
import { draftSchema } from '../lib/draft';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import {
  templateFor,
  schemas,
  type Operation,
  type TemplateId,
} from '../../../../packages/contracts/src/index';
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
import { ApiError, write, read } from '../lib/api';
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
import { FormField, Notice, ActionDrawer } from './components';
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
  proposalId?: string;
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
}: {
  action: Action;
  onClose: () => void;
  onSaved: (result: WriteResult) => void;
  onCreateProduct: () => void;
}) {
  const { data, refresh, stale } = useInventory();
  const { session, online } = useSession();
  const productOptions = useMemo(
    () =>
      data.catalog
        .filter((c) => c.kind === 'SKU' && c.id !== data.container_catalog_id)
        .map((c) => {
          const product = attr(c, 'product');
          const details = [product?.brand, specification(c), ...(product?.barcodes ?? [])]
            .filter(Boolean)
            .join(' · ');
          return {
            value: c.id,
            label: c.name,
            details,
            searchText: `${c.name} ${details}`.normalize('NFKC').toLocaleLowerCase(),
          };
        }),
    [data.catalog, data.container_catalog_id],
  );
  const item = data.items.find((i) => i.id === action.target),
    catalog = data.catalog.find((c) => c.id === action.target);
  const target = item ?? catalog;
  const moveIds = action.ids?.split(',').filter(Boolean) ?? (item ? [item.id] : []);
  const movingItems = data.items.filter((i) => moveIds.includes(i.id));
  const workbench = action.kind === 'edit' || (action.kind === 'move' && movingItems.length > 0);
  const moving = action.kind === 'move' && movingItems.length > 0;
  const template = action.template ?? 'lifecycle';
  const templateVersion =
    target?.attributes.find((a) => a.template_id === template)?.template_version ?? 1;
  const fields = ['attributes', 'correct'].includes(action.kind)
    ? [
        ...(action.kind === 'correct' && template === 'lifecycle' ? correctionFields : []),
        ...(definitions[template] ?? []).filter((f) =>
          (templateFor(template, templateVersion).paths as readonly string[]).includes(f.path),
        ),
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
  const [errorDetails, setErrorDetails] = useState<any>();
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [review, setReview] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!review || action.kind !== 'intake') return;
    const frame = requestAnimationFrame(() => {
      reviewRef.current?.focus({ preventScroll: true });
      reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [review, action.kind]);
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
      expiry_kind: '',
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
    setErrorDetails(undefined);
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
    <FormField label={isCatalog ? '所属分类' : '存放位置'}>
      <TreeSelect
        value={values.parent ?? ''}
        onChange={(value) => set('parent', value ?? '')}
        treeDefaultExpandAll
        treeDataSimpleMode
        treeData={[
          { id: '', pId: null, value: '', title: isCatalog ? '顶层目录' : '暂不指定位置' },
          ...(isCatalog ? categories : positions).map((p) => ({
            id: p.id,
            pId: p.parent_id ?? '',
            value: p.id,
            title: 'name' in p ? p.name : itemName(p, data),
          })),
        ]}
      />
    </FormField>
  );
  function command(): Attempt {
    if (!draft) throw new Error('正在恢复草稿');
    const base = { expected_revisions: draft.revisions };
    let operation: Operation;
    let input: Record<string, unknown>;
    const attribute = { template_id: template, template_version: templateVersion };
    switch (action.kind) {
      case 'intake': {
        operation = 'commit_intake';
        const initial: unknown[] = [];
        const lifecycle = {
          ...(values.opening ? { opening: { state: values.opening } } : {}),
          ...(values.expiry
            ? {
                expiry: {
                  date: values.expiry,
                  ...(values.expiry_kind ? { date_kind: values.expiry_kind } : {}),
                },
              }
            : {}),
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
          policy_revision: Number(values.policyRevision ?? 0),
          lines: [
            {
              product:
                values.newProduct === 'true'
                  ? {
                      name: values.productName,
                      parent_id: values.productParent,
                      classification_reason: values.classificationReason,
                    }
                  : { catalog_node_id: values.sku },
              instances: [
                {
                  count: Number(values.count),
                  parent_id: values.parent || null,
                  initial_attributes: initial,
                },
              ],
            },
          ],
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
      let attempt = draft.attempt ?? command();
      if (!draft.attempt && attempt.operation === 'commit_intake') {
        const context = await read<any>('get_intake_context', {
          catalog_node_ids: [values.newProduct === 'true' ? values.productParent : values.sku],
          location_ids: values.parent ? [values.parent] : [],
        });
        const observed = Object.fromEntries(
          [...data.catalog, ...data.items].map((o) => [o.id, o.revision]),
        );
        for (const [id, revision] of Object.entries(context.expected_revisions))
          if (observed[id] !== revision)
            throw new ApiError(
              'REVISION_CONFLICT',
              '所选商品或位置发生变化，请核对最新记录。',
              409,
            );
        attempt = {
          ...attempt,
          payload: {
            ...attempt.payload,
            policy_revision: context.policy_revision,
            expected_revisions: context.expected_revisions,
          },
        };
      }
      const pending = { ...draft, attempt };
      setDraft(pending);
      // Persist the exact key and payload before dispatch: even a reload after a lost response is a safe retry.
      await persist(draftKey, pending);
      const needsGovernance =
        ['create_catalog_node', 'update_catalog_node', 'move_catalog_node'].includes(
          attempt.operation,
        ) ||
        (['bind_attributes', 'update_attributes', 'remove_attributes'].includes(
          attempt.operation,
        ) &&
          (attempt.payload.target as any)?.kind === 'CATALOG_NODE') ||
        (attempt.operation === 'correct_item' && !!attempt.payload.core);
      if (needsGovernance && !attempt.payload.approval_id) {
        if (!draft.proposalId) {
          const proposal = (await write(
            'propose_catalog_change',
            {
              idempotency_key: `proposal:${attempt.payload.idempotency_key}`,
              proposal: {
                kind: 'catalog_command',
                operation: attempt.operation,
                input: attempt.payload,
                reason: values.reason || '核对本次明确的目录修改',
              },
            },
            session.household_id,
            session.user_id,
            session.cache_key,
          )) as WriteResult & { proposal_id: string };
          const waiting = { ...pending, proposalId: proposal.proposal_id };
          setDraft(waiting);
          await persist(draftKey, waiting);
        }
        return;
      }
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
        setErrorDetails(err.details);
        if (err.code === 'REVISION_CONFLICT' || err.code === 'POLICY_CONFLICT') {
          setConflict(true);
          setDraft((d) => (d ? { ...d, attempt: undefined, proposalId: undefined } : d));
          await refresh().catch(() => {});
          if (err.code === 'POLICY_CONFLICT')
            setErrorDetails(await read('get_catalog_policy', {}).catch(() => err.details));
        } else if (err.status >= 400 && err.status < 500 && err.status !== 401)
          setDraft((d) => (d ? { ...d, attempt: undefined, proposalId: undefined } : d));
        if (err.status >= 400 && err.status < 500 && err.status !== 401) setReview(false);
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
        <Card className="card">
          <h2>{item ? itemTitle(item, data) : catalog?.name}</h2>
          <p>{item ? fullPath(item.parent_id, data) : '商品资料'}</p>
          {core && item && (
            <>
              <p>{specification(data.catalog.find((c) => c.id === item.catalog_node_id))}</p>
              <small className="identity">实物编号 {item.id}</small>
            </>
          )}
          {item && <p className="quantity">{remaining(item)}</p>}
        </Card>
      )}
    </>
  );
  if (!draft)
    return (
      <ActionDrawer context={context} title={titles[action.kind] ?? '编辑'} onClose={onClose}>
        <p role="status">{error || '正在恢复草稿…'}</p>
      </ActionDrawer>
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
    <ActionDrawer
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
          if (e.key !== 'Enter') return;
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
            e.preventDefault();
            return;
          }
          if ((e.target as HTMLElement).closest('.ant-select, .ant-picker')) {
            e.preventDefault();
            return;
          }
          if (session.host === 'mcp' && e.target instanceof HTMLInputElement) {
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
                htmlType="button"
                onClick={() => void refresh().catch(() => setError('连接仍不可用，输入已保留。'))}
                type="default"
              >
                重新读取库存
              </Button>
            )}
          </>
        )}
        {storageError && <Notice danger>{storageError}</Notice>}
        {draft.proposalId && !draft.attempt?.payload.approval_id && (
          <CatalogReview
            proposalId={draft.proposalId}
            onApproved={(id) => {
              const approved = {
                ...draft,
                attempt: draft.attempt
                  ? { ...draft.attempt, payload: { ...draft.attempt.payload, approval_id: id } }
                  : undefined,
              };
              setDraft(approved);
              void persist(draftKey, approved);
            }}
          />
        )}
        {draft.attempt?.payload.approval_id ? <Notice>已批准本次变更，请提交保存。</Notice> : null}

        {draft.attempt && !draft.result && (
          <Notice>有一笔尚待确认的提交。重试会核对同一次操作，不会重复入库或消耗。</Notice>
        )}
        {draft.result && <Notice>操作已保存。请刷新读取最新结果。</Notice>}
        <Form
          component={false}
          disabled={busy || !!draft.attempt || !!draft.result || session.can_write === false}
        >
          <fieldset
            disabled={busy || !!draft.attempt || !!draft.result}
            hidden={review && action.kind === 'intake'}
            className="stack"
          >
            {action.kind === 'intake' && (
              <>
                <FormField label="选择商品">
                  <Select
                    showSearch={{
                      filterOption: (input, option) =>
                        (option?.searchText ?? '').includes(
                          input.normalize('NFKC').trim().toLocaleLowerCase(),
                        ),
                    }}
                    placeholder="搜索名称、品牌、规格或条码"
                    optionRender={(option) => (
                      <div className="ac-product-option">
                        <span>{option.label}</span>
                        {option.data.details && <small>{option.data.details}</small>}
                      </div>
                    )}
                    notFoundContent="没有匹配商品，可创建新商品"
                    value={values.sku}
                    onChange={(e) => set('sku', e)}
                    options={[
                      { value: '', label: '请选择已有商品', details: '', searchText: '' },
                      ...productOptions,
                    ]}
                  />
                </FormField>
                <Button
                  htmlType="button"
                  onClick={() => set('newProduct', values.newProduct === 'true' ? 'false' : 'true')}
                  type="default"
                >
                  {values.newProduct === 'true' ? '改用已有商品' : '创建新商品'}
                </Button>
                {values.newProduct === 'true' && (
                  <>
                    <Notice>
                      新商品先保留为草稿，提交时与实物一起保存。此分类需要已有确认规范。
                    </Notice>
                    <FormField label="新商品名称">
                      <Input
                        required
                        value={values.productName ?? ''}
                        onChange={(e) => set('productName', e.target.value)}
                      />
                    </FormField>
                    <FormField label="商品分类">
                      <Select
                        value={values.productParent}
                        onChange={(v) => set('productParent', v)}
                        options={categories.map((c) => ({ value: c.id, label: c.name }))}
                      />
                    </FormField>
                    <FormField label="归类依据">
                      <Input
                        required
                        value={values.classificationReason ?? ''}
                        onChange={(e) => set('classificationReason', e.target.value)}
                        placeholder="说明与已确认分类含义的关系"
                      />
                    </FormField>
                  </>
                )}
                <FormField label="入库件数" hint="每件实物都有独立身份；以下属性仅应用于这次入库。">
                  <DecimalInput
                    min="1"
                    max="100"
                    step="1"
                    required
                    value={values.count}
                    onChange={(value) => set('count', value)}
                  />
                </FormField>
                {selectParent()}
                <details
                  className="stash-optional"
                  open={!!(values.opening || values.expiry || values.quantity) || undefined}
                >
                  <summary>补充日期、开封与余量（可选）</summary>
                  <div className="stack">
                    <FormField label="开封状态">
                      <Select
                        value={values.opening}
                        onChange={(e) => set('opening', e)}
                        options={[
                          { value: '', label: '\u672A\u8BB0\u5F55' },
                          { value: 'SEALED', label: '\u672A\u5F00\u5C01' },
                          { value: 'OPENED', label: '\u5DF2\u5F00\u5C01' },
                        ]}
                      />
                    </FormField>
                    <FormField label="日期类型">
                      <Select
                        value={values.expiry_kind ?? ''}
                        onChange={(v) => set('expiry_kind', v)}
                        options={[
                          { value: '', label: '未记录类型' },
                          { value: 'ESTIMATED', label: '计划吃完（自行设定）' },
                          { value: 'USE_BY', label: '保质期（原包装）' },
                          { value: 'BEST_BEFORE', label: '最佳食用期（原包装）' },
                        ]}
                      />
                    </FormField>
                    <FormField
                      label={values.expiry_kind === 'ESTIMATED' ? '计划吃完日期' : '到期日期'}
                    >
                      <CalendarInput
                        value={values.expiry}
                        onChange={(value) => set('expiry', value)}
                      />
                    </FormField>
                    <FormField
                      label="每件剩余量"
                      hint="可选。请填写已知数量，不会自动按包装规格填满。"
                    >
                      <span className="measurement">
                        <DecimalInput
                          value={values.quantity}
                          onChange={(value) => set('quantity', value)}
                          placeholder="未记录"
                        />
                        <Select
                          aria-label="每件剩余量单位"
                          value={values.unit}
                          onChange={(e) => set('unit', e)}
                          options={[
                            ...(['mL', 'g', 'count', 'percent'].map((u) => ({
                              value: u,
                              label: label(u),
                            })) ?? []),
                          ]}
                        />
                      </span>
                    </FormField>
                  </div>
                </details>
              </>
            )}
            {['place', 'catalog', 'rename'].includes(action.kind) && (
              <FormField label="名称">
                <Input
                  required={action.kind !== 'rename' || !item}
                  maxLength={500}
                  value={values.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </FormField>
            )}
            {action.kind === 'catalog' && (
              <>
                <FormField label="目录类型">
                  <Select
                    value={values.kind}
                    onChange={(e) => set('kind', e)}
                    options={[
                      { value: 'SKU', label: '\u5546\u54C1' },
                      ...(action.from !== 'intake'
                        ? [{ value: 'GROUP', label: '\u5206\u7C7B' }]
                        : []),
                    ]}
                  />
                </FormField>
                {selectParent(true)}
              </>
            )}
            {action.kind === 'place' && selectParent()}
            {action.kind === 'edit' && item && (
              <>
                <FormField label="名称" hint="留空时使用商品名称。">
                  <Input
                    maxLength={500}
                    value={values.name}
                    placeholder={itemName(item, data)}
                    onChange={(e) => set('name', e.target.value)}
                  />
                </FormField>
                <FormField label="规格" hint="同款商品共有资料。在商品目录中编辑。">
                  <Input
                    readOnly
                    value={
                      specification(data.catalog.find((c) => c.id === item.catalog_node_id)) ||
                      '未记录'
                    }
                  />
                </FormField>
                <a href={`/catalog/${item.catalog_node_id}`}>编辑商品共有资料 ›</a>
                <FormField label="状态">
                  <Select
                    value={values.availability}
                    onChange={(e) => set('availability', e)}
                    options={[
                      ...(availabilityOptions.map(([v, t]) => ({ value: v, label: t })) ?? []),
                    ]}
                  />
                </FormField>
                <FormField label="购入日期">
                  <CalendarInput
                    value={values.acquired_on}
                    onChange={(value) => set('acquired_on', value)}
                  />
                </FormField>
                <FormField label="备注">
                  <Input.TextArea
                    rows={4}
                    maxLength={100000}
                    value={values.body}
                    onChange={(e) => set('body', e.target.value)}
                  />
                </FormField>
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
              <FormField label="开封时间" hint="可选，仅填写你确认的时间；留空会保留为未记录。">
                <CalendarInput
                  withTime
                  value={values.opened_at}
                  onChange={(value) => set('opened_at', value)}
                />
              </FormField>
            )}
            {action.kind === 'consume' && (
              <>
                <FormField
                  label="本次消耗量"
                  error={values.amount ? amountError : undefined}
                  hint={`${currentAmount ? label(currentAmount.unit) : ''} · 应大于 0，且不超过当前剩余量`}
                >
                  <Input
                    required
                    inputMode="decimal"
                    maxLength={100}
                    pattern="(0|[1-9][0-9]*)(\.[0-9]+)?"
                    value={values.amount}
                    onChange={(e) => set('amount', e.target.value)}
                  />
                </FormField>
              </>
            )}
            {(action.kind === 'consume' || (action.kind === 'intake' && !!values.quantity)) && (
              <FormField label="数量依据">
                <Select
                  value={values.accuracy}
                  onChange={(e) => set('accuracy', e)}
                  options={[
                    { value: '', label: '\u672A\u8BB0\u5F55' },
                    { value: 'ESTIMATED', label: '\u4F30\u8BA1\u503C' },
                    { value: 'MEASURED', label: '\u5B9E\u6D4B\u503C' },
                  ]}
                />
              </FormField>
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
              <FormField label="纠错原因">
                <Input.TextArea
                  required
                  maxLength={500}
                  value={values.reason}
                  onChange={(e) => set('reason', e.target.value)}
                  placeholder="例如：上次估计有误，重新测量后更正"
                />
              </FormField>
            )}
            {action.kind === 'note' && (
              <>
                <FormField label="笔记标题">
                  <Input
                    maxLength={500}
                    value={values.title}
                    onChange={(e) => set('title', e.target.value)}
                  />
                </FormField>
                <FormField label="笔记内容">
                  <Input.TextArea
                    required
                    maxLength={100000}
                    rows={6}
                    value={values.body}
                    onChange={(e) => set('body', e.target.value)}
                  />
                </FormField>
              </>
            )}
          </fieldset>
        </Form>
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
          <section
            ref={reviewRef}
            tabIndex={-1}
            aria-labelledby="intake-review-title"
            className="intake-review stack"
          >
            <h2 id="intake-review-title">核对本次入库</h2>
            <p>确认后保存以下记录。未填写的信息保留为未记录。</p>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: 'product',
                  label: '商品',
                  children:
                    values.newProduct === 'true'
                      ? values.productName
                      : data.catalog.find((c) => c.id === values.sku)?.name,
                },
                ...(values.newProduct === 'true'
                  ? [
                      {
                        key: 'category',
                        label: '商品分类',
                        children:
                          data.catalog.find((c) => c.id === values.productParent)?.name ?? '未记录',
                      },
                      { key: 'reason', label: '归类依据', children: values.classificationReason },
                    ]
                  : []),
                { key: 'count', label: '入库件数', children: `${values.count} 件` },
                {
                  key: 'place',
                  label: '存放位置',
                  children: values.parent ? fullPath(values.parent, data) : '未记录',
                },
                { key: 'opening', label: '开封状态', children: label(values.opening) },
                { key: 'expiry', label: '到期日期', children: values.expiry || '未记录' },
                {
                  key: 'quantity',
                  label: '每件剩余量',
                  children: values.quantity ? amount(values.quantity, values.unit) : '未记录',
                },
                {
                  key: 'accuracy',
                  label: '数量依据',
                  children: values.quantity ? label(values.accuracy) : '未记录',
                },
              ]}
            />
            {!draft.attempt && !draft.result && (
              <Button
                htmlType="button"
                disabled={busy}
                onClick={() => {
                  setReview(false);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLInputElement>('.action-drawer [aria-label="选择商品"]')
                      ?.focus(),
                  );
                }}
              >
                返回修改
              </Button>
            )}
          </section>
        )}
        {error && <Notice danger>{error}</Notice>}
        {error && errorDetails && (
          <Card title="核对冲突" size="small">
            {Array.isArray(errorDetails.candidates) &&
              errorDetails.candidates.map((candidate: any) => (
                <div key={candidate.id}>
                  <p>
                    {candidate.name} ·{' '}
                    {(candidate.attributes ?? [])
                      .filter((a: any) => a.template_id === 'product')
                      .map((a: any) =>
                        [a.values.brand, a.values.model, a.values.specification]
                          .filter(Boolean)
                          .join(' / '),
                      )
                      .join('；')}
                  </p>
                  {action.kind === 'intake' && candidate.kind === 'SKU' && (
                    <Button
                      htmlType="button"
                      onClick={() => {
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                values: { ...d.values, sku: candidate.id, newProduct: 'false' },
                                attempt: undefined,
                                proposalId: undefined,
                              }
                            : d,
                        );
                        setReview(false);
                        setError('');
                        setErrorDetails(undefined);
                        setConflict(false);
                      }}
                    >
                      使用这个已有商品
                    </Button>
                  )}
                </div>
              ))}
            <details>
              <summary>查看具体记录、规则与版本差异</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {JSON.stringify(errorDetails, null, 2)}
              </pre>
            </details>
          </Card>
        )}

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
              htmlType="button"
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
              type="default"
            >
              已核对，保留我的输入
            </Button>
          </section>
        )}
        <div className="ac-form-footer">
          <Button
            htmlType={session.host === 'mcp' ? 'button' : 'submit'}
            onClick={
              session.host === 'mcp'
                ? (e) => {
                    if (e.currentTarget.closest('form')?.reportValidity()) reviewOrSubmit();
                  }
                : undefined
            }
            disabled={
              busy ||
              session.can_write === false ||
              (!!draft.proposalId && !draft.attempt?.payload.approval_id) ||
              !online ||
              (stale && !draft.result) ||
              conflict ||
              (!draft.attempt && !draft.result && !!(amountError || moveError))
            }
            type="primary"
            danger={(action.kind === 'finish' ? 'danger' : 'primary') === 'danger'}
          >
            {busy
              ? '正在保存…'
              : draft.result
                ? '刷新查看结果'
                : draft.attempt
                  ? draft.attempt.payload.approval_id
                    ? '保存'
                    : draft.proposalId
                      ? '等待分类确认'
                      : '重试同一次操作'
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
          <Button htmlType="button" disabled={busy} onClick={onClose} type="default">
            取消
          </Button>
        </div>
      </form>
    </ActionDrawer>
  );
}
