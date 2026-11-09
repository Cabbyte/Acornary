import type { ReactNode } from 'react';
import { Button } from '../../../ui/components/ui/button';
import { Input } from '../../../ui/components/ui/input';
import { FormField } from '../../../ui/components/ui/form-field';
import { Select } from '../../../ui/components/ui/select';
import { Checkbox } from '../../../ui/components/ui/checkbox';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { DataTable, type DataTableColumn } from '../../../ui/components/ui/data-table';
import { TreeView } from '../../../ui/components/ui/tree-view';
import { PageHeader } from '../../../ui/patterns/page-header';
import { ItemIdentity } from '../../../ui/patterns/item-identity';
import { LocationPath } from '../../../ui/patterns/location-path';
import { BatchSelectionBar } from '../../../ui/patterns/batch-selection-bar';
import { AttributeFields } from '../../../ui/patterns/attribute-fields';
import { ConflictResolution } from '../../../ui/patterns/conflict-resolution';
import { ApprovalSummary } from '../../../ui/patterns/approval-summary';
import { HistoryEntry } from '../../../ui/patterns/history-entry';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { LoadingState } from '../../../ui/patterns/loading-state';
import type { ItemView } from '../../../ui/patterns/types';
import type { ManagementProps } from './models';
import './management.css';

