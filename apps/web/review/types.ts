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
  kind?: 'component' | 'composition';
  name: string;
  group: string;
  description: string;
  component: ComponentType<ReviewDemoProps>;
  scenarios: readonly ReviewScenario[];
  status?: '待审阅';
  limitations?: string;
  storyId?: string;
}
