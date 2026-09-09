import type { ArEffect } from "@image-ar/ar-core";
import type { EffectPlacement, ExperienceEffect } from "@image-ar/contracts";
import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import * as THREE from "three";

const MAX_DECODED_GIF_PIXELS = 20_000_000;
const MINIMUM_FRAME_DELAY_MS = 20;

export async function createEffectRenderer(
  effect: ExperienceEffect,
  bytes: ArrayBuffer,
  objectUrl: string,
): Promise<ArEffect> {
  if (effect.type === "png") return createPngEffect(effect, objectUrl);
  return createGifEffect(effect, bytes);
}

async function createPngEffect(effect: ExperienceEffect, objectUrl: string): Promise<ArEffect> {
  const texture = await new THREE.TextureLoader().loadAsync(objectUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plane = createPlane(texture, effect.placement, effect.intrinsicWidth, effect.intrinsicHeight);
  return {
    content: plane.mesh,
    setTrackingVisible(visible) {
      plane.mesh.visible = visible;
    },
    update() {},
    dispose() {
      plane.geometry.dispose();
      plane.material.dispose();
      texture.dispose();
    },
  };
}

async function createGifEffect(
  effect: Extract<ExperienceEffect, { type: "gif" }>,
  bytes: ArrayBuffer,
): Promise<ArEffect> {
  const frames = decompressFrames(parseGIF(bytes), true);
  if (frames.length === 0) throw new Error("GIF 沒有可播放的畫格");
  const width = Math.max(...frames.map((frame) => frame.dims.left + frame.dims.width));
  const height = Math.max(...frames.map((frame) => frame.dims.top + frame.dims.height));
  if (width * height * frames.length > MAX_DECODED_GIF_PIXELS) {
    throw new Error("GIF 解碼預算超過 20,000,000 pixels");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const patchCanvas = document.createElement("canvas");
  const patchContext = patchCanvas.getContext("2d");
  if (!context || !patchContext) throw new Error("瀏覽器無法建立 GIF canvas");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const plane = createPlane(texture, effect.placement, effect.intrinsicWidth, effect.intrinsicHeight);
  const totalDurationMs = frames.reduce((sum, frame) => sum + frameDelayMs(frame), 0);
  let currentFrame = -1;
  let startedAtMs: number | null = effect.playback.startOnFound ? null : performance.now();
  let pausedAtMs: number | null = null;
  let restoreSnapshot: ImageData | null = null;

  const reset = (): void => {
    context.clearRect(0, 0, width, height);
    currentFrame = -1;
    restoreSnapshot = null;
  };

  const drawThrough = (targetFrame: number): void => {
    if (targetFrame < currentFrame) reset();
    while (currentFrame < targetFrame) {
      const next = currentFrame + 1;
      const frame = frames[next];
      if (!frame) throw new Error(`GIF 畫格 ${next} 不存在`);
      if (currentFrame >= 0) disposePrevious(frames[currentFrame], context, restoreSnapshot);
      restoreSnapshot = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : null;
      drawFrame(frame, context, patchCanvas, patchContext);
      currentFrame = next;
    }
    texture.needsUpdate = true;
  };

  drawThrough(0);
  plane.mesh.visible = false;
  return {
    content: plane.mesh,
    setTrackingVisible(visible, nowMs) {
      plane.mesh.visible = visible;
      if (visible) {
        if (startedAtMs === null) startedAtMs = nowMs;
        else if (pausedAtMs !== null) startedAtMs += nowMs - pausedAtMs;
        pausedAtMs = null;
      } else {
        pausedAtMs = nowMs;
        if (effect.playback.resetOnLost) {
          reset();
          drawThrough(0);
          startedAtMs = null;
        }
      }
    },
    update(nowMs) {
      if (startedAtMs === null || pausedAtMs !== null) return;
      const elapsedMs = Math.max(0, nowMs - startedAtMs) * effect.playback.speed;
      const playbackMs = effect.playback.loop
        ? elapsedMs % totalDurationMs
        : Math.min(elapsedMs, totalDurationMs - 1);
      const frameIndex = frameAt(frames, playbackMs);
      if (frameIndex !== currentFrame) drawThrough(frameIndex);
    },
    dispose() {
      plane.geometry.dispose();
      plane.material.dispose();
      texture.dispose();
      canvas.width = 0;
      canvas.height = 0;
      patchCanvas.width = 0;
      patchCanvas.height = 0;
      frames.length = 0;
      restoreSnapshot = null;
    },
  };
}

function createPlane(
  texture: THREE.Texture,
  placement: EffectPlacement,
  intrinsicWidth: number,
  intrinsicHeight: number,
): {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
} {
  const geometry = new THREE.PlaneGeometry(
    placement.width,
    placement.width * (intrinsicHeight / intrinsicWidth),
  );
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: placement.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(placement.x, placement.y, placement.z);
  mesh.rotation.z = THREE.MathUtils.degToRad(placement.rotationDeg);
  mesh.visible = false;
  return { mesh, geometry, material };
}

function frameAt(frames: ParsedFrame[], elapsedMs: number): number {
  let cursorMs = 0;
  for (let index = 0; index < frames.length; index += 1) {
    cursorMs += frameDelayMs(frames[index]);
    if (elapsedMs < cursorMs) return index;
  }
  return Math.max(0, frames.length - 1);
}

function frameDelayMs(frame: ParsedFrame | undefined): number {
  return Math.max(MINIMUM_FRAME_DELAY_MS, frame?.delay ?? 100);
}

function disposePrevious(
  frame: ParsedFrame | undefined,
  context: CanvasRenderingContext2D,
  snapshot: ImageData | null,
): void {
  if (!frame) return;
  if (frame.disposalType === 2) {
    context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
  } else if (frame.disposalType === 3) {
    if (!snapshot) throw new Error("GIF disposal 3 缺少還原畫面");
    context.putImageData(snapshot, 0, 0);
  }
}

function drawFrame(
  frame: ParsedFrame,
  context: CanvasRenderingContext2D,
  patchCanvas: HTMLCanvasElement,
  patchContext: CanvasRenderingContext2D,
): void {
  patchCanvas.width = frame.dims.width;
  patchCanvas.height = frame.dims.height;
  const rgba = new Uint8ClampedArray(frame.patch.length);
  rgba.set(frame.patch);
  patchContext.putImageData(new ImageData(rgba, frame.dims.width, frame.dims.height), 0, 0);
  context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
}
