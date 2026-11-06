import { SearchComposition } from '../compositions/search';
import { FormComposition } from '../compositions/form';
import { OperationComposition } from '../compositions/operation';
import { ManagementComposition } from '../compositions/management';
import { ShellComposition } from '../compositions/shell';
import type { ReviewEntry } from '../types';
import '../compositions/compositions.css';
export {
  SearchComposition,
  FormComposition,
  OperationComposition,
  ManagementComposition,
  ShellComposition,
};
export const compositionEntries: ReviewEntry[] = [
  {
    id: 'composition-search',
    kind: 'composition',
    name: '组合 · 搜索与物品列表',
    group: '组合场景',
    description: '搜索、筛选、商品摘要、独立实物与分页的协调性。',
    component: SearchComposition,
    storyId: 'rc1-compositions--search',
    scenarios: [
      { id: 'normal', label: '搜索与结果' },
      { id: 'empty', label: '无匹配' },
      { id: 'loading', label: '读取中' },
      { id: 'offline', label: '缓存子集' },
    ],
  },
  {
    id: 'composition-form',
    kind: 'composition',
    name: '组合 · 小型物品表单',
    group: '组合场景',
    description: 'React Hook Form＋Zod 局部字段，复用数量、日期和位置组件。',
    component: FormComposition,
    storyId: 'rc1-compositions--form',
    scenarios: [
      { id: 'normal', label: '填写与核对' },
      { id: 'errors', label: '字段错误' },
      { id: 'unknown', label: '未知事实' },
      { id: 'readonly', label: '只读' },
    ],
  },
  {
    id: 'composition-operation',
    kind: 'composition',
    name: '组合 · 操作与恢复面板',
    group: '组合场景',
    description: '同一任务容器展示审批、冲突、提交、未知结果与传入回执。',
    component: OperationComposition,
    storyId: 'rc1-compositions--operation',
    scenarios: [
      { id: 'draft', label: '填写与核对' },
      { id: 'approvalRequired', label: '需要批准' },
      { id: 'revisionConflict', label: '版本冲突' },
      { id: 'validating', label: '核对中 · 5秒后可离开' },
      { id: 'submitting', label: '提交中 · 5秒后可离开' },
      { id: 'networkUnknown', label: '结果不确定' },
      { id: 'success', label: '传入示例回执' },
      { id: 'offline', label: '离线' },
      { id: 'validationError', label: '字段校验错误' },
      { id: 'forbidden', label: '无权访问' },
      { id: 'sessionChanged', label: '身份已变化' },
    ],
  },
  {
    id: 'composition-management',
    kind: 'composition',
    name: '组合 · 管理选择场景',
    group: '组合场景',
    description: '目录树、受控分页表格、隐藏选择和实际影响身份范围。',
    component: ManagementComposition,
    storyId: 'rc1-compositions--management',
    scenarios: [
      { id: 'normal', label: '逐件选择' },
      { id: 'hidden', label: '隐藏选择' },
      { id: 'over-limit', label: '101件阻断' },
      { id: 'unknown-total', label: '总数未知' },
    ],
  },
  {
    id: 'composition-shell',
    kind: 'composition',
    name: '组合 · 双模式 Shell',
    group: '组合场景',
    description: '模式、配色、家庭入口和响应式导航，保持同一表单实例。',
    component: ShellComposition,
    storyId: 'rc1-compositions--shell',
    scenarios: [
      { id: 'normal', label: '连续输入与切换' },
      { id: 'long-text', label: '长家庭名' },
      { id: 'pending', label: '提交中切换守卫' },
      { id: 'recovery', label: '保留恢复入口' },
    ],
  },
];
