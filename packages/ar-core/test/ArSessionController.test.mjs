import assert from "node:assert/strict";
import test from "node:test";
import { ArSessionController } from "../.test-dist/ArSessionController.js";

class FakeAnchor {
  targetIndex = 0;
  visibility = [];
  content = null;

  setContent(content) {
    this.content = content;
  }

  setVisible(visible) {
    this.visibility.push(visible);
  }
}

class FakeAdapter {
  anchor = new FakeAnchor();
  callbacks = { found: new Set(), lost: new Set(), error: new Set() };
  starts = 0;
  stops = 0;
  disposes = 0;

  async start() {
    this.starts += 1;
  }

  async stop() {
    this.stops += 1;
  }

  addTarget(index) {
    this.anchor.targetIndex = index;
    return this.anchor;
  }

  on(event, callback) {
    this.callbacks[event].add(callback);
    return () => this.callbacks[event].delete(callback);
  }

  renderFrame() {}

  dispose() {
    this.disposes += 1;
  }

  emit(event, payload) {
    for (const callback of this.callbacks[event]) callback(payload);
  }
}

function createFixture() {
  const adapter = new FakeAdapter();
  const calls = { effectDisposed: 0, assetsDisposed: 0, effectVisibility: [] };
  const assets = {
    targetSource: "blob:target",
    targetIndex: 0,
    effect: {
      content: { kind: "fake-effect" },
      setTrackingVisible(visible) {
        calls.effectVisibility.push(visible);
      },
      update() {},
      dispose() {
        calls.effectDisposed += 1;
      },
    },
    dispose() {
      calls.assetsDisposed += 1;
    },
  };
  const controller = new ArSessionController({
    createAdapter: () => adapter,
    loadAssets: async () => assets,
    tracking: { warmupMs: 0, lostGraceMs: 0 },
    now: () => 100,
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  return { adapter, assets, calls, controller };
}

test("found/lost immediately controls effect visibility and stop releases resources", async () => {
  const { adapter, calls, controller } = createFixture();
  await controller.start({});
  assert.equal(controller.state.kind, "scanning");
  adapter.emit("found");
  assert.equal(controller.state.kind, "tracking");
  assert.equal(calls.effectVisibility.at(-1), true);
  adapter.emit("lost");
  assert.equal(controller.state.kind, "temporarily-lost");
  assert.equal(calls.effectVisibility.at(-1), false);

  await controller.stop();
  assert.equal(adapter.stops, 1);
  assert.equal(adapter.disposes, 1);
  assert.equal(calls.effectDisposed, 1);
  assert.equal(calls.assetsDisposed, 1);
});

test("duplicate start calls share one in-flight session", async () => {
  let finishLoading;
  const { adapter, assets } = createFixture();
  const loading = new Promise((resolve) => {
    finishLoading = () => resolve(assets);
  });
  const guarded = new ArSessionController({
    createAdapter: () => adapter,
    loadAssets: () => loading,
    tracking: { warmupMs: 0, lostGraceMs: 0 },
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  const first = guarded.start({});
  const second = guarded.start({});
  assert.equal(first, second);
  finishLoading();
  await first;
  assert.equal(adapter.starts, 1);
  await guarded.stop();
});

test("stop during asset loading cancels startup and disposes late assets", async () => {
  let finishLoading;
  const { adapter, assets, calls } = createFixture();
  const loading = new Promise((resolve) => {
    finishLoading = () => resolve(assets);
  });
  const controller = new ArSessionController({
    createAdapter: () => adapter,
    loadAssets: () => loading,
    tracking: { warmupMs: 0, lostGraceMs: 0 },
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  const starting = controller.start({});
  await controller.stop();
  finishLoading();
  await assert.rejects(starting, { name: "AbortError" });
  assert.equal(adapter.starts, 0);
  assert.equal(calls.effectDisposed, 1);
  assert.equal(calls.assetsDisposed, 1);
});

test("cleanup continues after an adapter stop failure", async () => {
  const { adapter, calls, controller } = createFixture();
  adapter.stop = async () => {
    adapter.stops += 1;
    throw new Error("stop failed");
  };
  await controller.start({});
  await assert.rejects(controller.stop(), AggregateError);
  assert.equal(controller.state.kind, "stopped");
  assert.equal(adapter.disposes, 1);
  assert.equal(calls.effectDisposed, 1);
  assert.equal(calls.assetsDisposed, 1);
});
