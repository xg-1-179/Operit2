import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, FiberState, Service, createApp } from '../cordis-core.mjs';

test('effects unwind in reverse registration order and once', async () => {
  const root = new Context();
  const log = [];
  root.plugin({
    name: 'effects',
    apply(ctx) {
      ctx.effect(() => {
        log.push('a');
        return () => log.push('unwind-a');
      });
      ctx.effect(() => {
        log.push('b');
        return () => log.push('unwind-b');
      });
    },
  });
  const fiber = [...root._fibers.values()][0];
  assert.equal(fiber.state, FiberState.ACTIVE);
  await root.dispose();
  assert.deepEqual(log, ['a', 'b', 'unwind-b', 'unwind-a']);
});

test('declared services gate activation and recover after service loss', async () => {
  const root = new Context();
  let applied = 0;
  const cleanup = [];
  root.plugin({
    name: 'dependent',
    inject: ['greeter'],
    apply(ctx) {
      applied += 1;
      cleanup.push(ctx.effect(() => () => applied -= 1));
    },
  });
  const fiber = [...root._fibers.values()][0];
  assert.equal(fiber.state, FiberState.PENDING);
  assert.equal(applied, 0);

  const remove = root.provide('greeter', { hello: () => 'hi' });
  assert.equal(fiber.state, FiberState.ACTIVE);
  assert.equal(applied, 1);

  remove();
  await fiber._stopping;
  assert.equal(fiber.state, FiberState.PENDING);
  assert.equal(applied, 0);
  root.provide('greeter', {});
  assert.equal(fiber.state, FiberState.ACTIVE);
  assert.equal(applied, 1);
  await root.dispose();
});

test('service loss cascades into child contexts', () => {
  const root = new Context();
  const isolated = root.isolate('scope-a');
  let active = false;
  isolated.plugin({
    name: 'child',
    inject: ['clock'],
    apply(ctx) {
      ctx.effect(() => () => {
        active = false;
      });
      active = true;
    },
  });
  const remove = root.provide('clock', { now: () => 0 });
  assert.equal(active, true);
  remove();
  assert.equal(active, false);
});

test('isolated child overrides shadow parent services', () => {
  const root = new Context();
  root.provide('value', 'parent');
  const isolated = root.isolate();
  isolated._overrides.set('value', 'child');
  assert.equal(root.get('value'), 'parent');
  assert.equal(isolated.get('value'), 'child');
});

test('event dispatch modes: bail short-circuits and waterfall middleware delegates', async () => {
  const root = new Context();
  root.plugin({
    name: 'listeners',
    apply(ctx) {
      ctx.on('decide', () => 'first');
      ctx.on('decide', () => 'second');
      ctx.on('wrap', async (value, next) => {
        const inner = await next();
        return `outer(${inner ?? value})`;
      });
    },
  });
  assert.equal(root.bail('decide'), 'first');
  assert.equal(await root.waterfall('wrap', 'x'), 'outer(x)');
});

test('Service base class registers and unwinds its service claim', () => {
  const root = new Context();
  class Greeter extends Service {
    constructor(ctx) {
      super(ctx, 'greeter');
    }
  }
  root.plugin({
    name: 'service-owner',
    apply(ctx) {
      new Greeter(ctx);
    },
  });
  assert.ok(root.get('greeter'));
  root.dispose();
  assert.equal(root.get('greeter'), undefined);
});

test('disposing a parent fiber disposes child plugins', async () => {
  const root = new Context();
  let childActive = false;
  const parent = root.plugin({
    name: 'parent',
    apply(ctx) {
      ctx.plugin({
        name: 'child',
        apply(ctx) {
          ctx.effect(() => () => {
            childActive = false;
          });
          childActive = true;
        },
      });
    },
  });
  assert.equal(childActive, true);
  await parent.dispose();
  assert.equal(childActive, false);
  assert.equal(parent.state, FiberState.DISPOSED);
});

test('async mounts retain ownership and unload awaits reverse cleanup', async () => {
  const root = new Context();
  const log = [];
  const fiber = root.plugin(async (ctx, config) => {
    await Promise.resolve();
    assert.equal(config.value, 42);
    ctx.effect(() => () => log.push('first'));
    ctx.effect(() => async () => {
      await Promise.resolve();
      log.push('second');
    });
  }, { value: 42 });
  await fiber.ready;
  assert.equal(fiber.state, FiberState.ACTIVE);
  await root.dispose();
  assert.deepEqual(log, ['second', 'first']);
});

test('manual effect disposal is idempotent and late services reach child properties', async () => {
  const root = new Context();
  const child = root.isolate();
  let count = 0;
  root.plugin(ctx => {
    const dispose = ctx.effect(() => () => count++);
    dispose();
    dispose();
  });
  root.provide('late', 7);
  assert.equal(child.late, 7);
  await root.dispose();
  assert.equal(count, 1);
});

test('createApp mounts an ordered plugin list', () => {
  const order = [];
  const app = createApp([
    { name: 'one', apply: () => order.push(1) },
    { name: 'two', apply: () => order.push(2) },
  ]);
  assert.deepEqual(order, [1, 2]);
  app.dispose();
});

test('services published by a plugin reach sibling consumers and unwind', async () => {
  const root = new Context();
  let value;
  const consumer = root.plugin({ inject: ['value'], apply(ctx) { value = ctx.value; } });
  const owner = root.plugin(ctx => ctx.provide('value', 17));
  assert.equal(value, 17);
  assert.equal(consumer.state, FiberState.ACTIVE);
  await owner.dispose();
  await consumer._stopping;
  assert.equal(consumer.state, FiberState.PENDING);
  assert.equal(root.get('value'), undefined);
  await root.dispose();
});

test('out of order service disposal never resurrects a removed provider', () => {
  const root = new Context();
  const first = root.provide('value', 1);
  const second = root.provide('value', 2);
  first();
  second();
  second();
  assert.equal(root.get('value'), undefined);
});

test('service subclasses mount as constructors with their config', async () => {
  class Greeter extends Service {
    constructor(ctx, config) { super(ctx, 'greeter'); this.value = config.value; }
  }
  const root = new Context();
  const fiber = root.plugin(Greeter, { value: 7 });
  assert.equal(fiber.state, FiberState.ACTIVE);
  assert.equal(root.greeter.value, 7);
  await root.dispose();
  assert.equal(root.get('greeter'), undefined);
});

test('once listeners are consumed by every event dispatch mode', async () => {
  const root = new Context();
  let calls = 0;
  root.plugin(ctx => {
    for (const mode of ['emit', 'parallel', 'serial', 'bail', 'waterfall']) {
      ctx.on(mode, () => { calls++; return true; }, { once: true });
    }
  });
  for (const mode of ['emit', 'parallel', 'serial', 'bail', 'waterfall']) {
    await root[mode](mode);
    await root[mode](mode);
  }
  assert.equal(calls, 5);
  await root.dispose();
});

test('explicit disposal during suspension prevents a later remount', async () => {
  const root = new Context();
  const remove = root.provide('provider', {});
  const fiber = root.plugin({
    inject: ['provider'],
    apply(ctx) { ctx.effect(() => async () => { await Promise.resolve(); }); },
  });
  remove();
  await fiber.dispose();
  root.provide('provider', {});
  assert.equal(fiber.state, FiberState.DISPOSED);
  await root.dispose();
});
