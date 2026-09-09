import type {
  ImageTrackingAdapter,
  TrackingAnchor,
  TrackingStartOptions,
  Unsubscribe,
} from "./ImageTrackingAdapter.js";
import {
  createInitialTrackingState,
  reduceTrackingState,
  type ArSessionEvent,
  type ArSessionState,
  type TrackingTiming,
} from "./trackingState.js";

export interface ArEffect {
  readonly content: unknown;
  setTrackingVisible(visible: boolean, nowMs: number): void;
  update(nowMs: number): void;
  dispose(): void;
}

export interface LoadedArAssets {
  readonly targetSource: string;
  readonly targetIndex: number;
  readonly effect: ArEffect;
  dispose(): void;
}

export interface ArSessionControllerOptions {
  readonly createAdapter: () => ImageTrackingAdapter;
  readonly loadAssets: (signal: AbortSignal) => Promise<LoadedArAssets>;
  readonly tracking: TrackingTiming;
  readonly adapterOptions?: Omit<
    TrackingStartOptions,
    "container" | "targetSource" | "maxTrack" | "signal"
  >;
  readonly now?: () => number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export type ArSessionStateListener = (state: ArSessionState) => void;

/**
 * The sole owner of one AR session. UI code may start/stop and subscribe, but it
 * never owns camera, RAF, tracker, or effect resources directly.
 */
export class ArSessionController {
  readonly #options: ArSessionControllerOptions;
  readonly #listeners = new Set<ArSessionStateListener>();
  #state: ArSessionState = createInitialTrackingState();
  #abortController: AbortController | null = null;
  #adapter: ImageTrackingAdapter | null = null;
  #anchor: TrackingAnchor | null = null;
  #assets: LoadedArAssets | null = null;
  #unsubscribers: Unsubscribe[] = [];
  #frameHandle: number | null = null;
  #startPromise: Promise<void> | null = null;
  #effectVisible = false;
  #runId = 0;

  constructor(options: ArSessionControllerOptions) {
    this.#options = options;
  }

  get state(): ArSessionState {
    return this.#state;
  }

  subscribe(listener: ArSessionStateListener): Unsubscribe {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  start(container: HTMLElement): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    if (this.#adapter || this.#assets) {
      return Promise.reject(new Error("AR session is already running"));
    }

    const runId = ++this.#runId;
    const abortController = new AbortController();
    this.#abortController = abortController;
    this.#startPromise = this.#start(container, runId, abortController.signal).finally(() => {
      if (this.#runId === runId) this.#startPromise = null;
    });
    return this.#startPromise;
  }

  async stop(): Promise<void> {
    ++this.#runId;
    this.#abortController?.abort();
    this.#abortController = null;
    let cleanupError: unknown;
    let cleanupFailed = false;
    try {
      await this.#releaseResources();
    } catch (error) {
      cleanupError = error;
      cleanupFailed = true;
    }
    this.#transition({ type: "STOP" });
    this.#startPromise = null;
    if (cleanupFailed) throw cleanupError;
  }

  async #start(
    container: HTMLElement,
    runId: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      this.#transition({ type: "START" });
      const assets = await this.#options.loadAssets(signal);
      if (!this.#isCurrent(runId, signal)) {
        assets.effect.setTrackingVisible(false, this.#now());
        assets.effect.dispose();
        assets.dispose();
        throw abortError();
      }
      this.#assets = assets;

      const adapter = this.#options.createAdapter();
      this.#adapter = adapter;
      const anchor = adapter.addTarget(assets.targetIndex);
      this.#anchor = anchor;
      anchor.setContent(assets.effect.content);
      anchor.setVisible(false);
      this.#bindAdapter(adapter);
      this.#transition({ type: "ASSETS_LOADED" });

      await adapter.start({
        container,
        targetSource: assets.targetSource,
        maxTrack: 1,
        signal,
        ...this.#options.adapterOptions,
      });
      if (!this.#isCurrent(runId, signal)) throw abortError();

      this.#transition({ type: "PERMISSION_GRANTED" });
      this.#scheduleFrame();
    } catch (error) {
      const cancelled = signal.aborted || !this.#isRunIdCurrent(runId) || isAbortError(error);
      let failure = error;
      try {
        await this.#releaseResources();
      } catch (cleanupError) {
        failure = new AggregateError([error, cleanupError], "AR startup and cleanup both failed");
      }
      if (!cancelled || failure !== error) this.#transition({ type: "FAIL", error: failure });
      throw failure;
    }
  }

