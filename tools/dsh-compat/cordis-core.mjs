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
  for (const entry of Array.isArray(inject) ? inject : inject ? [inject] : []) {
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
    this.context = context._context || context;
    this.label = label;
    this.plugin = plugin;
    this.config = config;
    this.state = FiberState.PENDING;
    this.effects = [];
    this.children = [];
    this.error = null;
    this.scope = Object.create(this.context);
    this.scope._context = this.context;
    this.scope._owner = this;
    this.ready = Promise.resolve();
  }

  get isDisposed() {
    return this.state === FiberState.DISPOSED;
  }

  dependencies() {
    return normalizeInject(typeof this.plugin === 'function' ? this.plugin.inject : this.plugin.inject);
  }

  _mount() {
    if (this.isDisposed || this.context._disposed) return;
    const { required } = this.dependencies();
    if (required.some(name => !this.context.hasService(name))) {
      // Spatial composability: stay pending until every declared service exists.
      this.context._pendingFibers.add(this);
      this.state = FiberState.PENDING;
      return;
    }
    this.state = FiberState.LOADING;
    this.error = null;
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
      const result = this.plugin.prototype instanceof Service
        ? new this.plugin(this.scope, this.config)
        : apply(this.scope, this.config);
      const finish = disposer => {
        if (typeof disposer === 'function') this.effects.push(disposer);
        if (this.state === FiberState.LOADING) this.state = FiberState.ACTIVE;
      };
      if (result && typeof result.then === 'function') {
        this.ready = Promise.resolve(result).then(finish, error => {
          this.error = error;
          if (this.state === FiberState.LOADING) this.state = FiberState.FAILED;
          return this._disposeEffects();
        });
      } else {
        finish(result);
      }
    } catch (error) {
      this.error = error;
      this.state = FiberState.FAILED;
      this._disposeEffects();
    } finally {
      this.context._activeFiberStack.pop();
    }
  }

  _disposeEffects() {
    let pending;
    for (const dispose of this.effects.splice(0).reverse()) {
      const run = () => {
        try {
          return Promise.resolve(dispose()).catch(error => {
            console.error(`[cordis] effect disposer failed in ${this.label}:`, error);
          });
        } catch (error) {
          console.error(`[cordis] effect disposer failed in ${this.label}:`, error);
        }
      };
      // Invoke synchronous cleanup immediately, but await async effects in order.
      pending = pending ? pending.then(run) : run();
    }
    return pending;
  }

  _stop(permanent) {
    this._permanentStop ||= permanent;
    if (this.isDisposed || this.state === FiberState.UNLOADING) return this._stopping;
    const loading = this.state === FiberState.LOADING;
    this.state = FiberState.UNLOADING;
    const finish = async () => {
      for (const child of this.children.splice(0).reverse()) await child.dispose();
      await this._disposeEffects();
      if (this._permanentStop || this.context._disposed) {
        this.context._pendingFibers.delete(this);
        this.context._fibers.delete(this.id);
        this.state = FiberState.DISPOSED;
      } else {
        this.state = FiberState.PENDING;
        this.context._pendingFibers.add(this);
        this.context._resolvePending();
      }
    };
    this._stopping = loading ? this.ready.then(finish) : finish();
    return this._stopping;
  }

  dispose() { return this._stop(true); }

  suspend() { return this._stop(false); }
}

export class Context {
  constructor(options = {}) {
    this.parent = options.parent || null;
    this.label = options.label || 'root';
    this._services = new Map();
    this._serviceClaims = new Map();
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
    if (this._disposed) throw new Error('Context is disposed');
    const context = this._context || this;
    const owner = this._owner ? this._currentFiber() : null;
    const claims = this._serviceClaims.get(name) || [];
    const claim = { value };
    claims.push(claim);
    this._serviceClaims.set(name, claims);
    this._services.set(name, value);
    context._defineServiceProperty(name);
    context._cascade('activate');
    const dispose = () => {
      const index = claims.indexOf(claim);
      if (index < 0) return;
      claims.splice(index, 1);
      if (claims.length) {
        this._services.set(name, claims[claims.length - 1].value);
      } else {
        this._serviceClaims.delete(name);
        this._services.delete(name);
        if (Object.prototype.hasOwnProperty.call(context, name)) {
          delete context[name];
        }
      }
      context._cascade('deactivate');
    };
    if (owner) owner.effects.push(dispose);
    return dispose;
  }

  // Cordis exposes services as ctx.<name>; keep that shape on every context.
  _defineServiceProperty(name) {
    if (name in this) return;
    Object.defineProperty(this, name, {
      configurable: true,
      enumerable: false,
      get() { return this.get(name); },
    });
  }

  _syncInheritedServiceProperties() {
    for (let context = this.parent; context; context = context.parent) {
      for (const name of context._services.keys()) this._defineServiceProperty(name);
    }
  }

