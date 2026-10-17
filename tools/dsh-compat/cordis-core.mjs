// Cordis-compatible spatiotemporal composability core for Operit2 ToolPkg plugins.
// Implements the two axes from "A Programming Paradigm for Spatiotemporal Composability":
//   temporal: every registration is a reversible effect that unwinds on unload;
//   spatial: declared service dependencies reactively activate and deactivate components.

export const FiberState = Object.freeze({
  PENDING: 'pending',
  LOADING: 'loading',
  ACTIVE: 'active',
  FAILED: 'failed',
  UNLOADING: 'unloading',
  DISPOSED: 'disposed',
});

let fiberSequence = 0;

function normalizeInject(inject) {
  const required = [];
  const optional = [];
  for (const entry of inject || []) {
    if (typeof entry === 'string') {
      required.push(entry);
    } else if (entry && typeof entry === 'object') {
      if (entry.required) required.push(...[].concat(entry.required));
      if (entry.optional) optional.push(...[].concat(entry.optional));
    }
  }
  return { required, optional };
}

export class Fiber {
  constructor(context, label, plugin, config) {
    this.id = `fiber-${++fiberSequence}`;
    this.context = context;
    this.label = label;
    this.plugin = plugin;
    this.config = config;
    this.state = FiberState.PENDING;
    this.effects = [];
    this.children = [];
    this.error = null;
    this._mount();
  }

  get isDisposed() {
    return this.state === FiberState.DISPOSED;
  }

  dependencies() {
    return normalizeInject(typeof this.plugin === 'function' ? this.plugin.inject : this.plugin.inject);
  }

  _mount() {
    if (this.isDisposed) return;
    const { required } = this.dependencies();
    if (required.some(name => !this.context.hasService(name))) {
      // Spatial composability: stay pending until every declared service exists.
      this.context._pendingFibers.add(this);
      this.state = FiberState.PENDING;
      return;
    }
    this.state = FiberState.LOADING;
    const apply = typeof this.plugin === 'function'
      ? this.plugin
      : this.plugin.apply || this.plugin.setup;
    if (typeof apply !== 'function') {
      this.error = new Error(`Plugin ${this.label} does not expose apply(ctx)`);
      this.state = FiberState.FAILED;
      return;
    }
    this.context._activeFiberStack.push(this);
    try {
      apply(this.context);
      this.state = FiberState.ACTIVE;
    } catch (error) {
      this.error = error;
      this.state = FiberState.FAILED;
      this._disposeEffects();
    } finally {
      this.context._activeFiberStack.pop();
    }
  }

  _disposeEffects() {
    for (const dispose of this.effects.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`[cordis] effect disposer failed in ${this.label}:`, error);
      }
    }
  }

  dispose() {
    if (this.isDisposed) return;
    this.state = FiberState.UNLOADING;
    for (const child of this.children.splice(0).reverse()) child.dispose();
    this._disposeEffects();
    this.context._pendingFibers.delete(this);
    this.context._fibers.delete(this.id);
    this.state = FiberState.DISPOSED;
  }
}

export class Context {
  constructor(options = {}) {
    this.parent = options.parent || null;
    this.label = options.label || 'root';
    this._services = new Map();
    this._overrides = new Map();
    this._fibers = new Map();
    this._pendingFibers = new Set();
    this._listeners = new Map();
    this._children = new Set();
    this._activeFiberStack = [];
    this._disposed = false;
    if (this.parent) this.parent._children.add(this);
  }

  // ---- spatial composability: service registry and coeffect resolution ----

  provide(name, value) {
    const previous = this._services.get(name);
    const hadPrevious = this._services.has(name);
    this._services.set(name, value);
    this._defineServiceProperty(name);
    this._cascade('activate');
    return () => {
      if (hadPrevious) {
        this._services.set(name, previous);
      } else {
        this._services.delete(name);
        if (Object.prototype.hasOwnProperty.call(this, name)) {
          delete this[name];
        }
      }
      this._cascade('deactivate');
    };
  }

  // Cordis exposes services as ctx.<name>; keep that shape on every context.
  _defineServiceProperty(name) {
    if (name in this) return;
    Object.defineProperty(this, name, {
      configurable: true,
      enumerable: false,
      get: () => this.get(name),
    });
  }

  _syncInheritedServiceProperties() {
    for (let context = this.parent; context; context = context.parent) {
      for (const name of context._services.keys()) this._defineServiceProperty(name);
    }
  }

  get(name) {
    if (this._overrides.has(name)) return this._overrides.get(name);
    if (this._services.has(name)) return this._services.get(name);
    return this.parent ? this.parent.get(name) : undefined;
  }

