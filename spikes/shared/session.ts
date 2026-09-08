import * as THREE from "three";
import type { MindARThree as MindARThreeType, MindArAnchor } from "mind-ar/dist/mindar-image-three.prod.js";
import type { EffectHandle, SpikeConfig } from "./types.js";

type MindArInstance = InstanceType<typeof MindARThreeType>;

// Tracking fidelity takes priority over visual smoothing. These values keep the
// pose close to the newest measurement and stop rendering on the first miss.
const TRACKING_FILTER_MIN_CUTOFF = 0.05;
const TRACKING_FILTER_BETA = 1000;
const TRACKING_WARMUP_TOLERANCE = 1;
const TRACKING_MISS_TOLERANCE = 0;
const DEBUG_SAMPLE_WINDOW_MS = 1000;

export class SpikeSession {
  readonly #config: SpikeConfig;
  readonly #container: HTMLElement;
  #abortController: AbortController | null = null;
  #effect: EffectHandle | null = null;
  #mindar: MindArInstance | null = null;
  #anchor: MindArAnchor | null = null;
  #rafId: number | null = null;
  #assetUrls: string[] = [];
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  #targetVisible = false;
  #debugElement: HTMLElement | null = null;
  #debugWindowStartedAt = 0;
  #debugUpdateCount = 0;

  constructor(config: SpikeConfig, container: HTMLElement) {
    this.#config = config;
    this.#container = container;
  }

  start(onStatus: (message: string) => void): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    this.#disposed = false;
    this.#abortController = new AbortController();
    this.#startPromise = this.#start(onStatus).finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  async #start(onStatus: (message: string) => void): Promise<void> {
    const signal = this.#abortController?.signal;
    if (!signal) throw new Error("Session abort signal is unavailable");
    assertCapabilities();

    onStatus("正在驗證同源素材…");
    const [targetUrl, effectUrl] = await Promise.all([
      this.#loadAsset("card.mind", signal),
      this.#loadAsset(this.#config.effectFile, signal),
    ]);
    signal.throwIfAborted();

    onStatus("正在載入 AR 引擎（尚未開啟相機）…");
    const { MindARThree } = await import("mind-ar/dist/mindar-image-three.prod.js");
    signal.throwIfAborted();

    const mindar = new MindARThree({
      container: this.#container,
      imageTargetSrc: targetUrl,
      maxTrack: 1,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
      filterMinCF: TRACKING_FILTER_MIN_CUTOFF,
      filterBeta: TRACKING_FILTER_BETA,
      warmupTolerance: TRACKING_WARMUP_TOLERANCE,
      missTolerance: TRACKING_MISS_TOLERANCE,
    });
    this.#mindar = mindar;
    mindar.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const anchor = mindar.addAnchor(0);
    this.#anchor = anchor;
    this.#mountTrackingDiagnostics();
    this.#effect = await this.#config.createEffect(anchor.group, effectUrl);
    signal.throwIfAborted();

    anchor.onTargetFound = () => {
      this.#targetVisible = true;
      this.#effect?.onFound(performance.now());
      onStatus(`已辨識：${this.#config.kind} 特效播放中`);
    };
    anchor.onTargetLost = () => {
      this.#targetVisible = false;
      this.#effect?.onLost();
      onStatus("暫時失去圖像，請重新對準");
    };
    anchor.onTargetUpdate = () => {
      this.#recordTrackingUpdate();
    };

    onStatus("正在開啟後鏡頭…");
    await mindar.start();
    if (signal.aborted) {
      await this.stop();
      throw new DOMException("Session start cancelled", "AbortError");
    }

    onStatus("相機已開啟，請對準下方測試圖");
    this.#render(performance.now());
  }

  async stop(): Promise<void> {
    this.#disposed = true;
    this.#abortController?.abort();
    this.#abortController = null;
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;

    const mindar = this.#mindar;
    this.#mindar = null;
    if (this.#anchor) {
      this.#anchor.onTargetFound = null;
      this.#anchor.onTargetLost = null;
      this.#anchor.onTargetUpdate = null;
      this.#anchor = null;
    }

    stopContainerStreams(this.#container);
    if (mindar) {
      try {
        if (mindar.controller && mindar.video?.srcObject) mindar.stop();
      } catch {
        stopContainerStreams(this.#container);
      }
      mindar.controller?.dispose();
      mindar.renderer.dispose();
      mindar.renderer.forceContextLoss();
    }

    this.#effect?.dispose();
    this.#effect = null;
    this.#targetVisible = false;
    this.#debugElement = null;
    this.#debugWindowStartedAt = 0;
    this.#debugUpdateCount = 0;
    for (const url of this.#assetUrls) URL.revokeObjectURL(url);
    this.#assetUrls = [];
    this.#container.replaceChildren();
  }

  async #loadAsset(path: string, signal: AbortSignal): Promise<string> {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
    const response = await fetch(new URL(path, baseUrl), {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) throw new Error(`素材載入失敗：${path} (${response.status})`);
    const url = URL.createObjectURL(await response.blob());
    this.#assetUrls.push(url);
    return url;
  }

  #render = (nowMs: number): void => {
    if (this.#disposed || !this.#mindar) return;
    if (!document.hidden) {
      if (this.#targetVisible) this.#effect?.update(nowMs);
      this.#mindar.renderer.render(this.#mindar.scene, this.#mindar.camera);
    }
    this.#rafId = requestAnimationFrame(this.#render);
  };

  #mountTrackingDiagnostics(): void {
    if (new URLSearchParams(window.location.search).get("debug") !== "tracking") return;
    const element = document.createElement("output");
    element.className = "tracking-debug";
    element.textContent = "追蹤更新：等待辨識";
    this.#container.appendChild(element);
    this.#debugElement = element;
    this.#debugWindowStartedAt = performance.now();
  }

  #recordTrackingUpdate(): void {
    if (!this.#debugElement) return;
    const nowMs = performance.now();
    this.#debugUpdateCount += 1;
    const elapsedMs = nowMs - this.#debugWindowStartedAt;
    if (elapsedMs < DEBUG_SAMPLE_WINDOW_MS) return;
    const updatesPerSecond = (this.#debugUpdateCount * 1000) / elapsedMs;
    this.#debugElement.textContent = `追蹤更新：${updatesPerSecond.toFixed(1)} Hz · ${this.#targetVisible ? "已貼附" : "未辨識"}`;
    this.#debugWindowStartedAt = nowMs;
    this.#debugUpdateCount = 0;
  }
}

function assertCapabilities(): void {
  if (!window.isSecureContext) throw new Error("必須透過 HTTPS 或 localhost 開啟");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("瀏覽器不支援相機 API");
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) throw new Error("瀏覽器無法建立 WebGL context");
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

function stopContainerStreams(container: HTMLElement): void {
  for (const video of container.querySelectorAll("video")) {
    const stream = video.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

export function createPlane(group: THREE.Group, texture: THREE.Texture): {
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
} {
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(1, 0.55);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0.01;
  group.add(mesh);
  return { geometry, material };
}
