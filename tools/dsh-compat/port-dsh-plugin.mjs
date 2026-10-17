#!/usr/bin/env node
// Ports a DeepSeek Harness (Cordis) plugin package into an Operit2 ToolPkg.
// Usage: node port-dsh-plugin.mjs <plugin-dir> [--out <dir>] [--entry <file>] [--no-pack]
//
// The port is self-contained: the generated ToolPkg embeds the Cordis-compatible
// runtime and the Operit2 service shim, so no app-side changes are required per plugin.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { pluginDir: null, out: null, entry: null, pack: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--out') args.out = argv[++index];
    else if (value === '--entry') args.entry = argv[++index];
    else if (value === '--no-pack') args.pack = false;
    else if (!value.startsWith('--')) args.pluginDir = value;
  }
  return args;
}

function fail(message) {
  console.error(`port-dsh-plugin: ${message}`);
  process.exit(1);
}

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    fail('esbuild is required. Run `npm install esbuild` (or `pnpm add -D esbuild`) in the plugin directory first.');
  }
}

async function captureTools(bundlePath) {
  const harness = `
globalThis.Tools = {
  Files: { read: async () => { throw new Error('capture'); }, write: async () => { throw new Error('capture'); },
           list: async () => { throw new Error('capture'); }, exists: async () => ({ exists: false }),
           mkdir: async () => ({ success: true }), deleteFile: async () => ({ success: true }) },
  Net: { httpGet: async () => { throw new Error('capture'); }, httpPost: async () => { throw new Error('capture'); },
         http: async () => { throw new Error('capture'); } },
  Storage: { request: async () => { throw new Error('capture'); } },
};
globalThis.ToolPkg = { onUnload: () => {} };
globalThis.getPluginConfigDir = () => '/dsh-config';
await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
if (typeof globalThis.__dshBoot !== 'function') throw new Error('bundle did not expose __dshBoot');
const runtime = globalThis.__dshBoot();
await runtime.fiber.ready;
const missing = globalThis.__dshMissingServices();
if (missing.length) throw new Error('Unsupported required services: ' + missing.join(', '));
if (runtime.fiber.error) throw runtime.fiber.error;
console.log(JSON.stringify(globalThis.__dshToolList()));
`;
  const scriptPath = path.join(path.dirname(bundlePath), 'capture.mjs');
  await writeFile(scriptPath, harness, 'utf8');
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail('plugin capture failed under Node; the plugin likely needs an unsupported service at mount time');
  }
  const line = result.stdout.trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    fail(`capture produced no tool list: ${line}`);
  }
}

function buildMetadata(packageName, tools) {
  return `/* METADATA ${JSON.stringify({
    name: packageName,
    display_name: { zh: packageName, en: packageName },
    description: { zh: `Port of dsh plugin ${packageName}`, en: `Port of dsh plugin ${packageName}` },
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.parameters || [],
    })),
  })} */
`;
}

