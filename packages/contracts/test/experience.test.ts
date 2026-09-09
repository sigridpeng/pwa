import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { experienceManifestSchema } from "../src/experience.ts";

const validManifest = {
  schemaVersion: 1,
  id: "f18dd19c-6bd8-4e57-bf64-568e45f40548",
  slug: "demo",
  title: "Demo",
  target: {
    mindFile: "target.mind",
    previewFile: "target-preview.webp",
    sourceAspectRatio: 1.5,
    targetIndex: 0,
    sha256: "a".repeat(64),
  },
  effect: {
    type: "png",
    file: "effect.png",
    sha256: "b".repeat(64),
    intrinsicWidth: 800,
    intrinsicHeight: 400,
    placement: { x: 0, y: 0, z: 0.01, width: 1, rotationDeg: 0, opacity: 1 },
  },
  tracking: { warmupMs: 0, lostGraceMs: 0, fadeInMs: 0, fadeOutMs: 0 },
  ui: { scanHint: "Point at the image", themeColor: "#112233", showTargetThumbnail: true },
  privacy: { cameraFramesStayOnDevice: true },
  createdAt: "2026-09-09T00:00:00+08:00",
  updatedAt: "2026-09-09T00:00:00+08:00",
};

test("accepts a strict v1 manifest", () => {
  assert.equal(experienceManifestSchema.parse(validManifest).slug, "demo");
});

test("rejects traversal and absolute asset paths", () => {
  for (const mindFile of ["../target.mind", "/target.mind", "https://example.test/a.mind"]) {
    assert.equal(
      experienceManifestSchema.safeParse({
        ...validManifest,
        target: { ...validManifest.target, mindFile },
      }).success,
      false,
    );
  }
});

test("rejects HTML-bearing copy, unknown keys, and disabled privacy", () => {
  assert.equal(
    experienceManifestSchema.safeParse({ ...validManifest, title: "<b>Demo</b>" }).success,
    false,
  );
  assert.equal(
    experienceManifestSchema.safeParse({ ...validManifest, unexpected: true }).success,
    false,
  );
  assert.equal(
    experienceManifestSchema.safeParse({
      ...validManifest,
      privacy: { cameraFramesStayOnDevice: false },
    }).success,
    false,
  );
});

test("the Player demo manifest matches its generated fixture assets", () => {
  const manifest = experienceManifestSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/player/public/experiences/demo/experience.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const target = readFileSync(
    new URL("../../../spikes/mindar-png/public/card.mind", import.meta.url),
  );
  const effect = readFileSync(
    new URL("../../../spikes/mindar-png/public/effect.png", import.meta.url),
  );
  assert.equal(createHash("sha256").update(target).digest("hex"), manifest.target.sha256);
  assert.equal(createHash("sha256").update(effect).digest("hex"), manifest.effect.sha256);
});

test("the GIF demo manifest matches its generated fixture assets", () => {
  const manifest = experienceManifestSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/player/public/experiences/demo-gif/experience.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const target = readFileSync(
    new URL("../../../spikes/mindar-gif/public/card.mind", import.meta.url),
  );
  const effect = readFileSync(
    new URL("../../../spikes/mindar-gif/public/effect.gif", import.meta.url),
  );
  assert.equal(createHash("sha256").update(target).digest("hex"), manifest.target.sha256);
  assert.equal(createHash("sha256").update(effect).digest("hex"), manifest.effect.sha256);
});
