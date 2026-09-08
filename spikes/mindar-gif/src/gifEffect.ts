import * as THREE from "three";
import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import { createPlane } from "../../shared/session.js";
import type { EffectHandle } from "../../shared/types.js";

const MIN_DELAY_MS = 20;

export async function createGifEffect(group: THREE.Group, assetUrl: string): Promise<EffectHandle> {
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error(`GIF 載入失敗 (${response.status})`);
  const frames = decompressFrames(parseGIF(await response.arrayBuffer()), true);
  if (frames.length === 0) throw new Error("GIF 沒有可播放的畫格");
  const first = frames[0];
  if (!first) throw new Error("GIF 第一畫格不存在");

  const width = Math.max(...frames.map((frame) => frame.dims.left + frame.dims.width));
  const height = Math.max(...frames.map((frame) => frame.dims.top + frame.dims.height));
  if (width * height * frames.length > 20_000_000) throw new Error("GIF 解碼預算超過 20,000,000 pixels");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("瀏覽器無法建立 GIF canvas");
  const patchCanvas = document.createElement("canvas");
  const patchContext = patchCanvas.getContext("2d");
  if (!patchContext) throw new Error("瀏覽器無法建立 GIF frame canvas");

  const texture = new THREE.CanvasTexture(canvas);
  // Animated textures are uploaded repeatedly. Mipmaps add substantial work on
  // mobile GPUs without helping this camera-facing AR plane.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const { geometry, material } = createPlane(group, texture);
  const duration = frames.reduce((sum, frame) => sum + delayMs(frame), 0);
  let previousIndex = -1;
  let startAtMs = 0;
  let pausedAtMs: number | null = null;
  let restoreSnapshot: ImageData | null = null;

  const drawThrough = (targetIndex: number): void => {
    if (targetIndex < previousIndex) {
      context.clearRect(0, 0, width, height);
      previousIndex = -1;
      restoreSnapshot = null;
    }
    while (previousIndex < targetIndex) {
      const nextIndex = previousIndex + 1;
      const frame = frames[nextIndex];
      if (!frame) throw new Error(`GIF 畫格 ${nextIndex} 不存在`);
      if (previousIndex >= 0) disposePrevious(frames[previousIndex], context, restoreSnapshot);
      restoreSnapshot = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : null;
      drawFrame(frame, context, patchCanvas, patchContext);
      previousIndex = nextIndex;
    }
    texture.needsUpdate = true;
  };

  drawThrough(0);
  return {
    texture,
    onFound(nowMs) {
      if (pausedAtMs !== null) startAtMs += nowMs - pausedAtMs;
      else if (startAtMs === 0) startAtMs = nowMs;
      pausedAtMs = null;
    },
    onLost() {
      pausedAtMs = performance.now();
    },
    update(nowMs) {
      if (pausedAtMs !== null) return;
      const index = frameAt(frames, (nowMs - startAtMs) % duration);
      if (index !== previousIndex) drawThrough(index);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
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

function frameAt(frames: ParsedFrame[], elapsedMs: number): number {
  let cursor = 0;
  for (let index = 0; index < frames.length; index += 1) {
    cursor += delayMs(frames[index]);
    if (elapsedMs < cursor) return index;
  }
  return frames.length - 1;
}

function delayMs(frame: ParsedFrame | undefined): number {
  // gifuct-js already converts GIF centiseconds to milliseconds.
  return Math.max(MIN_DELAY_MS, frame?.delay ?? 100);
}

function disposePrevious(frame: ParsedFrame | undefined, context: CanvasRenderingContext2D, snapshot: ImageData | null): void {
  if (!frame) return;
  if (frame.disposalType === 2) context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
  else if (frame.disposalType === 3) {
    if (!snapshot) throw new Error("GIF disposal 3 缺少還原畫面");
    context.putImageData(snapshot, 0, 0);
  }
}

function drawFrame(frame: ParsedFrame, context: CanvasRenderingContext2D, patchCanvas: HTMLCanvasElement, patchContext: CanvasRenderingContext2D): void {
  patchCanvas.width = frame.dims.width;
  patchCanvas.height = frame.dims.height;
  // Copy into an ArrayBuffer-backed view for TypeScript's DOM ImageData type.
  const rgba = new Uint8ClampedArray(frame.patch.length);
  rgba.set(frame.patch);
  patchContext.putImageData(new ImageData(rgba, frame.dims.width, frame.dims.height), 0, 0);
  context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
}