function buildWrappers(tools) {
  return tools
    .map(tool => `exports[${JSON.stringify(tool.name)}] = async function(args) { return globalThis.__dshInvokeTool(${JSON.stringify(tool.name)}, args || {}); };`)
    .join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pluginDir) fail('usage: node port-dsh-plugin.mjs <plugin-dir> [--out <dir>] [--entry <file>] [--no-pack]');
  const pluginDir = path.resolve(args.pluginDir);
  const manifestPath = path.join(pluginDir, 'package.json');
  if (!existsSync(manifestPath)) fail(`missing package.json in ${pluginDir}`);
  const packageJson = JSON.parse(await readFile(manifestPath, 'utf8'));
  const packageName = String(packageJson.name || path.basename(pluginDir)).replace(/^@/, '').replace(/[\\/]/g, '.');
  const entry = path.resolve(pluginDir, args.entry || packageJson.module || packageJson.main || 'index.js');
  if (!existsSync(entry)) fail(`missing plugin entry: ${entry}`);

  const outDir = path.resolve(args.out || path.join('build', `${packageName}.toolpkg.src`));
  if (existsSync(outDir) && (await readdir(outDir)).length) {
    fail(`output directory must be empty: ${outDir}`);
  }
  await mkdir(path.join(outDir, 'dist'), { recursive: true });
  const buildDir = path.join(outDir, '.dsh-build');
  await mkdir(buildDir, { recursive: true });

  const wrapperPath = path.join(buildDir, 'entry.mjs');
  await writeFile(wrapperPath, `
import * as pluginModule from ${JSON.stringify(entry.replaceAll('\\', '/'))};
import { bootDshPlugin, invokeRuntimeTool, runtimeTools, unresolvedServices } from ${JSON.stringify(path.join(here, 'dsh-shim.mjs').replaceAll('\\', '/'))};
const mount = pluginModule.default || pluginModule.plugin || pluginModule;
globalThis.__dshBoot = () => bootDshPlugin(mount);
globalThis.__dshToolList = () => [...runtimeTools.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
globalThis.__dshMissingServices = () => unresolvedServices(bootDshPlugin(mount).root);
globalThis.__dshInvokeTool = async (name, payload) => { bootDshPlugin(mount); return invokeRuntimeTool(name, payload); };
globalThis.__dshPluginMeta = ${JSON.stringify({ name: packageName, version: packageJson.version || '0.0.0', dsh: packageJson.dsh || null })};
`, 'utf8');

  const esbuild = await loadEsbuild();
  const bundlePath = path.join(buildDir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [wrapperPath],
    outfile: bundlePath,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    legalComments: 'none',
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { cordis: path.join(here, 'cordis-core.mjs') },
  });

  const tools = await captureTools(bundlePath);
  if (tools.length === 0) {
    console.warn('warning: the plugin registered no tools at mount time; it may only provide hooks or services that Operit2 cannot expose.');
  }

  const bundleSource = await readFile(bundlePath, 'utf8');
  const toolId = `${packageName.replace(/[^A-Za-z0-9_.-]/g, '_')}_tools`;
  const metadata = buildMetadata(packageName, tools);
  await writeFile(path.join(outDir, 'dist', 'tools.js'), `${metadata}"use strict";\n${bundleSource}\n${buildWrappers(tools)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'main.js'), 'exports.registerToolPkg = function() {};\n', 'utf8');
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({
    schema_version: 1,
    toolpkg_id: `dsh.${packageName}`,
    version: packageJson.version || '0.0.0',
    api_version: '2.0.0',
    main: 'main.js',
    display_name: { zh: packageName, en: packageName },
    description: { zh: `DeepSeek Harness plugin ${packageName}`, en: `DeepSeek Harness plugin ${packageName}` },
    strict_dependencies: true,
    subpackages: [{ id: toolId, entry: 'dist/tools.js' }],
    resources: [],
  }, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'README.md'), [
    `# ${packageName} (dsh port)`,
    '',
    `Tools captured: ${tools.map(tool => tool.name).join(', ') || '(none)'}`,
    '',
    'Behavioral notes:',
    '- Runs on the bundled Cordis-compatible runtime with Operit2 service shims (tools/fs/http/config/logger/storage).',
    '- Unsupported dsh services keep the plugin pending; check the capture step output for missing services.',
    '- Node fs/http are mapped to asynchronous Operit2 APIs; synchronous filesystem calls are unsupported.',
    '- Package opts into strict_dependencies so disabling a provider reactively suspends this plugin.',
  ].join('\n'), 'utf8');

  let packPath = null;
  if (args.pack) {
    try {
      const { zipSync } = await import('fflate');
      const files = {};
      for (const relative of ['manifest.json', 'main.js', 'dist/tools.js']) {
        files[relative] = new Uint8Array(await readFile(path.join(outDir, relative)));
      }
      packPath = `${outDir}.toolpkg`;
      await writeFile(packPath, zipSync(files, { level: 6 }));
    } catch {
      console.warn('warning: fflate is unavailable; skipped .toolpkg packing. Pack the source directory with the repository plugin tool instead.');
    }
  }
  console.log(JSON.stringify({ packageName, outDir, toolCount: tools.length, tools: tools.map(tool => tool.name), toolpkg: packPath }, null, 2));
}

await main();
