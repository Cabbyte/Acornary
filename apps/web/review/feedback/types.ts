export interface FeedbackContext {
  component: string;
  name: string;
  scenario: string;
  preset: string;
  mode: string;
  viewport: number;
  version: string;
}
export interface FeedbackRecord extends FeedbackContext {
  id: string;
  text: string;
  createdAt: string;
}
