export type Unsubscribe = () => void;

export type TrackingEvent = "found" | "lost" | "error";

export interface TrackingStartOptions {
  readonly container: HTMLElement;
  readonly targetSource: string;
  readonly maxTrack: 1;
  readonly signal: AbortSignal;
  readonly filterMinCF?: number;
  readonly filterBeta?: number;
  readonly missTolerance?: number;
  readonly warmupTolerance?: number;
}

/**
 * Deliberately opaque so application code cannot reach into MindAR internals.
 * A renderer may attach its Three.js object through the adapter implementation.
 */
export interface TrackingAnchor {
  readonly targetIndex: number;
  setContent(content: unknown): void;
  setVisible(visible: boolean): void;
}

export interface ImageTrackingAdapter {
  start(options: TrackingStartOptions): Promise<void>;
  stop(): Promise<void>;
  addTarget(index: number): TrackingAnchor;
  on(event: TrackingEvent, callback: (payload?: unknown) => void): Unsubscribe;
  renderFrame(nowMs: number): void;
  dispose(): void;
}
