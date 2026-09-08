import type { SpikeConfig } from "./types.js";
import { SpikeSession } from "./session.js";

export function mountSpike(config: SpikeConfig): void {
  const viewport = requiredElement("viewport");
  const startButton = requiredButton("start");
  const stopButton = requiredButton("stop");
  const status = requiredElement("status");
  const session = new SpikeSession(config, viewport);
  let sessionRequested = false;

  const setStatus = (message: string): void => {
    status.textContent = message;
  };

  startButton.addEventListener("click", async () => {
    sessionRequested = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    try {
      await session.start(setStatus);
    } catch (error) {
      sessionRequested = false;
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const diagnostic = await diagnoseStartFailure(error);
        console.error("[Image AR] 啟動失敗", diagnostic, error);
        setStatus(diagnostic.message);
      }
      startButton.disabled = false;
      stopButton.disabled = true;
      await session.stop();
    }
  });

  stopButton.addEventListener("click", async () => {
    sessionRequested = false;
    stopButton.disabled = true;
    await session.stop();
    startButton.disabled = false;
    setStatus("相機已停止，所有 tracks 與 WebGL 資源已釋放");
  });

  window.addEventListener("pagehide", () => void session.stop(), { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || !sessionRequested) return;
    sessionRequested = false;
    startButton.disabled = true;
    stopButton.disabled = true;
    setStatus("頁面已進入背景，正在停止相機…");
    void session.stop().finally(() => {
      startButton.disabled = false;
      setStatus("切換至背景後相機已停止，請重新開啟");
    });
  });
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} must be a button`);
  return element;
}

interface StartFailureDiagnostic {
  readonly message: string;
  readonly errorName: string;
  readonly cameraPermission: PermissionState | "unsupported" | "unknown";
  readonly secureContext: boolean;
  readonly hasMediaDevices: boolean;
}

async function diagnoseStartFailure(error: unknown): Promise<StartFailureDiagnostic> {
  const cameraPermission = await readCameraPermission();
  const errorName = readErrorName(error);
  const errorMessage = readErrorMessage(error);

  let message = errorMessage ? `無法啟動 AR：${errorMessage}` : "無法啟動 AR";
  if (cameraPermission === "denied") {
    message = "無法啟動 AR：此網站的相機權限已被封鎖，請在 Chrome 網站設定中重設相機權限";
  } else if (!navigator.mediaDevices?.getUserMedia) {
    message = "無法啟動 AR：瀏覽器不支援相機 API";
  } else if (!window.isSecureContext) {
    message = "無法啟動 AR：必須透過 HTTPS 或 localhost 開啟";
  } else if (!errorMessage) {
    message = "無法啟動 AR：相機啟動失敗，但 MindAR 未提供詳細錯誤";
  }

  return {
    message,
    errorName,
    cameraPermission,
    secureContext: window.isSecureContext,
    hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
  };
}

async function readCameraPermission(): Promise<StartFailureDiagnostic["cameraPermission"]> {
  if (!navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

function readErrorName(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) return error.name;
  if (isRecord(error) && typeof error.name === "string") return error.name;
  return typeof error;
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof DOMException || error instanceof Error) return error.message || error.name;
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
