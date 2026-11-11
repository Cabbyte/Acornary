import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps, ReviewScenario } from '../types';
import {
  AppShellDemo,
  AppearancePickerDemo,
  DesktopNavigationDemo,
  HouseholdSwitcherDemo,
  MobileNavigationDemo,
  ModeSwitcherDemo,
  appShellScenarios,
  appearancePickerScenarios,
  desktopNavigationScenarios,
  householdSwitcherScenarios,
  mobileNavigationScenarios,
  modeSwitcherScenarios,
} from './navigation-demos';

const meta = {
  id: 'rc1-navigation',
  title: 'RC6/导航与外观',
  args: { scenario: 'normal' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
const controls = (scenarios: readonly ReviewScenario[]) => ({
  scenario: {
    control: 'select' as const,
    options: scenarios.map(({ id }) => id),
    description: '切换实际传入组件的状态',
  },
});
export const ModeSwitcher: Story = {
  name: 'ModeSwitcher 使用模式切换',
  render: ModeSwitcherDemo,
  argTypes: controls(modeSwitcherScenarios),
};
export const AppearancePicker: Story = {
  name: 'AppearancePicker 界面配色选择',
  render: AppearancePickerDemo,
  argTypes: controls(appearancePickerScenarios),
};
export const DesktopNavigation: Story = {
  name: 'DesktopNavigation 桌面导航',
  render: DesktopNavigationDemo,
  argTypes: controls(desktopNavigationScenarios),
};
export const MobileNavigation: Story = {
  name: 'MobileNavigation 移动导航',
  render: MobileNavigationDemo,
  argTypes: controls(mobileNavigationScenarios),
};
export const HouseholdSwitcher: Story = {
  name: 'HouseholdSwitcher 家庭范围切换',
  render: HouseholdSwitcherDemo,
  argTypes: controls(householdSwitcherScenarios),
};
export const AppShell: Story = {
  name: 'AppShell 应用框架',
  render: AppShellDemo,
  argTypes: controls(appShellScenarios),
};