  get(name) {
    if (this._overrides.has(name)) return this._overrides.get(name);
    const value = this._services.has(name) ? this._services.get(name)
      : this.parent ? this.parent.get(name) : undefined;
    return this._owner && typeof value?.forContext === 'function' ? value.forContext(this) : value;
  }

  hasService(name) {
    return this.get(name) !== undefined;
  }

  // Creates an isolated child context whose overrides shadow the parent.
  isolate(label = 'isolated') {
    const child = new Context({ parent: this._context || this, label: `${this.label}/${label}` });
    child._syncInheritedServiceProperties();
    if (this._owner) this._currentFiber().effects.push(() => child.dispose());
    return child;
  }

  _selfAndDescendants() {
    const contexts = [this];
    for (const child of this._children) contexts.push(...child._selfAndDescendants());
    return contexts;
  }

  _cascade(action) {
    for (const context of this._selfAndDescendants()) {
      context._syncInheritedServiceProperties();
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
      if (fiber.state !== FiberState.ACTIVE && fiber.state !== FiberState.LOADING) continue;
      const { required } = fiber.dependencies();
      if (required.some(name => !this.hasService(name))) {
        // Spatial composability: losing a required service deactivates the dependent.
        fiber.suspend();
      }
    }
  }

  // ---- temporal composability: reversible registrations ----

  effect(fn) {
    if (typeof fn !== 'function') throw new Error('effect expects a function');
    const fiber = this._currentFiber();
    const disposer = fn();
    if (typeof disposer === 'function') {
      let disposed = false;
      const once = () => {
        if (disposed) return;
        disposed = true;
        return disposer();
      };
      fiber.effects.push(once);
      return once;
    }
    return disposer;
  }

  on(event, listener, options = {}) {
    if (typeof listener !== 'function') throw new Error('on expects a listener function');
    const fiber = this._currentFiber();
    const entry = { listener, once: Boolean(options.once) };
    const list = this._listeners.get(event) || [];
    list.push(entry);
    this._listeners.set(event, list);
    const dispose = () => {
      const current = this._listeners.get(event) || [];
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
    };
    fiber.effects.push(dispose);
    return dispose;
  }

  off(event, listener) {
    const list = this._listeners.get(event) || [];
    this._listeners.set(event, list.filter(entry => entry.listener !== listener));
  }

  _currentFiber() {
    const fiber = this._owner || this._activeFiberStack[this._activeFiberStack.length - 1];
    if (!fiber) throw new Error('Registration requires an active plugin mount');
    if (fiber.state !== FiberState.LOADING && fiber.state !== FiberState.ACTIVE) {
      throw new Error('Cannot register effects on an inactive plugin');
    }
    return fiber;
  }

  // ---- typed event dispatch (emit/parallel/serial/bail/waterfall) ----

  emit(event, ...args) {
    for (const entry of this._eventEntries(event)) {
      entry.listener(...args);
    }
  }

  async parallel(event, ...args) {
    await Promise.all(this._eventEntries(event).map(entry => entry.listener(...args)));
  }

  async serial(event, ...args) {
    let result;
    for (const entry of this._eventEntries(event)) {
      result = await entry.listener(...args);
    }
    return result;
  }

  bail(event, ...args) {
    for (const entry of this._eventEntries(event)) {
      const value = entry.listener(...args);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  // Middleware chain: listeners receive (...args, next) and may short-circuit by returning.
  async waterfall(event, ...args) {
    const entries = this._eventEntries(event);
    const invoke = async index => {
      if (index >= entries.length) return undefined;
      let called = false;
      return entries[index].listener(...args, () => {
        if (called) throw new Error('waterfall next() called more than once');
        called = true;
        return invoke(index + 1);
      });
    };
    return invoke(0);
  }

  _eventEntries(event) {
    return [...(this._listeners.get(event) || [])].map(entry => ({
      listener: (...args) => {
        if (entry.once) {
          const list = this._listeners.get(event) || [];
          const index = list.indexOf(entry);
          if (index < 0) return;
          list.splice(index, 1);
        }
        return entry.listener(...args);
      },
    }));
  }

  // ---- composition ----

  plugin(plugin, config) {
    if (this._disposed) throw new Error('Context is disposed');
    const label = config?.name || (typeof plugin === 'function' ? plugin.name : plugin?.name) || `plugin-${fiberSequence + 1}`;
    const fiber = new Fiber(this, label, plugin, config);
    this._fibers.set(fiber.id, fiber);
    const parent = this._owner || this._activeFiberStack[this._activeFiberStack.length - 1];
    if (parent && parent !== fiber) parent.children.push(fiber);
    fiber._mount();
    return fiber;
  }

  async dispose() {
    if (this._disposed) return this._disposing;
    this._disposed = true;
    this._disposing = (async () => {
      for (const fiber of [...this._fibers.values()].reverse()) await fiber.dispose();
      for (const child of [...this._children]) await child.dispose();
      this._children.clear();
      this.parent?._children.delete(this);
    })();
    return this._disposing;
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
    context.provide(name, this);
  }
}
