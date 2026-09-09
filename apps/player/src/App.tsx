import { ArSessionController, type ArSessionState } from "@image-ar/ar-core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  experienceSlugFromPath,
  loadExperience,
  type LoadedExperience,
} from "./experienceLoader.js";
import {
  assertPlayerCapabilities,
  normalizePlayerError,
  PlayerError,
} from "./playerError.js";

const initialSessionState: ArSessionState = { kind: "idle" };

export function App(): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ArSessionController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startAttemptRef = useRef(0);
  const startPendingRef = useRef(false);
  const [experience, setExperience] = useState<LoadedExperience | null>(null);
  const [sessionState, setSessionState] = useState<ArSessionState>(initialSessionState);
  const [loadError, setLoadError] = useState<PlayerError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const slug = useMemo(
    () => experienceSlugFromPath(window.location.pathname, import.meta.env.BASE_URL),
    [],
  );

  useEffect(() => {
    const abortController = new AbortController();
    setExperience(null);
    setLoadError(null);
    if (!slug) {
      setLoadError(new PlayerError("ASSET_INVALID", "作品網址格式不正確。"));
      return () => abortController.abort();
    }
    void loadExperience(slug, import.meta.env.BASE_URL, abortController.signal)
      .then((loaded) => {
        setExperience(loaded);
        document.title = `${loaded.manifest.title} · Image AR`;
        document
          .querySelector('meta[name="theme-color"]')
          ?.setAttribute("content", loaded.manifest.ui.themeColor);
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) setLoadError(normalizePlayerError(error));
      });
    return () => abortController.abort();
  }, [slug, reloadKey]);

  useEffect(() => {
    const stopForBackground = (): void => {
      if (!document.hidden) return;
      void stopSession("切換至背景後相機已停止，請重新開啟。");
    };
    const stopForPageHide = (): void => {
      void stopSession();
    };
    document.addEventListener("visibilitychange", stopForBackground);
    window.addEventListener("pagehide", stopForPageHide);
    return () => {
      document.removeEventListener("visibilitychange", stopForBackground);
      window.removeEventListener("pagehide", stopForPageHide);
      ++startAttemptRef.current;
      startPendingRef.current = false;
      const controller = controllerRef.current;
      controllerRef.current = null;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      void controller?.stop();
    };
  }, []);

  const active = isSessionActive(sessionState);
  const status = statusText(sessionState, experience);

  async function startSession(): Promise<void> {
    const viewport = viewportRef.current;
    if (!experience || !viewport || active || startPendingRef.current) return;
    const attempt = ++startAttemptRef.current;
    startPendingRef.current = true;
    setLoadError(null);
    setNotice(null);
    try {
      assertPlayerCapabilities();
      let controller = controllerRef.current;
      if (!controller) {
        setSessionState({ kind: "loading-assets" });
        const [{ MindArAdapter }, { loadArAssets }] = await Promise.all([
          import("./ar/MindArAdapter.js"),
          import("./ar/loadArAssets.js"),
        ]);
        if (attempt !== startAttemptRef.current || document.hidden) {
          throw new DOMException("AR session start cancelled", "AbortError");
        }
        controller = new ArSessionController({
          createAdapter: () => new MindArAdapter(),
          loadAssets: (signal) => loadArAssets(experience, signal),
          tracking: {
            warmupMs: experience.manifest.tracking.warmupMs,
            lostGraceMs: experience.manifest.tracking.lostGraceMs,
          },
          adapterOptions: {
            filterMinCF: experience.manifest.tracking.filterMinCF ?? 0.05,
            filterBeta: experience.manifest.tracking.filterBeta ?? 1_000,
            warmupTolerance: experience.manifest.tracking.warmupTolerance ?? 1,
            missTolerance: experience.manifest.tracking.missTolerance ?? 0,
          },
        });
        controllerRef.current = controller;
        unsubscribeRef.current = controller.subscribe(setSessionState);
      }
      await controller.start(viewport);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const playerError = normalizePlayerError(error);
        setLoadError(playerError);
        setSessionState({ kind: "error", error: playerError });
      }
    } finally {
      if (attempt === startAttemptRef.current) startPendingRef.current = false;
    }
  }

  async function stopSession(completionMessage?: string): Promise<void> {
    ++startAttemptRef.current;
    startPendingRef.current = false;
    const controller = controllerRef.current;
    controllerRef.current = null;
    try {
      if (controller) await controller.stop();
    } catch (error) {
      setLoadError(normalizePlayerError(error));
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setSessionState({ kind: "stopped" });
    if (completionMessage) setNotice(completionMessage.trim());
  }

  if (!experience) {
    return (
      <main className="loading-page">
        <section className="card" aria-live="polite">
          <p className="eyebrow">Image AR</p>
          <h1>{loadError ? "無法載入作品" : "正在載入作品…"}</h1>
          {loadError && (
            <>
              <p className="error-message">{loadError.message}</p>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
                重新載入
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  const previewUrl = experience.assetUrl(experience.manifest.target.previewFile);

  return (
    <main className={`player ${active ? "is-active" : ""}`}>
      <div ref={viewportRef} className="ar-viewport" aria-hidden="true" />
      {!active && (
        <section className="welcome-panel">
          <p className="eyebrow">Image AR Experience</p>
          <h1>{experience.manifest.title}</h1>
          {experience.manifest.description && <p>{experience.manifest.description}</p>}
          {experience.manifest.ui.showTargetThumbnail && (
            <img className="target-preview" src={previewUrl.href} alt="要辨識的目標圖像" />
          )}
          <p className="privacy-copy">
            相機畫面只在妳的裝置中用來辨識圖像，不會拍照、錄影或上傳。離開此頁後，相機會立即停止。
          </p>
          {notice && <p className="notice-message">{notice}</p>}
          {loadError && <p className="error-message">{loadError.message}</p>}
          <button className="primary-button" type="button" onClick={() => void startSession()}>
            開啟相機
          </button>
        </section>
      )}
      {active && (
        <div className="camera-ui">
          <p className="status-pill" role="status" aria-live="polite">
            {status}
          </p>
          <button className="stop-button" type="button" onClick={() => void stopSession()}>
            停止相機
          </button>
        </div>
      )}
    </main>
  );
}

function isSessionActive(state: ArSessionState): boolean {
  return !["idle", "stopped", "error"].includes(state.kind);
}

function statusText(state: ArSessionState, experience: LoadedExperience | null): string {
  switch (state.kind) {
    case "loading-assets":
      return "正在驗證作品素材…";
    case "requesting-permission":
      return "正在開啟後鏡頭…";
    case "tracking":
      return experience?.manifest.ui.foundHint ?? "已辨識圖像";
    case "warming-up":
      return "正在確認圖像…";
    case "temporarily-lost":
    case "scanning":
      return experience?.manifest.ui.scanHint ?? "請將鏡頭對準圖像";
    case "error":
      return "AR 啟動失敗";
    case "idle":
    case "stopped":
      return "相機尚未開啟";
  }
}
