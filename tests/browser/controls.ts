import type { Page, FrameLocator } from '@playwright/test';
/** Ant Select exposes a combobox and options, including inside an opaque MCP iframe. */
export async function choose(surface: Page | FrameLocator, label: string, option: string) {
  await surface.getByRole('combobox', { name: label, exact: true }).click();
  await surface.getByRole('option', { name: option, exact: true }).click();
}
