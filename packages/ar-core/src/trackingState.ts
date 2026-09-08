export type ArSessionState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "loading-assets" }
  | { readonly kind: "scanning" }
  | { readonly kind: "warming-up"; readonly foundAtMs: number }
  | { readonly kind: "tracking" }
  | {
      readonly kind: "temporarily-lost";
      readonly lostAtMs: number;
      readonly wasVisible: boolean;
    }
  | { readonly kind: "stopped" }
  | { readonly kind: "error"; readonly error: unknown };

export interface TrackingTiming {
  readonly warmupMs: number;
  readonly lostGraceMs: number;
}

export type ArSessionEvent =
  | { readonly type: "START" }
  | { readonly type: "PERMISSION_GRANTED" }
  | { readonly type: "ASSETS_LOADED" }
  | { readonly type: "FOUND"; readonly nowMs: number }
  | { readonly type: "LOST"; readonly nowMs: number }
  | { readonly type: "TICK"; readonly nowMs: number }
  | { readonly type: "STOP" }
  | { readonly type: "FAIL"; readonly error: unknown };

export function createInitialTrackingState(): ArSessionState {
  return { kind: "idle" };
}

/**
 * Pure transition function. Fade interpolation remains a renderer concern, but
 * all grace/warmup decisions live here so found/lost events cannot create
 * competing timers.
 */
export function reduceTrackingState(
  state: ArSessionState,
  event: ArSessionEvent,
  timing: TrackingTiming,
): ArSessionState {
  if (event.type === "STOP") return { kind: "stopped" };
  if (event.type === "FAIL") return { kind: "error", error: event.error };

  switch (event.type) {
    case "START":
      return state.kind === "idle" || state.kind === "stopped"
        ? { kind: "requesting-permission" }
        : state;
    case "PERMISSION_GRANTED":
      return state.kind === "requesting-permission"
        ? { kind: "loading-assets" }
        : state;
    case "ASSETS_LOADED":
      return state.kind === "loading-assets" ? { kind: "scanning" } : state;
    case "FOUND":
      if (state.kind === "temporarily-lost" && state.wasVisible) {
        return { kind: "tracking" };
      }
      return state.kind === "scanning" || state.kind === "temporarily-lost"
        ? { kind: "warming-up", foundAtMs: event.nowMs }
        : state;
    case "LOST":
      if (state.kind === "tracking" || state.kind === "warming-up") {
        return {
          kind: "temporarily-lost",
          lostAtMs: event.nowMs,
          wasVisible: state.kind === "tracking",
        };
      }
      return state;
    case "TICK":
      if (
        state.kind === "warming-up" &&
        event.nowMs - state.foundAtMs >= timing.warmupMs
      ) {
        return { kind: "tracking" };
      }
      if (
        state.kind === "temporarily-lost" &&
        event.nowMs - state.lostAtMs >= timing.lostGraceMs
      ) {
        return { kind: "scanning" };
      }
      return state;
  }
}
