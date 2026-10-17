import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { unzipSync } from 'fflate';

const porter = fileURLToPath(new URL('../port-dsh-plugin.mjs', import.meta.url));

test('ports a Cordis plugin to an installable archive and executes its tool', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'operit-dsh-port-'));
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({
    name: 'echo-fixture', version: '1.0.0', type: 'module', main: 'index.mjs',
  }));
  await writeFile(path.join(fixture, 'index.mjs'), `
import { Service } from 'cordis';
export default {
  inject: { required: ['tools'] },
  async apply(ctx) {
    await Promise.resolve();
    ctx.tools.register({ name: 'echo', handler: ({ text }) => 'echo:' + text });
  },
};
`);
  const out = path.join(fixture, 'output');
  const result = spawnSync(process.execPath, [porter, fixture, '--out', out], {
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const files = unzipSync(await readFile(`${out}.toolpkg`));
  assert.deepEqual(Object.keys(files).sort(), ['dist/tools.js', 'main.js', 'manifest.json']);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  assert.equal(manifest.strict_dependencies, true);
  const unload = [];
  const host = {
    exports: {}, console, Tools: {},
    ToolPkg: { onUnload: handler => unload.push(handler) },
  };
  runInNewContext(new TextDecoder().decode(files['dist/tools.js']), host);
  assert.equal(await host.exports.echo({ text: 'hello' }), 'echo:hello');
  await unload[0]();
  assert.equal(host.__operitDshRuntime, undefined);
  const retry = spawnSync(process.execPath, [porter, fixture, '--out', out], { encoding: 'utf8' });
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /must be empty/);
});

test('unsupported required services fail packaging with a useful diagnostic', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'operit-dsh-missing-'));
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'missing', main: 'index.mjs' }));
  await writeFile(path.join(fixture, 'index.mjs'), `
export default { inject: ['llm'], apply() {} };
`);
  const result = spawnSync(process.execPath, [porter, fixture, '--out', path.join(fixture, 'output')], {
    encoding: 'utf8', timeout: 30000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported required services: llm/);
});
