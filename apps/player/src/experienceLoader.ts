import {
  experienceManifestSchema,
  experienceSlugSchema,
  type ExperienceManifest,
} from "@image-ar/contracts";
import { PlayerError } from "./playerError.js";

export interface LoadedExperience {
  readonly manifest: ExperienceManifest;
  readonly baseUrl: URL;
  assetUrl(path: string): URL;
}

export interface VerifiedAsset {
  readonly bytes: ArrayBuffer;
  readonly objectUrl: string;
  dispose(): void;
}

export async function loadExperience(
  slugInput: string,
  appBaseUrl: string,
  signal?: AbortSignal,
): Promise<LoadedExperience> {
  const slug = experienceSlugSchema.safeParse(slugInput);
  if (!slug.success) throw assetError("作品網址格式不正確。", slug.error);

  const rootUrl = new URL(appBaseUrl, window.location.origin);
  const baseUrl = new URL(`experiences/${slug.data}/`, ensureTrailingSlash(rootUrl));
  assertSameOrigin(baseUrl);

  const response = await fetch(new URL("experience.json", baseUrl), {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw assetError(`找不到作品內容（HTTP ${response.status}）。`);
  }

  let input: unknown;
  try {
    input = await response.json();
  } catch (error) {
    throw assetError("作品 manifest 不是有效的 JSON。", error);
  }
  const parsed = experienceManifestSchema.safeParse(input);
  if (!parsed.success) throw assetError("作品 manifest 格式不相容或已損壞。", parsed.error);
  if (parsed.data.slug !== slug.data) throw assetError("作品 slug 與網址不一致。");

  return {
    manifest: parsed.data,
    baseUrl,
    assetUrl(path) {
      const url = new URL(path, baseUrl);
      assertContainedAssetUrl(url, baseUrl);
      return url;
    },
  };
}

export async function loadVerifiedAsset(
  url: URL,
  expectedSha256: string,
  signal: AbortSignal,
): Promise<VerifiedAsset> {
  assertSameOrigin(url);
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw assetError(`素材載入失敗（HTTP ${response.status}）。`);
  const bytes = await response.arrayBuffer();
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) throw assetError("素材雜湊不符，內容可能已損壞。");
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get("content-type") ?? "" }));
  return {
    bytes,
    objectUrl,
    dispose() {
      URL.revokeObjectURL(objectUrl);
    },
  };
}

export function experienceSlugFromPath(pathname: string, appBaseUrl: string): string | null {
  const basePath = new URL(appBaseUrl, window.location.origin).pathname.replace(/\/$/u, "");
  const relativePath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  const match = /^\/ar\/([^/]+)\/?$/u.exec(relativePath);
  return match?.[1] ?? null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.pathname.endsWith("/") ? url.href : `${url.href}/`);
}

function assertSameOrigin(url: URL): void {
  if (url.origin !== window.location.origin) throw assetError("只允許載入同源作品素材。");
}

function assertContainedAssetUrl(url: URL, baseUrl: URL): void {
  assertSameOrigin(url);
  if (!url.pathname.startsWith(baseUrl.pathname)) {
    throw assetError("作品素材路徑超出允許的目錄。");
  }
}

function assetError(message: string, cause?: unknown): PlayerError {
  return new PlayerError("ASSET_INVALID", message.trim(), { cause });
}
