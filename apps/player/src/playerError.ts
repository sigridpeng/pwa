export type PlayerErrorCode =
  | "NOT_ALLOWED"
  | "NOT_FOUND"
  | "NOT_READABLE"
  | "INSECURE_CONTEXT"
  | "WEBGL_UNAVAILABLE"
  | "ASSET_INVALID"
  | "TRACKER_INIT_FAILED";

export class PlayerError extends Error {
  readonly code: PlayerErrorCode;

  constructor(code: PlayerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlayerError";
    this.code = code;
  }
}

export function assertPlayerCapabilities(): void {
  if (!window.isSecureContext) {
    throw new PlayerError("INSECURE_CONTEXT", "必須透過 HTTPS 或 localhost 開啟。");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new PlayerError("NOT_FOUND", "此瀏覽器無法使用相機。");
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!context) {
    throw new PlayerError("WEBGL_UNAVAILABLE", "此瀏覽器或裝置無法建立 WebGL 畫面。");
  }
  context.getExtension("WEBGL_lose_context")?.loseContext();
}

export function normalizePlayerError(error: unknown): PlayerError {
  if (error instanceof PlayerError) return error;
  const name = readErrorName(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new PlayerError(
      "NOT_ALLOWED",
      "相機權限被拒絕。請在瀏覽器的網站設定中允許相機後再試一次。",
      { cause: error },
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new PlayerError("NOT_FOUND", "找不到可用的相機。", { cause: error });
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new PlayerError("NOT_READABLE", "相機可能正被其他 App 或頁面使用。", {
      cause: error,
    });
  }
  return new PlayerError("TRACKER_INIT_FAILED", "AR 追蹤引擎啟動失敗，請稍後重試。", {
    cause: error,
  });
}

function readErrorName(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException) return error.name;
  if (typeof error === "object" && error && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return "UnknownError";
}