function Frame({
  title,
  context,
  children,
  props,
  back,
}: {
  title: string;
  context: string;
  children: ReactNode;
  props: ManagementProps;
  back?: string;
}) {
  const { model: m, onIntent, onNavigate } = props;
  const blocked =
    m.state === 'loading' ||
    m.state === 'error' ||
    m.state === 'forbidden' ||
    m.state === 'session-changed';
  return (
    <div className="management-page">
      <PageHeader
        title={title}
        context={context}
        onBack={back ? () => onNavigate(back) : undefined}
      />
      {m.state === 'loading' ? (
        <LoadingState layout="list" label="正在读取当前家庭的管理资料" />
      ) : m.state === 'error' ? (
        <EmptyState
          reason="error"
          context="查询条件与草稿已保留。当前读取没有完成，不能据此判断库存数量。"
          recoveryAction={<Button onClick={() => onIntent('retry')}>重新读取</Button>}
        />
      ) : m.state === 'forbidden' ? (
        <EmptyState
          reason="permission"
          recoveryAction={
            <Button variant="secondary" onClick={() => onNavigate('/settings')}>
              查看身份与权限
            </Button>
          }
        />
      ) : m.state === 'session-changed' ? (
        <EmptyState
          reason="unknown"
          title="家庭或身份已变化"
          context="旧家庭的记录、选择和可见草稿已移除。重新取得当前身份后再继续。"
          recoveryAction={<Button onClick={() => onIntent('retry')}>重新读取当前家庭</Button>}
        />
      ) : null}
      {m.state === 'offline' && (
        <InlineNotice tone="warning" title="离线 · 仅显示已缓存范围">
          缓存更新于 2026-11-07。筛选只涵盖已缓存记录；写入与冻结导出暂不可用。
          <Button variant="quiet" onClick={() => onIntent('retry')}>
            恢复连接
          </Button>
        </InlineNotice>
      )}
      {!blocked && children}
      {m.feedback && (
        <InlineNotice tone="info" title="隔离预览反馈">
          {m.feedback}
        </InlineNotice>
      )}
      {!blocked && m.task && <TaskPanel {...props} />}
    </div>
  );
}
function TaskPanel({ model: m, onChange, onIntent }: ManagementProps) {
  const task = m.task!;
  return (
    <section className="management-card management-task" aria-label={task.title}>
      <div className="management-heading">
        <h2>{task.title}</h2>
        <Button variant="quiet" onClick={() => onIntent('close-task')}>
          {task.phase === 'receipt' ? '完成' : '保留草稿并收起'}
        </Button>
      </div>
      <p className="management-meta">{task.description}</p>
      {task.phase === 'receipt' ? (
        <InlineNotice tone="success" title="隔离预览结果">
          {task.receipt}
        </InlineNotice>
      ) : (
        <>
          <div className="management-form">
            {task.fields.map((field) =>
              field.options ? (
                <Select
                  key={field.key}
                  label={field.label}
                  value={field.value || null}
                  options={field.options}
                  required={field.required}
                  hint={field.hint}
                  onValueChange={(value) => onChange(`task.${field.key}`, value || '')}
                />
              ) : (
                <FormField
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  hint={field.hint}
                  hintMode="visible"
                >
                  <Input
                    type={field.type || 'text'}
                    value={field.value}
                    onChange={(event) => onChange(`task.${field.key}`, event.target.value)}
                  />
                </FormField>
              ),
            )}
          </div>
          <div className="management-heading">
            <h3>影响预览</h3>
            <span className="management-meta">本次固定范围 {task.targetIds.length} 个对象</span>
          </div>
          <ul className="management-impact">
            {task.impact.map((impact, index) => (
              <li key={`${impact.label}-${index}`}>
                <strong>{impact.label}</strong>
                <span className="management-meta">现在：{impact.before}</span>
                <span>提交后：{impact.after}</span>
              </li>
            ))}
          </ul>
          {task.snapshot.length > 0 && (
            <details>
              <summary>核对具体对象、完整路径与捕获版本（{task.snapshot.length}）</summary>
              <div className="management-list">
                {task.snapshot.map((row) => (
                  <div className="management-record" key={row.id}>
                    <div>
                      <strong>{row.name}</strong>
                      <span className="management-meta">
                        {row.path} · 捕获版本 {row.revision}
                      </span>
                      <code className="management-id">{row.id}</code>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {task.blockedReason && (
            <InlineNotice tone="warning" title="当前不能提交">
              {task.blockedReason}
            </InlineNotice>
          )}
          {task.error && (
            <InlineNotice tone="danger" title="请先修正">
              {task.error}
            </InlineNotice>
          )}
          {task.approval && (
            <ApprovalSummary
              proposal={task.approval}
              availability={m.writeAvailability}
              onRequestReview={() => onIntent('review-task')}
              onConfirm={() => onIntent('approve-task')}
              onRevise={() => onIntent('revise-task')}
            />
          )}
          <div className="management-task-actions">
            <Button variant="secondary" onClick={() => onIntent('review-task')}>
              更新影响预览
            </Button>
            <Button
              disabled={
                !!task.blockedReason ||
                m.writeAvailability.kind !== 'available' ||
                (!!task.approval && task.approval.status !== 'approved')
              }
              onClick={() => onIntent('submit-task')}
            >
              {task.confirmLabel}
            </Button>
          </div>
          <p className="management-meta">
            输入、对象版本或家庭改变后必须重新核对；此预览不向正式家庭提交请求。
          </p>
        </>
      )}
    </section>
  );
}
function Selection(props: ManagementProps) {
  const { model: m, onChange, onIntent } = props;
  return (
    <div className="management-selection">
      <BatchSelectionBar
        selection={m.selection}
        expanded={m.selectionExpanded}
        onExpandedChange={(value) => onChange('selectionExpanded', value)}
        scopeLabel="当前家庭"
        availability={m.writeAvailability}
        onRemove={(id) =>
          onChange(
            'selection',
            m.selection.ids.filter((value) => value !== id),
          )
        }
        onClear={() => onChange('selection', [])}
        onReview={() => onIntent('bulk')}
        onStartAction={() => onIntent('bulk')}
        actionLabel="批量操作"
      />
      {m.selection.ids.some((id) => !m.selection.visibleIds.includes(id)) && (
        <Button
          variant="quiet"
          onClick={() =>
            onChange(
              'selection',
              m.selection.ids.filter((id) => m.selection.visibleIds.includes(id)),
            )
          }
        >
          仅保留当前可见选择
        </Button>
      )}
    </div>
  );
}
export function ManagementItems(props: ManagementProps) {
  const { model: m, onChange, onIntent, onNavigate } = props;
  const columns: DataTableColumn<ItemView>[] = [
    {
      id: 'name',
      label: '物品 / 商品',
      sortable: true,
      cell: (item) => (
        <ItemIdentity
          item={item}
          showId="label"
          onOpen={(id) => onNavigate(`/manage/edit?id=${id}`)}
        />
      ),
    },
    {
      id: 'location',
      label: '物理位置',
      cell: (item) => (
        <LocationPath location={item.location} state={item.location.id ? 'known' : 'unknown'} />
      ),
    },
    {
      id: 'facts',
      label: '数量 / 日期事实',
      cell: (item) => (
        <div>
          {item.facts.length ? (
            item.facts.map((fact) => (
              <p key={fact.kind}>
                {fact.label} · {fact.value}
              </p>
            ))
          ) : (
            <span className="management-meta">余量、日期未记录</span>
          )}
        </div>
      ),
    },
    {
      id: 'state',
      label: '记录状态',
      cell: (item) => <span>{item.recordState === 'VOID' ? '已作废' : item.status.label}</span>,
    },
  ];
  return (
    <Frame title="物品管理" context="按具体实物管理 · 选择以完整物品身份为准" props={props}>
      <div className="management-toolbar">
        <Select
          label="物理位置"
          value={m.locationFilter || 'all'}
          options={[
            { value: 'all', label: '所有位置' },
            ...m.locations.map((location) => ({
              value: location.id,
              label: location.path.join(' › '),
            })),
          ]}
          onValueChange={(value) => onChange('locationFilter', value === 'all' ? null : value)}
        />
        <Select
          label="商品分类"
          value={m.categoryFilter || 'all'}
          options={[
            { value: 'all', label: '所有分类' },
            ...m.catalogs
              .filter((row) => row.kind === 'GROUP')
              .map((row) => ({ value: row.id, label: row.path.join(' › ') })),
          ]}
          onValueChange={(value) => onChange('categoryFilter', value === 'all' ? null : value)}
        />
        <Button
          variant="secondary"
          disabled={m.writeAvailability.kind !== 'available'}
          onClick={() => onIntent('export')}
        >
          冻结导出
        </Button>
        <Button variant="quiet" onClick={() => onNavigate('/manage/history')}>
          查看动态
        </Button>
      </div>
      <div className="management-toolbar">
        <Checkbox
          label="含作废记录"
          checked={m.includeVoid}
          onCheckedChange={(value) => onChange('includeVoid', value)}
        />
        <Checkbox
          label="显示版本与完整身份"
          checked={m.showDetails}
          onCheckedChange={(value) => onChange('showDetails', value)}
        />
        <span className="management-meta">当前查询 {m.total} 件 · 每次最多选择 100 件</span>
      </div>
      <Selection {...props} />
      <DataTable
        rows={m.items}
        columns={columns}
        caption="当前查询中的具体物品"
        getRowLabel={(item) => item.name}
        onOpen={(id) => onNavigate(`/manage/edit?id=${id}`)}
        showOpenAction={false}
        showSelectionSummary={false}
        filterLabel="搜索物品名称、商品或标签"
        filterValue={m.query}
        onFilterChange={(value) => onChange('query', value)}
        sorting={m.sorting}
        onSortingChange={(value) => onChange('sorting', value)}
        selectedIds={m.selection.ids}
        onSelectionChange={(value) => onChange('selection', value)}
        expandedIds={m.expandedRows}
        onExpandedChange={(value) => onChange('expandedRows', value)}
        pagination={{
          pageIndex: m.page,
          pageSize: m.pageSize,
          knownTotal: m.total,
          hasPrevious: m.page > 0,
          hasNext: (m.page + 1) * m.pageSize < m.total,
        }}
        onPageChange={(value) => onChange('page', value)}
        renderRowDetails={
          m.showDetails
            ? (item) => (
                <div className="management-meta">
                  <code className="management-id">{item.id}</code>
                  <p>
                    版本 {item.revision} · 更新于 {item.updatedAt} · {item.noteCount} 条笔记
                  </p>
                </div>
              )
            : undefined
        }
      />
      {m.export && (
        <section className="management-card">
          <h2 className="vn-section-title">冻结导出范围</h2>
          <p>{m.export.scope}</p>
          <p className="management-meta">
            生成时点 {m.export.generatedAt} · 不含笔记正文、附件或敏感信息
          </p>
          <p>
            已读取 {m.export.loaded} / {m.export.total} 件
          </p>
          <div className="management-toolbar">
            {!m.export.complete ? (
              <Button onClick={() => onIntent('export-next')}>读取下一页</Button>
            ) : (
              m.export.href && (
                <a
                  className="vn-control vn-button vn-button--primary vn-button--default"
                  href={m.export.href}
                  download="acornary-isolated-management.csv"
                >
                  下载隔离样例 CSV
                </a>
              )
            )}
            <Button variant="secondary" onClick={() => onIntent('export-cancel')}>
              {m.export.complete ? '结束冻结' : '取消导出'}
            </Button>
          </div>
        </section>
      )}
    </Frame>
  );
}
function StructureTree({ kind, props }: { kind: 'catalog' | 'location'; props: ManagementProps }) {
  const { model: m, onChange } = props;
  const catalog = kind === 'catalog';
  return (
    <aside className="management-tree management-card" data-open={m.treeOpen}>
      <Button
        className="management-tree-trigger"
        variant="secondary"
        aria-expanded={m.treeOpen}
        onClick={() => onChange('treeOpen', !m.treeOpen)}
      >
        {catalog ? '选择商品分类' : '选择物理位置'}
      </Button>
      <div className="management-tree-content">
        <h2 className="vn-section-title">{catalog ? '分类 · GROUP' : '物理位置 · 容器实物'}</h2>
        <TreeView
          label={catalog ? '商品分类树' : '位置与容器树'}
          nodes={catalog ? m.catalogTree : m.locationTree}
          selectedId={catalog ? m.categoryFilter : m.selectedLocation?.id || null}
          expandedIds={catalog ? m.catalogExpanded : m.locationExpanded}
          onExpandedChange={(value) =>
            onChange(catalog ? 'catalogExpanded' : 'locationExpanded', value)
          }
          onSelectionChange={(id) => onChange(catalog ? 'categoryFilter' : 'selectedLocation', id)}
        />
        {catalog && (
          <Button variant="quiet" onClick={() => onChange('categoryFilter', null)}>
            全部商品分类
          </Button>
        )}
      </div>
    </aside>
  );
}
export function ManagementCatalog(props: ManagementProps) {
  const { model: m, onIntent, onChange, onNavigate } = props;
  const row = m.selectedCatalog;
  const visibleCatalog = m.catalogs.filter(
    (item) =>
      item.kind === 'SKU' &&
      (!m.categoryFilter || item.parentId === m.categoryFilter) &&
      (!m.query || `${item.name} ${item.path.join(' ')}`.includes(m.query)) &&
      (m.includeVoid || item.recordState === 'VALID') &&
      (m.includeHidden || !item.hidden) &&
      (m.includeOneOff || !item.oneOff),
  );
  return (
    <Frame title="商品目录" context="分类与共享商品资料 · 不代表物理存放位置" props={props}>
      <div className="management-toolbar">
        <Button
          disabled={m.writeAvailability.kind !== 'available'}
          onClick={() => onIntent('catalog-create-sku')}
        >
          新建商品资料
        </Button>
        <Button
          variant="secondary"
          disabled={m.writeAvailability.kind !== 'available'}
          onClick={() => onIntent('catalog-create-group')}
        >
          新建分类
        </Button>
        <Button variant="quiet" onClick={() => onNavigate('/manage/locations')}>
          位置与容器
        </Button>
      </div>
      <div className="management-structure">
        <StructureTree kind="catalog" props={props} />
        <div className="vn-stack">
          <FormField label="搜索商品或完整分类路径">
            <Input value={m.query} onChange={(event) => onChange('query', event.target.value)} />
          </FormField>
          <div className="management-toolbar">
            <Checkbox
              label="含作废"
              checked={m.includeVoid}
              onCheckedChange={(value) => onChange('includeVoid', value)}
            />
            <Checkbox
              label="含隐藏"
              checked={m.includeHidden}
              onCheckedChange={(value) => onChange('includeHidden', value)}
            />
            <Checkbox
              label="含一次性商品"
              checked={m.includeOneOff}
              onCheckedChange={(value) => onChange('includeOneOff', value)}
            />
          </div>
          <section className="management-card">
            <h2 className="vn-section-title">当前分类下的商品</h2>
            <div className="management-list">
              {visibleCatalog.map((item) => (
                <div className="management-record" key={item.id}>
                  <div>
                    <Button variant="quiet" onClick={() => onChange('selectedCatalog', item.id)}>
                      {item.name}
                    </Button>
                    <p className="management-meta">
                      {item.path.join(' › ')} · {item.specification}
                    </p>
                    <p className="management-meta">
                      商品 · {item.profile || '类型未设置'} ·{' '}
                      {item.itemCount === null ? '实物数量待读取' : `${item.itemCount} 件引用`}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => onIntent('catalog-edit', item.id)}>
                    编辑共享
                  </Button>
                </div>
              ))}
            </div>
            {!visibleCatalog.length && (
              <EmptyState
                reason={m.query ? 'no-match' : 'empty'}
                title={m.query ? '当前条件下没有商品' : '当前分类下还没有商品'}
                recoveryAction={
                  <Button onClick={() => onIntent('catalog-create-sku')}>建立商品资料</Button>
                }
              />
            )}
          </section>
          {row && (
            <section className="management-card">
              <div className="management-heading">
                <h2>
                  {row.kind === 'GROUP' ? '分类' : '商品'} · {row.name}
                </h2>
                <Button variant="quiet" onClick={() => onChange('selectedCatalog', null)}>
                  收起资料
                </Button>
              </div>
              <dl className="management-facts">
                <dt>完整分类路径</dt>
                <dd>{row.path.join(' › ')}</dd>
                <dt>生效能力</dt>
                <dd>{row.effectiveCapabilities.join('、') || '尚未设置'}</dd>
                <dt>显式覆盖</dt>
                <dd>
                  {row.capabilities === null
                    ? '未设置，沿用类型能力'
                    : row.capabilities.join('、') || '明确为空'}
                </dd>
                <dt>共享范围</dt>
                <dd>
                  {row.kind === 'GROUP'
                    ? '下级分类和商品路径'
                    : row.itemCount === null
                      ? '范围已知，引用数量待读取'
                      : `这款商品及引用资料的 ${row.itemCount} 件实物`}
                </dd>
              </dl>
              <div className="management-toolbar">
                <Button variant="secondary" onClick={() => onIntent('catalog-edit', row.id)}>
                  编辑{row.kind === 'GROUP' ? '分类' : '商品资料'}
                </Button>
                <Button variant="secondary" onClick={() => onIntent('catalog-move', row.id)}>
                  移动分类归属
                </Button>
                {row.kind === 'SKU' && (
                  <>
                    <Button variant="secondary" onClick={() => onIntent('stock', row.id)}>
                      补货策略
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => onNavigate(`/manage/items?catalog=${row.id}`)}
                    >
                      查看同款实物
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={row.itemCount !== 0}
                      onClick={() => onIntent('catalog-void', row.id)}
                    >
                      作废无引用商品
                    </Button>
                  </>
                )}
              </div>
              {row.kind === 'SKU' && row.itemCount !== 0 && (
                <p className="management-meta">
                  仅无实物及其他引用的商品可作废。分类不提供通用删除。
                </p>
              )}
              {row.attributes.map((binding) => (
                <AttributeFields
                  key={binding.template_id}
                  binding={binding}
                  template={null}
                  scope={{ kind: 'SKU', id: row.id, label: row.name }}
                  availability={m.writeAvailability}
                  readOnly
                  calendarMonth="2026-11"
                  onChange={() => undefined}
                />
              ))}
              <Button
                variant="quiet"
                onClick={() => onNavigate(`/manage/history?target=${row.id}`)}
              >
                查看目录历史
              </Button>
            </section>
          )}
        </div>
      </div>
    </Frame>
  );
}
export function ManagementLocations(props: ManagementProps) {
  const { model: m, onIntent, onNavigate, onChange } = props;
  const location = m.selectedLocation;
  const content = m.allItems.filter(
    (item) =>
      location &&
      item.location.path.join('/').startsWith(location.path.join('/')) &&
      (m.includeVoid || item.recordState === 'VALID'),
  );
  return (
    <Frame title="位置与容器" context="位置也是具有独立身份的容器物品" props={props}>
      <div className="management-toolbar">
        <Button
          disabled={m.writeAvailability.kind !== 'available'}
          onClick={() => onIntent('location-create')}
        >
          新建位置
        </Button>
        <Checkbox
          label="含作废位置"
          checked={m.includeVoid}
          onCheckedChange={(value) => onChange('includeVoid', value)}
        />
        <Button variant="quiet" onClick={() => onNavigate('/manage/catalog')}>
          查看容器商品资料
        </Button>
      </div>
      <div className="management-structure">
        <StructureTree kind="location" props={props} />
        <div className="vn-stack">
          {!location ? (
            <EmptyState
              reason="empty"
              title="选择一个物理位置"
              context="树中的房间、柜子和箱子都是具体容器；选择后查看完整路径和内容。"
            />
          ) : (
            <>
              <section className="management-card">
                <div className="management-heading">
                  <h2>{location.name}</h2>
                  <span>{location.recordState === 'VOID' ? '已作废' : '容器实物'}</span>
                </div>
                <dl className="management-facts">
                  <dt>物理路径</dt>
                  <dd>{location.path.join(' › ')}</dd>
                  <dt>容纳能力</dt>
                  <dd>{location.canContain ? '可以容纳物品' : '不可容纳'}</dd>
                  <dt>内容范围</dt>
                  <dd>
                    此位置及下级 ·{' '}
                    {location.contentCount === null ? '数量待读取' : `${location.contentCount} 件`}
                  </dd>
                  <dt>当前版本</dt>
                  <dd>{location.revision}</dd>
                </dl>
                <div className="management-toolbar">
                  <Button
                    variant="secondary"
                    onClick={() => onIntent('location-edit', location.id)}
                  >
                    编辑此容器
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => onIntent('location-move', location.id)}
                  >
                    移动容器
                  </Button>
                  {location.recordState === 'VOID' ? (
                    <Button
                      variant="secondary"
                      onClick={() => onIntent('location-restore', location.id)}
                    >
                      恢复作废记录
                    </Button>
                  ) : (
                    <Button
                      variant="quiet"
                      disabled={location.contentCount !== 0}
                      onClick={() => onIntent('location-void', location.id)}
                    >
                      作废误建记录
                    </Button>
                  )}
                </div>
                {location.contentCount !== 0 && (
                  <p className="management-meta">
                    仍有内容时不能作废；请先查看并移动内容。移动容器将更新完整路径，子物品归属关系保持不变。
                  </p>
                )}
              </section>
              <section className="management-card">
                <h2 className="vn-section-title">此位置及下级的内容</h2>
                {content.length ? (
                  <div className="management-list">
                    {content.map((item) => (
                      <div className="management-record" key={item.id}>
                        <ItemIdentity
                          item={item}
                          showId="label"
                          onOpen={(id) => onNavigate(`/manage/edit?id=${id}`)}
                        />
                        <span className="management-meta">{item.location.path.join(' › ')}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    reason="empty"
                    title="当前范围没有已加载内容"
                    context="空位置可以保留、改名或移动。直接子容器数不代表完整库存件数。"
                  />
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}
export function ManagementEdit(props: ManagementProps) {
  const { model: m, onChange, onIntent, onNavigate, onAttributeChange } = props;
  const item = m.item;
  return (
    <Frame
      title="精确编辑实物"
      context="单件资料与商品共享资料分别保存"
      props={props}
      back="/manage/items"
    >
      {!item ? (
        <EmptyState
          reason="unknown"
          title="该物品不存在或已不可访问"
          context="不会自动跳到同名物品。请返回列表重新选择。"
        />
      ) : (
        <>
          <section className="management-card">
            <ItemIdentity item={item} presentation="detail" showId="label" />
            <LocationPath location={item.location} state={item.location.id ? 'known' : 'unknown'} />
            <p className="management-meta">
              {item.recordState === 'VOID' ? '作废记录' : '有效记录'} · 版本 {item.revision} ·
              仅修改此件
            </p>
            <div className="management-toolbar">
              <Button
                variant="quiet"
                onClick={() => onNavigate(`/manage/catalog?id=${item.skuId}`)}
              >
                编辑这款商品
              </Button>
              <Button
                variant="quiet"
                onClick={() => onNavigate(`/manage/history?target=${item.id}`)}
              >
                历史与纠正
              </Button>
              <Button variant="quiet" onClick={() => onNavigate(`/items/${item.id}?tab=notes`)}>
                笔记与附件
              </Button>
            </div>
          </section>
          <section className="management-card">
            <h2 className="vn-section-title">单件资料</h2>
            <div className="management-form">
              <Select
                label="显示名称的修改方式"
                value={m.nameDraft.mode}
                options={[
                  { value: 'unchanged', label: '保持未改' },
                  { value: 'set', label: '设定此件名称' },
                  { value: 'clear', label: '清除此件名称覆盖' },
                ]}
                onValueChange={(value) => onChange('nameMode', value)}
              />
              <FormField
                label="此件显示名称"
                hint="清除覆盖后使用商品名称；空文本与清除是不同意图。"
                hintMode="visible"
              >
                <Input
                  value={m.nameDraft.value}
                  readOnly={m.nameDraft.mode !== 'set'}
                  onChange={(event) => onChange('nameValue', event.target.value)}
                />
              </FormField>
            </div>
            <p className="management-meta">
              商品共享：{m.itemCatalog?.name || '商品资料待读取'} ·{' '}
              {m.itemCatalog?.specification || '规格未记录'}
            </p>
            <Button
              disabled={
                m.nameDraft.mode === 'unchanged' || m.writeAvailability.kind !== 'available'
              }
              onClick={() => onIntent('item-save', item.id)}
            >
              核对此件修改
            </Button>
          </section>
          {!m.lifecycle && item && (
            <section className="management-card">
              <p>此件尚未绑定生命周期资料。</p>
              <Button variant="secondary" onClick={() => onIntent('template-add', item.id)}>
                添加生命周期模板
              </Button>
            </section>
          )}
          {m.lifecycle && (
            <>
              <AttributeFields
                binding={m.lifecycle}
                template={m.lifecycleTemplate}
                scope={{ kind: 'ITEM', id: item.id, label: item.name }}
                availability={m.writeAvailability}
                calendarMonth="2026-11"
                today="2026-11-07"
                onChange={onAttributeChange}
              />
              <div className="management-toolbar">
                <Button
                  variant="secondary"
                  disabled={!m.changedAttributes.length || m.writeAvailability.kind !== 'available'}
                  onClick={() => onIntent('attribute-save', item.id)}
                >
                  核对属性差异（{m.changedAttributes.length}）
                </Button>
                <Button variant="quiet" onClick={() => onIntent('template-upgrade', item.id)}>
                  升级模板
                </Button>
                <Button variant="quiet" onClick={() => onIntent('template-remove', item.id)}>
                  移除绑定
                </Button>
                <Button variant="quiet" onClick={() => onIntent('template-add', item.id)}>
                  添加模板
                </Button>
              </div>
            </>
          )}
          {m.unknownBinding && (
            <AttributeFields
              binding={m.unknownBinding}
              template={null}
              scope={{ kind: 'ITEM', id: item.id, label: item.name }}
              availability={{
                kind: 'missingFacts',
                reason: '尚未取得此版本说明；未知字段保留，只读展示。',
              }}
              readOnly
              calendarMonth="2026-11"
              onChange={() => undefined}
            />
          )}
          <section className="management-card">
            <h2 className="vn-section-title">独立操作</h2>
            <div className="management-toolbar">
              <Button variant="secondary" onClick={() => onIntent('item-move', item.id)}>
                移动位置
              </Button>
              <Button variant="secondary" onClick={() => onIntent('reference', item.id)}>
                关联引用
              </Button>
              {item.profile === 'CONSUMABLE' && (
                <Button variant="secondary" onClick={() => onIntent('split', item.id)}>
                  拆包
                </Button>
              )}
              <Button variant="secondary" onClick={() => onIntent('dispose', item.id)}>
                处置
              </Button>
              {item.recordState === 'VOID' ? (
                <Button variant="secondary" onClick={() => onIntent('restore', item.id)}>
                  恢复作废记录
                </Button>
              ) : (
                <Button variant="quiet" onClick={() => onIntent('void', item.id)}>
                  作废误建记录
                </Button>
              )}
              <Button variant="quiet" onClick={() => onIntent('reassign', item.id)}>
                纠正商品关联
              </Button>
            </div>
            <p className="management-meta">
              开封、使用和日期事项有独立任务；修改名称不会迁移商品身份。引用只显示当前家庭可访问对象。
            </p>
          </section>
          {m.conflict && (
            <ConflictResolution
              {...m.conflict}
              onChoose={(key, value) => onChange(`conflict.${key}`, value)}
              onRefresh={() => onIntent('refresh-conflict')}
              onReconfirm={() => onIntent('resolve-conflict')}
            />
          )}
        </>
      )}
    </Frame>
  );
}
export function ManagementBulk(props: ManagementProps) {
  const { model: m, onIntent, onNavigate } = props;
  const targets = m.selection.ids.map((id) => m.allItems.find((item) => item.id === id));
  const consumables = targets.filter(
    (item) => item?.profile === 'CONSUMABLE' && item.recordState === 'VALID',
  );
  return (
    <Frame
      title="批量管理"
      context="先核对具体物品，再选择一次原子操作"
      props={props}
      back="/manage/items"
    >
      <Selection {...props} />
      {!targets.length ? (
        <EmptyState
          reason="empty"
          title="尚未选择物品"
          recoveryAction={
            <Button onClick={() => onNavigate('/manage/items')}>到物品列表选择</Button>
          }
        />
      ) : (
        <>
          <section className="management-card">
            <div className="management-heading">
              <h2>核对 {targets.length} 件物品</h2>
              <Button variant="quiet" onClick={() => onIntent('refresh-selection')}>
                重新读取选择版本
              </Button>
            </div>
            <div className="management-list">
              {targets.slice(m.page * 10, m.page * 10 + 10).map((item, index) =>
                item ? (
                  <div className="management-record" key={item.id}>
                    <div>
                      <ItemIdentity
                        item={item}
                        showId="label"
                        onOpen={(id) => onNavigate(`/manage/edit?id=${id}`)}
                      />
                      <p className="management-meta">
                        {item.location.path.join(' › ') || '位置未记录'} · 当前版本 {item.revision}{' '}
                        · 捕获版本 {m.selection.revisions?.[item.id] ?? '未知'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p key={index}>1 项已不可访问</p>
                ),
              )}
            </div>
            {targets.length > 10 && (
              <div className="management-toolbar">
                <Button
                  disabled={m.page === 0}
                  variant="secondary"
                  onClick={() => props.onChange('page', m.page - 1)}
                >
                  上一页
                </Button>
                <span>
                  {m.page + 1} / {Math.ceil(targets.length / 10)}
                </span>
                <Button
                  disabled={(m.page + 1) * 10 >= targets.length}
                  variant="secondary"
                  onClick={() => props.onChange('page', m.page + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
          </section>
          <section className="management-card">
            <h2 className="vn-section-title">选择操作</h2>
            <div className="management-toolbar">
              <Button onClick={() => onIntent('bulk-move')}>移动 {targets.length} 件</Button>
              <Button variant="secondary" onClick={() => onIntent('bulk-lifecycle')}>
                生命周期字段
              </Button>
              <Button variant="secondary" onClick={() => onIntent('bulk-consume')}>
                整件用完
              </Button>
            </div>
            <p className="management-meta">
              整件用完可执行 {consumables.length} / 已选 {targets.length}
              。非消耗品或作废记录不适用；默认阻止整个批次。
            </p>
            {consumables.length > 0 && consumables.length < targets.length && (
              <Button variant="quiet" onClick={() => onIntent('bulk-only-eligible')}>
                明确改为仅处理可执行的 {consumables.length} 件
              </Button>
            )}
            <InlineNotice tone="info" title="批量边界">
              一次移动、生命周期编辑或整件用完是原子操作；拒绝时全部未执行。任意模板需要逐件编辑。标签打印需支持的设备入口，当前预览未连接打印机。
            </InlineNotice>
          </section>
        </>
      )}
    </Frame>
  );
}
export function ManagementHistory(props: ManagementProps) {
  const { model: m, onChange, onIntent, onNavigate } = props;
  const operationGroups = [...new Set(m.history.map((entry) => entry.event?.operation_id))].map(
    (id) => m.history.filter((entry) => entry.event?.operation_id === id),
  );
  return (
    <Frame title="动态与历史" context="按操作查看前后事实 · 纠正会追加新事件" props={props}>
      <div className="management-form">
        <Select
          label="事件类型"
          value={m.historyEvent || 'all'}
          options={[
            { value: 'all', label: '全部事件' },
            { value: 'ITEM_UPDATED', label: '实物资料变更' },
            { value: 'ITEM_MOVED', label: '移动' },
            { value: 'ITEM_CORRECTED', label: '纠正记录' },
          ]}
          onValueChange={(value) => onChange('historyEvent', value === 'all' ? '' : value)}
        />
        <FormField label="具体对象 ID">
          <Input
            value={m.historyTarget}
            onChange={(event) => onChange('historyTarget', event.target.value)}
          />
        </FormField>
        <FormField label="操作 ID">
          <Input
            value={m.historyOperation}
            onChange={(event) => onChange('historyOperation', event.target.value)}
          />
        </FormField>
        <FormField label="记录日期从（家庭时区）">
          <Input
            type="date"
            value={m.historyFrom}
            onChange={(event) => onChange('historyFrom', event.target.value)}
          />
        </FormField>
        <FormField label="记录日期至（含当天）">
          <Input
            type="date"
            value={m.historyTo}
            onChange={(event) => onChange('historyTo', event.target.value)}
          />
        </FormField>
      </div>
      <p className="management-meta">
        日期范围按 Asia/Shanghai 的自然日转换。操作人展示在事件中；当前接口不支持按操作人筛选。
      </p>
      {!m.history.length ? (
        <EmptyState
          reason="no-match"
          title="当前条件下没有已加载事件"
          recoveryAction={
            <Button variant="secondary" onClick={() => onIntent('history-clear')}>
              清除历史筛选
            </Button>
          }
        />
      ) : (
        operationGroups.map((group) => (
          <section className="management-card" key={group[0].event?.operation_id}>
            <div className="management-heading">
              <h2>
                {group[0].actorLabel || '成员'} · {group[0].operationLabel}
              </h2>
              <span className="management-meta">
                {group.some((entry) => !entry.operationComplete)
                  ? '部分已加载'
                  : `${group.length} 个对象`}
              </span>
            </div>
            {group.map((entry) => (
              <section className="vn-stack" key={entry.event?.id}>
                <HistoryEntry
                  {...entry}
                  expanded={m.historyExpanded.includes(entry.event!.id)}
                  onExpandedChange={(expanded) =>
                    onChange(
                      'historyExpanded',
                      expanded
                        ? [...m.historyExpanded, entry.event!.id]
                        : m.historyExpanded.filter((id) => id !== entry.event!.id),
                    )
                  }
                  onOpenTarget={(target) =>
                    onNavigate(
                      target.kind === 'ITEM'
                        ? `/manage/edit?id=${target.id}`
                        : `/manage/catalog?id=${target.id}`,
                    )
                  }
                  correctionAvailability={m.writeAvailability}
                  onCorrectionIntent={(event) => onIntent('history-correct', event.target_id)}
                />
                {!entry.operationComplete && (
                  <InlineNotice tone="warning" title="本次操作仅加载了部分事件">
                    <Button
                      variant="quiet"
                      onClick={() => onIntent('history-complete', entry.event!.operation_id)}
                    >
                      查看本次全部变化
                    </Button>
                  </InlineNotice>
                )}
              </section>
            ))}
          </section>
        ))
      )}
    </Frame>
  );
}
