export interface FeedbackContext {
  component: string;
  name: string;
  scenario: string;
  preset: string;
  mode: string;
  viewport: number;
  version: string;
  /** Optional page-preview route, for reproducing the exact object/query/tab. */
  route?: string;
  source?: 'trial';
  datasetVersion?: string;
  taskStage?: string;
}
export interface FeedbackRecord extends FeedbackContext {
  id: string;
  text: string;
  createdAt: string;
}
