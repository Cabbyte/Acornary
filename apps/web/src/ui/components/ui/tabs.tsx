import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../utils';
import './controls.css';

// Source pattern: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/tabs.tsx
export const tabsListVariants = cva('vn-tabs-list', {
  variants: { variant: { default: 'vn-tabs-list--default', line: 'vn-tabs-list--line' } },
  defaultVariants: { variant: 'default' },
});
export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}
export interface TabsProps extends VariantProps<typeof tabsListVariants> {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly TabItem[];
  label?: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}
export function Tabs({
  value,
  onValueChange,
  items,
  label = '内容分类',
  orientation = 'horizontal',
  variant,
  className,
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
      orientation={orientation}
      className={cn('vn-tabs', className)}
    >
      <TabsPrimitive.List
        aria-label={label}
        className={tabsListVariants({ variant })}
        activateOnFocus={false}
      >
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className="vn-control vn-tab"
          >
            {item.label}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Panel
          key={item.value}
          value={item.value}
          keepMounted
          className="vn-tab-panel"
        >
          {item.content}
        </TabsPrimitive.Panel>
      ))}
    </TabsPrimitive.Root>
  );
}