  #bindAdapter(adapter: ImageTrackingAdapter): void {
    this.#unsubscribers = [
      adapter.on("found", () => {
        this.#transition({ type: "FOUND", nowMs: this.#now() });
      }),
      adapter.on("lost", () => {
        this.#transition({ type: "LOST", nowMs: this.#now() });
      }),
      adapter.on("error", (error) => {
        this.#transition({ type: "FAIL", error });
        void this.#releaseResources().catch((cleanupError: unknown) => {
          this.#transition({
            type: "FAIL",
            error: new AggregateError([error, cleanupError], "AR runtime cleanup failed"),
          });
        });
      }),
    ];
  }

  #scheduleFrame(): void {
    if (!this.#adapter || this.#frameHandle !== null) return;
    const requestFrame = this.#options.requestFrame ?? requestAnimationFrame;
    this.#frameHandle = requestFrame(this.#renderFrame);
  }

  #renderFrame = (nowMs: number): void => {
    this.#frameHandle = null;
    if (!this.#adapter || !this.#assets) return;
    this.#transition({ type: "TICK", nowMs });
    if (!document.hidden) {
      if (this.#effectVisible) this.#assets.effect.update(nowMs);
      this.#adapter.renderFrame(nowMs);
    }
    this.#scheduleFrame();
  };

  #transition(event: ArSessionEvent): void {
    const next = reduceTrackingState(this.#state, event, this.#options.tracking);
    if (next === this.#state) return;
    this.#state = next;
    this.#syncEffectVisibility();
    for (const listener of this.#listeners) listener(next);
  }

  #syncEffectVisibility(): void {
    const visible = this.#state.kind === "tracking";
    this.#anchor?.setVisible(visible);
    if (visible === this.#effectVisible) return;
    this.#effectVisible = visible;
    this.#assets?.effect.setTrackingVisible(visible, this.#now());
  }

  async #releaseResources(): Promise<void> {
    const errors: unknown[] = [];
    const cancelFrame = this.#options.cancelFrame ?? cancelAnimationFrame;
    if (this.#frameHandle !== null) {
      try {
        cancelFrame(this.#frameHandle);
      } catch (error) {
        errors.push(error);
      }
    }
    this.#frameHandle = null;
    this.#effectVisible = false;
    try {
      this.#anchor?.setVisible(false);
    } catch (error) {
      errors.push(error);
    }
    this.#anchor = null;

    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (error) {
        errors.push(error);
      }
    }

    const adapter = this.#adapter;
    this.#adapter = null;
    if (adapter) {
      try {
        await adapter.stop();
      } catch (error) {
        errors.push(error);
      }
      try {
        adapter.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    const assets = this.#assets;
    this.#assets = null;
    if (assets) {
      try {
        assets.effect.setTrackingVisible(false, this.#now());
      } catch (error) {
        errors.push(error);
      }
      try {
        assets.effect.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        assets.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "AR resources could not be fully released");
  }

  #now(): number {
    return (this.#options.now ?? performance.now.bind(performance))();
  }

  #isRunIdCurrent(runId: number): boolean {
    return this.#runId === runId;
  }

  #isCurrent(runId: number, signal: AbortSignal): boolean {
    return this.#isRunIdCurrent(runId) && !signal.aborted;
  }
}

function abortError(): DOMException {
  return new DOMException("AR session start cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
