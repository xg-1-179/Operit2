import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Operit2 host stubs for the shim contract.
globalThis.Tools = {
  Files: {
    read: async path => ({ content: `content:${path}` }),
    write: async () => ({ success: true }),
    list: async () => ({ entries: [] }),
    exists: async () => ({ exists: true }),
    mkdir: async () => ({ success: true }),
    deleteFile: async () => ({ success: true }),
  },
  Net: {
    httpGet: async url => ({ status: 200, body: url }),
    httpPost: async (url, body) => ({ status: 200, body, url }),
    http: async options => ({ status: 200, options }),
  },
  Storage: { request: async request => ({ ok: true, request }) },
};
const unloadHandlers = [];
globalThis.ToolPkg = { onUnload: handler => unloadHandlers.push(handler) };
globalThis.getPluginConfigDir = () => '/dsh-config';

const { createHostContext, normalizeParameters, bootDshPlugin, invokeRuntimeTool, runtimeTools } =
  await import('../dsh-shim.mjs');

test('normalizes both parameter list and JSON schema forms', () => {
  assert.deepEqual(normalizeParameters([
    { name: 'q', type: 'string', required: true, description: 'query' },
  ]), [{ name: 'q', type: 'string', required: true, description: 'query' }]);
  assert.deepEqual(normalizeParameters({
    type: 'object',
    properties: { count: { type: 'integer', description: 'n' } },
    required: ['count'],
  }), [{ name: 'count', type: 'number', required: true, description: 'n' }]);
});

test('host context exposes tools, fs, http and config services', async () => {
  const root = createHostContext();
  assert.ok(root.get('tools'));
  assert.ok(root.get('fs'));
  assert.ok(root.get('http'));
  assert.ok(root.get('config'));
  assert.equal(await root.get('fs').read('/a'), 'content:/a');
  assert.equal((await root.get('http').get('https://example.test')).status, 200);
  assert.equal(await root.get('config').get('missing', 'fallback'), 'fallback');
  root.dispose();
});

test('mounted plugin registers a runtime tool and unwinds it on unload', async () => {
  runtimeTools.clear();
  const root = bootDshPlugin({
    name: 'fixture',
    apply(ctx) {
      ctx.tools.register({
        name: 'echo',
        description: 'Echo the input',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        handler: async ({ text }) => `echo:${text}`,
      });
    },
  });
  assert.ok(runtimeTools.has('echo'));
  assert.equal(await invokeRuntimeTool('echo', { text: 'hi' }), 'echo:hi');
  assert.equal(unloadHandlers.length, 1);
  globalThis.__operitDshRuntime = root; // keep boot memoization visible for unload
  await unloadHandlers[0]();
  assert.equal(runtimeTools.size, 0);
  delete globalThis.__operitDshRuntime;
});

test('tools follow their owning fiber through suspension and reactivation', async () => {
  const root = createHostContext();
  const remove = root.provide('provider', {});
  const fiber = root.plugin({
    inject: ['provider'],
    async apply(ctx) {
      await Promise.resolve();
      ctx.tools.register({ name: 'owned', handler: () => 'ok' });
    },
  });
  await fiber.ready;
  assert.ok(runtimeTools.has('owned'));
  remove();
  await fiber._stopping;
  assert.equal(runtimeTools.has('owned'), false);
  root.provide('provider', {});
  await fiber.ready;
  assert.ok(runtimeTools.has('owned'));
  await root.dispose();
  assert.equal(runtimeTools.has('owned'), false);
});
