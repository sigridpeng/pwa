import type { ArEffect, LoadedArAssets } from "@image-ar/ar-core";
import type { LoadedExperience, VerifiedAsset } from "../experienceLoader.js";
import { loadVerifiedAsset } from "../experienceLoader.js";
import { PlayerError } from "../playerError.js";
import { createEffectRenderer } from "./effectRenderers.js";

export async function loadArAssets(
  experience: LoadedExperience,
  signal: AbortSignal,
): Promise<LoadedArAssets> {
  let target: VerifiedAsset | null = null;
  let effect: VerifiedAsset | null = null;
  let renderer: ArEffect | null = null;
  try {
    const [targetResult, effectResult] = await Promise.allSettled([
      loadVerifiedAsset(
        experience.assetUrl(experience.manifest.target.mindFile),
        experience.manifest.target.sha256,
        signal,
      ),
      loadVerifiedAsset(
        experience.assetUrl(experience.manifest.effect.file),
        experience.manifest.effect.sha256,
        signal,
      ),
    ]);
    if (targetResult.status === "fulfilled") target = targetResult.value;
    if (effectResult.status === "fulfilled") effect = effectResult.value;
    if (targetResult.status === "rejected") throw targetResult.reason;
    if (effectResult.status === "rejected") throw effectResult.reason;
    signal.throwIfAborted();
    if (!target || !effect) throw new Error("必要素材未完整載入");
    renderer = await createEffectRenderer(
      experience.manifest.effect,
      effect.bytes,
      effect.objectUrl,
    );
    signal.throwIfAborted();
    return {
      targetSource: target.objectUrl,
      targetIndex: experience.manifest.target.targetIndex,
      effect: renderer,
      dispose() {
        target?.dispose();
        effect?.dispose();
        target = null;
        effect = null;
      },
    };
  } catch (error) {
    target?.dispose();
    effect?.dispose();
    renderer?.dispose();
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof PlayerError) throw error;
    throw new PlayerError("ASSET_INVALID", "特效素材無法解碼或超出裝置預算。", {
      cause: error,
    });
  }
}
