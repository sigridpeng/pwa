import type { Group, Texture } from "three";

export interface EffectHandle {
  readonly texture: Texture;
  onFound(nowMs: number): void;
  onLost(): void;
  update(nowMs: number): void;
  dispose(): void;
}

export type EffectFactory = (group: Group, assetUrl: string) => Promise<EffectHandle>;

export interface SpikeConfig {
  readonly kind: "PNG" | "GIF";
  readonly effectFile: string;
  readonly createEffect: EffectFactory;
}
