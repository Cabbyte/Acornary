import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { read, write } from '../apps/web/src/lib/api.js';

const store = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
};

describe('HTTP protocol header', () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('sessionStorage', store());
    vi.stubGlobal('localStorage', store());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'X-Request-ID': 'request-test' },
        });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends v2 POST reads without a v1 query transport', async () => {
    await read('get_connection_context', {});
    expect(calls[0].url).toBe('/api/read/get_connection_context');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe('{}');
    expect(new Headers(calls[0].init?.headers).get('X-Acornary-Protocol')).toBe('2');
  });

  it('sends the header and web CSRF marker on writes', async () => {
    await write('update_item', { item_id: 'item_11111111-1111-4111-8111-111111111111' });
    const headers = new Headers(calls[0].init?.headers);
    expect(calls[0].url).toBe('/api/write/update_item');
    expect(headers.get('X-Acornary-Protocol')).toBe('2');
    expect(headers.get('X-Acornary-Request')).toBe('web');
  });
});
