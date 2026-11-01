import { expect, type Page } from '@playwright/test';
// Synthetic setup explicitly follows the same authenticated HTTP UI capability flow.
export async function fixtureCommand(page: Page, operation: string, input: any) {
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-Acornary-Request': 'web',
    'X-Acornary-Protocol': '2',
    'X-Acornary-Household': await page.evaluate(
      () => sessionStorage.getItem('acornary-household') ?? '',
    ),
  };
  const post = async (path: string, data: any) => {
    const r = await page.request.post(path, { headers, data });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const data = { idempotency_key: crypto.randomUUID(), ...input };
  if (
    ['create_catalog_node', 'update_catalog_node', 'move_catalog_node'].includes(operation) ||
    (['bind_attributes', 'update_attributes', 'remove_attributes', 'upgrade_attributes'].includes(
      operation,
    ) &&
      input.target?.kind === 'CATALOG_NODE')
  ) {
    const proposal = await post('/api/write/propose_catalog_change', {
      idempotency_key: crypto.randomUUID(),
      proposal: {
        kind: 'catalog_command',
        operation,
        input: data,
        reason: 'Synthetic browser fixture',
      },
    });
    const review = await post('/api/ui/catalog-review', { proposal_id: proposal.proposal_id });
    const result = await post('/api/ui/catalog-confirm', {
      proposal_id: proposal.proposal_id,
      challenge: review.challenge,
    });
    data.approval_id = result.approval_id;
  }
  return post(`/api/write/${operation}`, data);
}

/** Read through the current protocol with the browser's selected household. */
export async function fixtureRead(page: Page, operation?: string, input: any = {}) {
  const headers = {
    'X-Acornary-Protocol': '2',
    'X-Acornary-Household': await page.evaluate(
      () => sessionStorage.getItem('acornary-household') ?? '',
    ),
  };
  const response = operation
    ? await page.request.post(`/api/read/${operation}`, { headers, data: input })
    : await page.request.get('/api/ui/snapshot', { headers });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
