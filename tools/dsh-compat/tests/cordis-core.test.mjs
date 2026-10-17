import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, FiberState, Service, createApp } from '../cordis-core.mjs';

test('effects unwind in reverse registration order and once', () => {
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
  root.dispose();
  assert.deepEqual(log, ['a', 'b', 'unwind-b', 'unwind-a']);
});

test('declared services gate activation and loss deactivates dependents', () => {
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
  assert.equal(fiber.state, FiberState.DISPOSED);
  assert.equal(applied, 0);
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

test('disposing a parent fiber disposes child plugins', () => {
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
  parent.dispose();
  assert.equal(childActive, false);
  assert.equal(parent.state, FiberState.DISPOSED);
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
