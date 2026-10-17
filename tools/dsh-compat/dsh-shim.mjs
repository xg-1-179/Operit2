// Maps the DeepSeek Harness (Cordis) service surface onto Operit2 ToolPkg globals.
// Only services that Operit2 can actually back are provided; anything else keeps the
// dependent plugin pending so the porting report can list it as unsupported.

import { Context, Service, createApp, FiberState } from './cordis-core.mjs';

export const runtimeTools = new Map();

function requireGlobals() {
  if (typeof Tools === 'undefined' || typeof ToolPkg === 'undefined') {
    throw new Error('This runtime must execute inside an Operit2 ToolPkg context');
  }
}

function normalizeType(type) {
  const value = String(type || 'string').toLowerCase();
  if (value === 'integer') return 'number';
  if (value === 'boolean') return 'boolean';
  if (value === 'number' || value === 'string' || value === 'array' || value === 'object') return value;
  return 'string';
}

// Accepts either Operit2's parameter list or a JSON-schema object.
export function normalizeParameters(parameters) {
  if (Array.isArray(parameters)) {
    return parameters.map(parameter => ({
      name: String(parameter.name || parameter.key || '').trim(),
      type: normalizeType(parameter.type),
      required: Boolean(parameter.required),
      description: String(parameter.description || parameter.desc || ''),
    })).filter(parameter => parameter.name);
  }
  if (parameters && typeof parameters === 'object' && parameters.properties) {
    const required = new Set(parameters.required || []);
    return Object.entries(parameters.properties).map(([name, schema]) => ({
      name,
      type: normalizeType(schema?.type),
      required: required.has(name),
      description: String(schema?.description || ''),
    }));
  }
  return [];
}

function normalizeDescription(description) {
  if (description && typeof description === 'object') {
    return description;
  }
  return String(description || '');
}

class ToolsService {
  constructor(context) {
    this.ctx = context;
    this.definitions = runtimeTools;
  }

  forContext(context) {
    const scoped = Object.create(this);
    scoped.ctx = context;
    return scoped;
  }

  register(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('ctx.tools.register requires a definition object');
    }
    const name = String(definition.name || '').trim();
    if (!name) throw new Error('Tool definition requires a name');
    const handler = definition.handler || definition.execute || definition.run;
    if (typeof handler !== 'function') {
      throw new Error(`Tool ${name} requires a handler function`);
    }
    const entry = {
      name,
      description: normalizeDescription(definition.description),
      parameters: normalizeParameters(definition.parameters || definition.schema),
      handler,
    };
    return this.ctx.effect(() => {
      if (runtimeTools.has(name)) throw new Error(`Tool is already registered: ${name}`);
      runtimeTools.set(name, entry);
      return () => {
        if (runtimeTools.get(name) === entry) runtimeTools.delete(name);
      };
    });
  }

  list() {
    return [...runtimeTools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  async call(name, args) {
    const entry = runtimeTools.get(name);
    if (!entry) throw new Error(`Tool is not registered: ${name}`);
    return entry.handler(args || {});
  }
}

class FilesService {
  async read(path) {
    requireGlobals();
    const result = await Tools.Files.read(path);
    return result?.content ?? result;
  }

  async write(path, content) {
    requireGlobals();
    return Tools.Files.write(path, String(content));
  }

  async list(path) {
    requireGlobals();
    return Tools.Files.list(path);
  }

  async exists(path) {
    requireGlobals();
    const result = await Tools.Files.exists(path);
    return Boolean(result?.exists);
  }

  async mkdir(path) {
    requireGlobals();
    return Tools.Files.mkdir(path, true);
  }

  async remove(path, recursive = false) {
    requireGlobals();
    return Tools.Files.deleteFile(path, recursive);
  }
}

class HttpService {
  async get(url) {
    requireGlobals();
    return Tools.Net.httpGet(url);
  }

  async post(url, body) {
    requireGlobals();
    return Tools.Net.httpPost(url, body);
  }

  async request(options) {
    requireGlobals();
    return Tools.Net.http(options);
  }
}

class ConfigService {
  constructor() {
    this.cache = null;
  }

  _path() {
    requireGlobals();
    return `${getPluginConfigDir()}/dsh-config.json`;
  }

  async all() {
    if (this.cache) return this.cache;
    try {
      const raw = await new FilesService().read(this._path());
      this.cache = JSON.parse(raw || '{}');
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  async get(key, fallback) {
    const values = await this.all();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
  }

  async set(key, value) {
    const values = await this.all();
    values[key] = value;
    this.cache = values;
    await new FilesService().write(this._path(), JSON.stringify(values));
  }
}

class LoggerService {
  info(...args) { console.log('[dsh]', ...args); }
  warn(...args) { console.warn('[dsh]', ...args); }
  error(...args) { console.error('[dsh]', ...args); }
  debug(...args) { console.debug('[dsh]', ...args); }
}

class StorageService {
  async request(request) {
    requireGlobals();
    return Tools.Storage.request(request);
  }
}

// Builds the host context used both for packaging-time capture and runtime mounting.
export function createHostContext(options = {}) {
  const root = new Context({ label: options.label || 'dsh' });
  const toolsService = new ToolsService(root);
  const filesService = new FilesService();
  const httpService = new HttpService();
  const configService = new ConfigService();
  const loggerService = new LoggerService();
  const storageService = new StorageService();
  // Services are registered as plain values; disposers are not needed for the host.
  root.provide('tools', toolsService);
  root.provide('fs', filesService);
  root.provide('http', httpService);
  root.provide('config', configService);
  root.provide('logger', loggerService);
  root.provide('storage', storageService);
  return root;
}

// Boots a ported plugin once per engine and wires Operit2's unload hook to Cordis disposal.
export function bootDshPlugin(mount) {
  const runtime = globalThis.__operitDshRuntime;
  if (runtime) return runtime;
  const root = createHostContext();
  // The plugin is a Cordis component: a function with inject + apply(ctx).
  const fiber = root.plugin(mount, { name: mount?.name || 'dsh-plugin' });
  const booted = { root, fiber, tools: runtimeTools };
  globalThis.__operitDshRuntime = booted;
  if (typeof ToolPkg.onUnload === 'function') {
    ToolPkg.onUnload(async () => {
      await root.dispose();
      runtimeTools.clear();
      globalThis.__operitDshRuntime = undefined;
    });
  }
  return booted;
}

// Invoked by generated ToolPkg tool wrappers.
export async function invokeRuntimeTool(name, args) {
  await globalThis.__operitDshRuntime?.fiber.ready;
  const entry = runtimeTools.get(name);
  if (!entry) throw new Error(`Runtime tool is not registered: ${name}`);
  return entry.handler(args || {});
}

// Reports which declared services never resolved (used by the porting tool).
export function unresolvedServices(root) {
  const missing = new Set();
  for (const fiber of root._pendingFibers || []) {
    for (const name of fiber.dependencies().required) {
      if (!root.hasService(name)) missing.add(name);
    }
  }
  return [...missing];
}
