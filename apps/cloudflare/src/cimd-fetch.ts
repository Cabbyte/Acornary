import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';

/** Host validation is defense in depth. DNS resolution and private-network exclusion belong to
 * Workers' global_fetch_strictly_public boundary, which must be enabled on every deployment.
 * This transport does not claim to reproduce the former Node DNS-pinning implementation. */
export const fetchClientMetadataResource: ClientMetadataResourceFetch = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !isPublicRoutableHost(url.hostname)
  )
    throw new TypeError('CIMD requires a public HTTPS resource');
  if (!['GET', 'HEAD'].includes(request.method))
    throw new TypeError('CIMD supports GET and HEAD only');
  const headers = new Headers();
  for (const name of ['accept', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(url, {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
  });
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    await response.body?.cancel();
    throw new TypeError('CIMD redirects are forbidden');
  }
  if (request.method === 'HEAD' || [204, 205, 304].includes(response.status))
    return new Response(null, { status: response.status, headers: response.headers });
  // CIMD itself enforces 5 KiB for documents; its JWK fetcher allows up to 64 KiB.
  const maximum = 64 * 1024,
    reader = response.body?.getReader(),
    bytes = new Uint8Array(maximum);
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (size + chunk.value.byteLength > maximum)
          throw new TypeError('CIMD resource is too large');
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.set('content-length', String(size));
  return new Response(bytes.slice(0, size), { status: response.status, headers: responseHeaders });
};
