import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  fieldsEntries,
  CalendarDemo,
  DateInputDemo,
  SearchBarDemo,
  FilterBarDemo,
  QuantityInputDemo,
  DateFactFieldDemo,
  CatalogPickerDemo,
  LocationPickerDemo,
} from './fields-demos';
const meta = {
  id: 'rc1-fields',
  title: 'RC1/领域输入',
  parameters: { layout: 'padded' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
function settings(id: string) {
  const entry = fieldsEntries.find((entry) => entry.id === id)!;
  return {
    args: { scenario: entry.scenarios[0].id },
    argTypes: {
      scenario: {
        options: entry.scenarios.map((s) => s.id),
        control: {
          type: 'select' as const,
          labels: Object.fromEntries(entry.scenarios.map((s) => [s.id, s.label])),
        },
      },
    },
  };
}
export const Calendar: Story = { ...settings('calendar'), name: '日历', render: CalendarDemo };
export const DateInput: Story = {
  ...settings('date-input'),
  name: '日期输入',
  render: DateInputDemo,
};
export const SearchBar: Story = {
  ...settings('search-bar'),
  name: '搜索栏',
  render: SearchBarDemo,
};
export const FilterBar: Story = {
  ...settings('filter-bar'),
  name: '筛选栏',
  render: FilterBarDemo,
};
export const QuantityInput: Story = {
  ...settings('quantity-input'),
  name: '数量输入',
  render: QuantityInputDemo,
};
export const DateFactField: Story = {
  ...settings('date-fact-field'),
  name: '日期事实字段',
  render: DateFactFieldDemo,
};
export const CatalogPicker: Story = {
  ...settings('catalog-picker'),
  name: '目录选择器',
  render: CatalogPickerDemo,
};
export const LocationPicker: Story = {
  ...settings('location-picker'),
  name: '位置选择器',
  render: LocationPickerDemo,
};