  hasService(name) {
    return this.get(name) !== undefined;
  }

  // Creates an isolated child context whose overrides shadow the parent.
  isolate(label = 'isolated') {
    const child = new Context({ parent: this, label: `${this.label}/${label}` });
    child._syncInheritedServiceProperties();
    return child;
  }

  _selfAndDescendants() {
    const contexts = [this];
    for (const child of this._children) contexts.push(...child._selfAndDescendants());
    return contexts;
  }

  _cascade(action) {
    for (const context of this._selfAndDescendants()) {
      if (action === 'activate') {
        context._resolvePending();
      } else {
        context._deactivateDependents();
      }
    }
  }

  _resolvePending() {
    for (const fiber of [...this._pendingFibers]) {
      if (fiber.state !== FiberState.PENDING) {
        this._pendingFibers.delete(fiber);
        continue;
      }
      const { required } = fiber.dependencies();
      if (required.every(name => this.hasService(name))) {
        this._pendingFibers.delete(fiber);
        fiber._mount();
      }
    }
  }

  _deactivateDependents() {
    for (const fiber of [...this._fibers.values()]) {
      if (fiber.state !== FiberState.ACTIVE) continue;
      const { required } = fiber.dependencies();
      if (required.some(name => !this.hasService(name))) {
        // Spatial composability: losing a required service deactivates the dependent.
        fiber.dispose();
      }
    }
  }

  // ---- temporal composability: reversible registrations ----

  effect(fn) {
    if (typeof fn !== 'function') throw new Error('effect expects a function');
    const disposer = fn();
    if (typeof disposer === 'function') {
      this._currentFiber().effects.push(disposer);
    }
    return disposer;
  }

  on(event, listener, options = {}) {
    if (typeof listener !== 'function') throw new Error('on expects a listener function');
    const entry = { listener, once: Boolean(options.once) };
    const list = this._listeners.get(event) || [];
    list.push(entry);
    this._listeners.set(event, list);
    const dispose = () => {
      const current = this._listeners.get(event) || [];
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
    };
    this._currentFiber().effects.push(dispose);
    return dispose;
  }

  off(event, listener) {
    const list = this._listeners.get(event) || [];
    this._listeners.set(event, list.filter(entry => entry.listener !== listener));
  }

  _currentFiber() {
    const fiber = this._activeFiberStack[this._activeFiberStack.length - 1];
    if (!fiber) throw new Error('Registration requires an active plugin mount');
    return fiber;
  }

  // ---- typed event dispatch (emit/parallel/serial/bail/waterfall) ----

  emit(event, ...args) {
    for (const entry of [...(this._listeners.get(event) || [])]) {
      entry.listener(...args);
      if (entry.once) this.off(event, entry.listener);
    }
  }

  async parallel(event, ...args) {
    await Promise.all([...(this._listeners.get(event) || [])].map(entry => entry.listener(...args)));
  }

  async serial(event, ...args) {
    let result;
    for (const entry of [...(this._listeners.get(event) || [])]) {
      result = await entry.listener(...args);
    }
    return result;
  }

  bail(event, ...args) {
    for (const entry of [...(this._listeners.get(event) || [])]) {
      const value = entry.listener(...args);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  // Middleware chain: listeners receive (...args, next) and may short-circuit by returning.
  async waterfall(event, ...args) {
    const entries = [...(this._listeners.get(event) || [])];
    const invoke = async index => {
      if (index >= entries.length) return undefined;
      return entries[index].listener(...args, () => invoke(index + 1));
    };
    return invoke(0);
  }

  // ---- composition ----

  plugin(plugin, config) {
    const label = config?.name || (typeof plugin === 'function' ? plugin.name : plugin?.name) || `plugin-${fiberSequence + 1}`;
    const fiber = new Fiber(this, label, plugin, config);
    this._fibers.set(fiber.id, fiber);
    const parent = this._activeFiberStack[this._activeFiberStack.length - 1];
    if (parent && parent !== fiber) parent.children.push(fiber);
    return fiber;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const fiber of [...this._fibers.values()].reverse()) fiber.dispose();
    for (const child of [...this._children]) child.dispose();
    this._children.clear();
  }
}

// Starts one root context and mounts plugins in order.
export function createApp(plugins, options = {}) {
  const root = new Context({ label: options.label || 'app' });
  const list = Array.isArray(plugins) ? plugins : [plugins];
  for (const definition of list) {
    root.plugin(definition, definition?.config);
  }
  return root;
}

// Cordis-style base class: claims a stable context service and reverts it on unload.
export class Service {
  constructor(context, name) {
    this.ctx = context;
    this.name = name;
    context.effect(() => context.provide(name, this));
  }
}
