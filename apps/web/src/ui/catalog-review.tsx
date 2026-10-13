import { Alert, Button, Card, Descriptions, Space } from 'antd';
import { useEffect, useState } from 'react';
import { governance, read } from '../lib/api';
import { useSession } from '../lib/session';
import { useInventory } from '../lib/inventory';

export function CatalogReview({
  proposalId,
  onApproved,
}: {
  proposalId: string;
  onApproved: (id: string) => void;
}) {
  const { session } = useSession();
  const { data } = useInventory();
  const [review, setReview] = useState<any>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = (id: string) =>
    data.catalog.find((n) => n.id === id)?.name ??
    data.items.find((n) => n.id === id)?.display_name ??
    id;
  const load = () => {
    setReview(undefined);
    setError('');
    return governance<any>('review', { proposal_id: proposalId })
      .then(setReview)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    let active = true;
    setReview(undefined);
    setError('');
    void governance<any>('review', { proposal_id: proposalId })
      .then((v) => {
        if (active) setReview(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [proposalId, session.cache_key]);
  const identityLabels: Record<string, string> = {
    'product.brand': '品牌',
    'product.model': '型号',
    'product.specification': '固定规格',
    'product.net_content': '标称净含量',
    'clothing.material': '材质',
    'clothing.color': '颜色',
    'clothing.size': '尺码',
    'device.connector': '接口',
    'device.rated_power_w': '额定功率',
  };
  const proposal = review?.proposal;
  const rule = proposal?.rule;
  const previous = review?.policy?.rules?.find((r: any) => r.branch_id === rule?.branch_id);
  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await governance<any>('confirm', {
        proposal_id: proposalId,
        challenge: review.challenge,
      });
      onApproved(result.approval_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="分类变更确认" size="small" style={{ margin: '12px 0' }}>
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => void load()}>重新核对</Button>}
        />
      )}
      {proposal && (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <p>{proposal.reason}</p>
          <strong>{review.effect}</strong>
          {rule ? (
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: 'branch', label: '适用分类', children: title(rule.branch_id) },
                {
                  key: 'standard',
                  label: '确认时标准名称',
                  children: rule.standard_name ?? title(rule.branch_id),
                },
                { key: 'meaning', label: '含义', children: rule.meaning },
                { key: 'boundary', label: '边界', children: rule.boundaries },
                { key: 'basis', label: '划分依据', children: rule.subdivision_basis },
                {
                  key: 'direct',
                  label: '直接挂商品',
                  children: rule.allow_direct_products ? '允许，优先沿用' : '不允许',
                },
                {
                  key: 'extend',
                  label: '分类扩展',
                  children: rule.allow_new_groups
                    ? `允许在分支内扩展，最多 ${rule.max_new_depth} 层`
                    : '不允许自动新增分类',
                },
                {
                  key: 'names',
                  label: '命名约束',
                  children: `${rule.naming_guidance}；禁止名称：${rule.forbidden_names.join('、') || '无'}`,
                },
                {
                  key: 'aliases',
                  label: '已确认别名',
                  children:
                    rule.aliases
                      .map((a: any) => `${a.name} → ${title(a.catalog_node_id)}`)
                      .join('；') || '无',
                },
                {
                  key: 'identity',
                  label: '区分同款的属性',
                  children:
                    rule.identity_fields.map((f: string) => identityLabels[f] ?? f).join('、') ||
                    '仅名称；同名有歧义时澄清',
                },
                {
                  key: 'legacy',
                  label: '历史例外',
                  children: rule.legacy_exceptions.map(title).join('、') || '无',
                },
              ]}
            />
          ) : proposal.kind === 'intake_exception' ? (
            <ul>
              {proposal.intake.lines.map((line: any, i: number) => (
                <li key={i}>
                  {line.product.name ?? title(line.product.catalog_node_id)} ·{' '}
                  {line.instances.reduce((n: number, instance: any) => n + instance.count, 0)} 件 ·{' '}
                  {line.product.parent_id ? title(line.product.parent_id) : '沿用已有归类'}
                  {line.product.new_groups?.length
                    ? ` / ${line.product.new_groups.join(' / ')}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: 'operation',
                  label: '操作',
                  children: (
                    {
                      create_catalog_node: '独立创建目录',
                      update_catalog_node: '修改目录名称',
                      move_catalog_node: '移动目录',
                      bind_attributes: '绑定商品资料',
                      update_attributes: '修改商品资料',
                      remove_attributes: '移除商品资料',
                      correct_item: '纠正实物所属商品',
                    } as Record<string, string>
                  )[proposal.operation],
                },
                {
                  key: 'target',
                  label: '对象',
                  children:
                    proposal.input.name ??
                    title(
                      proposal.input.catalog_node_id ??
                        proposal.input.target?.id ??
                        proposal.input.item_id ??
                        '',
                    ),
                },
                {
                  key: 'parent',
                  label: '目标分类',
                  children: proposal.input.parent_id
                    ? title(proposal.input.parent_id)
                    : '未指定或根目录',
                },
              ]}
            />
          )}
          {previous && (
            <details>
              <summary>查看原有规则</summary>
              <p>
                {previous.meaning} · {previous.boundaries} · {previous.subdivision_basis}
              </p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(previous, null, 2)}</pre>
            </details>
          )}
          <details>
            <summary>核对全部变更、逐件差异与依赖版本</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(proposal, null, 2)}
            </pre>
          </details>
          <p>
            {rule
              ? '规则只约束今后的操作，不移动或修正旧记录。'
              : '授权只适用于上述内容。确认后仍需提交原操作；本卡片不创建目录或实物。'}
          </p>
          <Button
            type="primary"
            loading={busy}
            disabled={session.can_write === false}
            onClick={() => void approve()}
          >
            {rule ? '保存为长期规则' : '仅批准本次'}
          </Button>
        </Space>
      )}
    </Card>
  );
}
export function PendingCatalogReviews() {
  const { session } = useSession();
  const { data } = useInventory();
  const [pending, setPending] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    void read<any>('get_catalog_policy', {})
      .then((p) => {
        if (active) setPending(p.pending_proposals);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session.cache_key, data.cached_at]);
  if (session.can_write === false) return null;
  return (
    <>
      {pending.map((p) => (
        <CatalogReview
          key={p.id}
          proposalId={p.id}
          onApproved={() => setPending((rows) => rows.filter((r) => r.id !== p.id))}
        />
      ))}
    </>
  );
}
