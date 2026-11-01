import { useState } from 'react';
import {
  Button,
  EmptyState,
  FactChip,
  Field,
  IconButton,
  ItemRow,
  Metric,
  PageHeader,
  Section,
  Sheet,
  StatusTag,
  Toolbar,
} from '../../ui/primitives/index.js';

const items = [
  {
    name: '蒙牛鲜牛奶',
    facts: ['剩 1 L', '开封 3 天', '冷藏'],
    location: '厨房 / 冰箱 / 冷藏层',
    status: { tone: 'warning' as const, label: '临期 3 天' },
  },
  {
    name: '棉质短袖 T 恤',
    facts: ['M', '暖白', '棉'],
    location: '卧室 / 衣柜',
    status: { tone: 'success' as const, label: '可穿' },
  },
];

export default function KitchenSink() {
  const [open, setOpen] = useState(false);
  return (
    <div className="content">
      <PageHeader
        title="界面基线"
        subtitle="tokens + primitives 的可视检查页，不进入主导航"
        actions={<Button variant="primary">主操作</Button>}
      />
      <Section title="按钮" description="一屏只出现一个 primary；危险动作必须 danger。">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="primary">记录消耗</Button>
          <Button variant="secondary">移到位置</Button>
          <Button variant="quiet">取消</Button>
          <Button variant="danger">整件用完</Button>
          <Button variant="primary" disabled>
            禁用
          </Button>
        </div>
      </Section>
      <Section title="状态与事实">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <StatusTag tone="warning">临期 3 天</StatusTag>
          <StatusTag tone="danger">已过期</StatusTag>
          <StatusTag tone="success">可用</StatusTag>
          <StatusTag tone="info">已借出</StatusTag>
          <StatusTag>未记录</StatusTag>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <FactChip>剩 1 L</FactChip>
          <FactChip>冷藏</FactChip>
          <FactChip>开封 3 天</FactChip>
        </div>
      </Section>
      <Section title="指标">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
          <Metric label="剩余" value="1 L" hint="开封 3 天" />
          <Metric label="到期" value="11-05" hint="使用期限" />
          <Metric label="状态" value="可用" hint="未借出" />
        </div>
      </Section>
      <Section title="工具栏">
        <Toolbar
          search={<input aria-label="搜索物品" placeholder="搜索物品、规格、位置…" />}
          actions={<Button variant="primary">添加</Button>}
        >
          <Button variant="secondary">筛选 2</Button>
          <Button variant="quiet">排序</Button>
        </Toolbar>
      </Section>
      <Section title="物品行" description="单件一行；整行可点；事实最多三个。">
        <div style={{ borderTop: '1px solid var(--ac-line)' }}>
          {items.map((item) => (
            <ItemRow
              key={item.name}
              title={item.name}
              facts={item.facts}
              location={item.location}
              status={item.status}
              onOpen={() => undefined}
              overflow={<IconButton label={`${item.name} 的更多操作`} title="更多操作" icon="⋯" />}
            />
          ))}
        </div>
      </Section>
      <Section title="空状态">
        <EmptyState
          title="这里还没有物品"
          description="添加第一件物品，开始整理你的库存。"
          action={<Button variant="primary">添加物品</Button>}
        />
      </Section>
      <Section title="表单与 Sheet">
        <Field label="数量" hint="每件实物都有独立身份" required>
          <input inputMode="decimal" placeholder="1" />
        </Field>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          打开 Sheet
        </Button>
      </Section>
      {open && (
        <Sheet
          title="记录消耗"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="primary">确认记录消耗</Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
            </>
          }
        >
          <Field label="本次消耗量" hint="单位 mL">
            <input inputMode="decimal" placeholder="200" />
          </Field>
        </Sheet>
      )}
    </div>
  );
}
