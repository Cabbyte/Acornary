const host = (window.host = {
  family: 0,
  saved: undefined,
  context: null,
  calls: [],
  contextUpdates: [],
  failContext: 0,
  sizes: [],
  storage: 'ok',
  readonly: false,
  expired: false,
  failReads: 0,
  failReadsAfterWrite: 0,
  loseWrite: false,
  delayed: 0,
  async rpc(method, params) {
    const response = await fetch('/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params, family: this.family }),
    });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  },
  async call(name, args = {}) {
    return this.rpc('tools/call', { name, arguments: args });
  },
  notify(result) {
    this.frame.contentWindow.postMessage(
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
      '*',
    );
  },
  async mount() {
    this.frame?.remove();
    this.initial = await this.call('open_inventory');
    if (this.readonly) this.initial._meta['acornary/view'].session.can_write = false;
    const tools = await this.rpc('tools/list', {});
    const opener = tools.tools.find((t) => t.name === 'open_inventory');
    const resource = await this.rpc('resources/read', { uri: opener._meta.ui.resourceUri });
    this.resource = resource;
    const bootstrap = `<script>(()=>{let state=${JSON.stringify(this.saved ?? null).replace(/</g, '\\u003c')};window.openai={get widgetState(){return state},setWidgetState(next){if(${JSON.stringify(this.storage)}==='fail')throw Error('mock storage unavailable');if(${JSON.stringify(this.storage)}==='drop')return;if(${JSON.stringify(this.storage)}==='commit-fail'&&Object.values(next.privateContent.acornary.records).some(d=>d.result))throw Error('committed state persistence failed');state=structuredClone(next);parent.postMessage({kind:'widget-state',state},'*')}}})();</script>`;
    this.frame = document.createElement('iframe');
    this.frame.id = 'inventory';
    this.frame.sandbox = 'allow-scripts';
    this.frame.srcdoc = resource.contents[0].text.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">` +
        bootstrap,
    );
    document.body.append(this.frame);
  },
});
window.addEventListener('message', async (event) => {
  if (event.source !== host.frame?.contentWindow) return;
  const request = event.data;
  if (request.kind === 'widget-state') {
    host.saved = structuredClone(request.state);
    return;
  }
  if (request.method === 'ui/notifications/size-changed') {
    host.sizes.push(request.params);
    return;
  }
  if (request.method === 'ui/notifications/initialized') {
    host.notify(host.initial);
    return;
  }
  if (!request.method || request.id === undefined) return;
  const source = event.source;
  const reply = (result) => source.postMessage({ jsonrpc: '2.0', id: request.id, result }, '*');
  const error = (code) => ({
    isError: true,
    content: [{ type: 'text', text: code }],
    structuredContent: { error: { code, message: code } },
  });
  try {
    if (request.method === 'ui/initialize')
      return reply({
        protocolVersion: request.params.protocolVersion,
        hostInfo: { name: 'Acornary isolated test host', version: '1' },
        hostCapabilities: {
          serverTools: {},
          serverResources: {},
          updateModelContext: { text: {} },
        },
        hostContext: {
          displayMode: 'inline',
          availableDisplayModes: ['fullscreen'],
          theme: 'light',
          locale: 'zh-CN',
        },
      });
    if (request.method === 'ui/request-display-mode') {
      host.mode = request.params.mode;
      return reply({ mode: request.params.mode });
    }
    if (request.method === 'ui/update-model-context') {
      if (host.failContext > 0) {
        host.failContext--;
        source.postMessage(
          {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message: 'Transient context failure' },
          },
          '*',
        );
        return;
      }
      host.context = request.params.structuredContent;
      host.contextUpdates.push(request.params);
      return reply({});
    }
    if (request.method === 'tools/call') {
      const { name } = request.params;
      host.calls.push(structuredClone(request.params));
      if (host.expired) return reply(error('UNAUTHORIZED'));
      if (name === 'get_inventory_view' && host.failReads > 0) {
        host.failReads--;
        return reply(error('NETWORK'));
      }
      const result = await host.rpc('tools/call', request.params);
      if (result.structuredContent?.operation_id && host.failReadsAfterWrite) {
        host.failReads = host.failReadsAfterWrite;
        host.failReadsAfterWrite = 0;
      }
      if (name === 'get_inventory_view' && host.readonly && result._meta)
        result._meta['acornary/view'].session.can_write = false;
      if (result.structuredContent?.operation_id && host.loseWrite) {
        host.loseWrite = false;
        return reply(error('NETWORK'));
      }
      if (host.delayed) await new Promise((resolve) => setTimeout(resolve, host.delayed));
      return reply(result);
    }
    reply({});
  } catch (failure) {
    source.postMessage(
      { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(failure) } },
      '*',
    );
  }
});
void host.mount();
