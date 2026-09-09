import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialTrackingState,
  reduceTrackingState,
  type ArSessionState,
  type TrackingTiming,
} from "../src/trackingState.ts";

const immediate: TrackingTiming = { warmupMs: 0, lostGraceMs: 0 };

function beginScanning(timing: TrackingTiming = immediate): ArSessionState {
  let state = createInitialTrackingState();
  state = reduceTrackingState(state, { type: "START" }, timing);
  assert.equal(state.kind, "loading-assets");
  state = reduceTrackingState(state, { type: "ASSETS_LOADED" }, timing);
  assert.equal(state.kind, "requesting-permission");
  state = reduceTrackingState(state, { type: "PERMISSION_GRANTED" }, timing);
  assert.equal(state.kind, "scanning");
  return state;
}

test("loads assets before the adapter requests camera permission", () => {
  assert.equal(beginScanning().kind, "scanning");
});

test("shows immediately on found and hides immediately on lost", () => {
  let state = beginScanning();
  state = reduceTrackingState(state, { type: "FOUND", nowMs: 100 }, immediate);
  assert.equal(state.kind, "tracking");
  state = reduceTrackingState(state, { type: "LOST", nowMs: 120 }, immediate);
  assert.equal(state.kind, "temporarily-lost");
  state = reduceTrackingState(state, { type: "TICK", nowMs: 120 }, immediate);
  assert.equal(state.kind, "scanning");
});

test("never makes a warmup visible after tracking is lost", () => {
  const timing: TrackingTiming = { warmupMs: 100, lostGraceMs: 250 };
  let state = beginScanning(timing);
  state = reduceTrackingState(state, { type: "FOUND", nowMs: 1_000 }, timing);
  assert.equal(state.kind, "warming-up");
  state = reduceTrackingState(state, { type: "LOST", nowMs: 1_050 }, timing);
  assert.equal(state.kind, "temporarily-lost");
  state = reduceTrackingState(state, { type: "TICK", nowMs: 1_100 }, timing);
  assert.equal(state.kind, "temporarily-lost");
});

test("can retry from an error only through a new start", () => {
  const failed = reduceTrackingState(
    createInitialTrackingState(),
    { type: "FAIL", error: new Error("boom") },
    immediate,
  );
  assert.equal(failed.kind, "error");
  assert.equal(
    reduceTrackingState(failed, { type: "START" }, immediate).kind,
    "loading-assets",
  );
});
