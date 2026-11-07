export type ReviewStatus = '实现中' | '待审阅' | '需修改' | '已批准' | '变更后待复审';
import type { ComponentType } from 'react';
export interface ReviewDemoProps {
  scenario: string;
}
export interface ReviewScenario {
  id: string;
  label: string;
}
export interface ReviewEntry {
  id: string;
  kind?: 'component' | 'composition' | 'page';
  version?: string;
  source?: string;
  name: string;
  group: string;
  description: string;
  component: ComponentType<ReviewDemoProps>;
  scenarios: readonly ReviewScenario[];
  status?: ReviewStatus;
  limitations?: string;
  storyId?: string;
}
