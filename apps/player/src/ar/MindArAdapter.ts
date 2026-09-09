import type {
  ImageTrackingAdapter,
  TrackingAnchor,
  TrackingEvent,
  TrackingStartOptions,
  Unsubscribe,
} from "@image-ar/ar-core";
import type { MindARThree as MindARThreeType, MindArAnchor } from "mind-ar/dist/mindar-image-three.prod.js";
import { Object3D } from "three";

type MindArInstance = InstanceType<typeof MindARThreeType>;
type TrackingCallback = (payload?: unknown) => void;

class MindArTrackingAnchor implements TrackingAnchor {
  readonly targetIndex: number;
  #content: Object3D | null = null;
  #nativeAnchor: MindArAnchor | null = null;
  #visible = false;

  constructor(targetIndex: number) {
    this.targetIndex = targetIndex;
  }

  setContent(content: unknown): void {
    if (!(content instanceof Object3D)) throw new TypeError("AR anchor content must be a Three.js Object3D");
    if (this.#nativeAnchor && this.#content) this.#nativeAnchor.group.remove(this.#content);
    this.#content = content;
    this.#nativeAnchor?.group.add(content);
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    if (this.#nativeAnchor) this.#nativeAnchor.group.visible = visible;
  }

  connect(nativeAnchor: MindArAnchor): void {
    this.#nativeAnchor = nativeAnchor;
    nativeAnchor.group.visible = this.#visible;
    if (this.#content) nativeAnchor.group.add(this.#content);
  }

  disconnect(): void {
    if (this.#nativeAnchor) {
      this.#nativeAnchor.onTargetFound = null;
      this.#nativeAnchor.onTargetLost = null;
      this.#nativeAnchor.onTargetUpdate = null;
      if (this.#content) this.#nativeAnchor.group.remove(this.#content);
    }
    this.#nativeAnchor = null;
  }
}

export class MindArAdapter implements ImageTrackingAdapter {
  readonly #listeners: Record<TrackingEvent, Set<TrackingCallback>> = {
    found: new Set(),
    lost: new Set(),
    error: new Set(),
  };
  #anchor: MindArTrackingAnchor | null = null;
  #mindar: MindArInstance | null = null;
  #container: HTMLElement | null = null;
  #resizeListeners: EventListenerOrEventListenerObject[] = [];
  #stopped = false;

  addTarget(index: number): TrackingAnchor {
    if (this.#anchor) throw new Error("The Player supports exactly one image target");
    this.#anchor = new MindArTrackingAnchor(index);
    return this.#anchor;
  }

  on(event: TrackingEvent, callback: TrackingCallback): Unsubscribe {
    this.#listeners[event].add(callback);
    return () => this.#listeners[event].delete(callback);
  }

  async start(options: TrackingStartOptions): Promise<void> {
    if (this.#mindar) throw new Error("MindAR adapter is already running");
    if (!this.#anchor) throw new Error("Add a target before starting MindAR");
    options.signal.throwIfAborted();
    this.#container = options.container;
    this.#stopped = false;

    try {
      const { MindARThree } = await import("mind-ar/dist/mindar-image-three.prod.js");
      options.signal.throwIfAborted();
      const { instance, resizeListeners } = captureMindArResizeListeners(() =>
        new MindARThree({
          container: options.container,
          imageTargetSrc: options.targetSource,
          maxTrack: options.maxTrack,
          uiLoading: "no",
          uiScanning: "no",
          uiError: "no",
          filterMinCF: options.filterMinCF,
          filterBeta: options.filterBeta,
          warmupTolerance: options.warmupTolerance,
          missTolerance: options.missTolerance,
        }),
      );
      this.#mindar = instance;
      this.#resizeListeners = resizeListeners;
      instance.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const nativeAnchor = instance.addAnchor(this.#anchor.targetIndex);
      this.#anchor.connect(nativeAnchor);
      nativeAnchor.onTargetFound = () => this.#emit("found");
      nativeAnchor.onTargetLost = () => this.#emit("lost");

      const abort = () => void this.stop();
      options.signal.addEventListener("abort", abort, { once: true });
      try {
        await instance.start();
        options.signal.throwIfAborted();
      } finally {
        options.signal.removeEventListener("abort", abort);
      }
    } catch (error) {
      throw error;
    }
  }

  renderFrame(_nowMs: number): void {
    const mindar = this.#mindar;
    if (mindar) mindar.renderer.render(mindar.scene, mindar.camera);
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const mindar = this.#mindar;
    stopContainerStreams(this.#container);
    if (!mindar) return;
    try {
      mindar.stop();
    } catch {
      stopContainerStreams(this.#container);
    }
  }

  dispose(): void {
    const mindar = this.#mindar;
    this.#mindar = null;
    this.#anchor?.disconnect();
    this.#anchor = null;
    for (const listener of this.#resizeListeners) window.removeEventListener("resize", listener);
    this.#resizeListeners = [];

    if (mindar) {
      mindar.controller?.dispose();
      mindar.renderer.dispose();
      mindar.renderer.forceContextLoss();
    }
    stopContainerStreams(this.#container);
    this.#container?.replaceChildren();
    this.#container = null;
    for (const listeners of Object.values(this.#listeners)) listeners.clear();
  }

  #emit(event: TrackingEvent, payload?: unknown): void {
    for (const callback of this.#listeners[event]) callback(payload);
  }
}

function captureMindArResizeListeners<T>(create: () => T): {
  instance: T;
  resizeListeners: EventListenerOrEventListenerObject[];
} {
  const listeners: EventListenerOrEventListenerObject[] = [];
  const original = window.addEventListener;
  const addListener = window.addEventListener.bind(window) as (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const mutableWindow = window as Window & { addEventListener: typeof window.addEventListener };
  mutableWindow.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "resize") listeners.push(listener);
    addListener(type, listener, options);
  }) as typeof window.addEventListener;
  try {
    return { instance: create(), resizeListeners: listeners };
  } finally {
    mutableWindow.addEventListener = original;
  }
}

function stopContainerStreams(container: HTMLElement | null): void {
  if (!container) return;
  for (const video of container.querySelectorAll("video")) {
    const stream = video.srcObject;
    if (stream instanceof MediaStream) {
      for (const track of stream.getTracks()) track.stop();
    }
    video.srcObject = null;
  }
}
