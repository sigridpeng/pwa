import { z } from "zod";

export const EXPERIENCE_SCHEMA_VERSION = 1 as const;

const safeText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .refine((value) => !/[<>]/u.test(value), "HTML markup is not allowed");

export const experienceSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(80)
  .refine((value) => !["ar", "assets", "studio"].includes(value), "Reserved slug");

export const experienceAssetPathSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, "Asset must be a plain filename")
  .refine((value) => value !== "." && value !== "..", "Invalid asset path");

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const finiteNumber = z.number().finite();

const placementSchema = z
  .object({
    x: finiteNumber.min(-10).max(10),
    y: finiteNumber.min(-10).max(10),
    z: finiteNumber.min(-1).max(1),
    width: finiteNumber.positive().max(10),
    rotationDeg: finiteNumber.min(-360).max(360),
    opacity: finiteNumber.min(0).max(1),
  })
  .strict();

const playbackSchema = z
  .object({
    loop: z.boolean(),
    speed: finiteNumber.min(0.25).max(2),
    startOnFound: z.boolean(),
    resetOnLost: z.boolean(),
  })
  .strict();

const baseEffectShape = {
  sha256: sha256Schema,
  intrinsicWidth: z.number().int().positive().max(4096),
  intrinsicHeight: z.number().int().positive().max(4096),
  placement: placementSchema,
};

const effectSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("png"),
      file: experienceAssetPathSchema.refine((value) => value.endsWith(".png")),
      ...baseEffectShape,
    })
    .strict(),
  z
    .object({
      type: z.literal("gif"),
      file: experienceAssetPathSchema.refine((value) => value.endsWith(".gif")),
      ...baseEffectShape,
      playback: playbackSchema,
    })
    .strict(),
]);

export const experienceManifestSchema = z
  .object({
    schemaVersion: z.literal(EXPERIENCE_SCHEMA_VERSION),
    id: z.uuid(),
    slug: experienceSlugSchema,
    title: safeText(120),
    description: safeText(500).optional(),
    target: z
      .object({
        mindFile: experienceAssetPathSchema.refine((value) => value.endsWith(".mind")),
        previewFile: experienceAssetPathSchema.refine((value) =>
          /\.(?:png|jpe?g|webp)$/iu.test(value),
        ),
        sourceAspectRatio: finiteNumber.positive().max(20),
        targetIndex: z.literal(0),
        sha256: sha256Schema,
      })
      .strict(),
    effect: effectSchema,
    tracking: z
      .object({
        warmupMs: z.number().int().min(0).max(5_000),
        lostGraceMs: z.number().int().min(0).max(5_000),
        fadeInMs: z.number().int().min(0).max(5_000),
        fadeOutMs: z.number().int().min(0).max(5_000),
        filterMinCF: finiteNumber.positive().max(10).optional(),
        filterBeta: finiteNumber.min(0).max(10_000).optional(),
        missTolerance: z.number().int().min(0).max(10).optional(),
        warmupTolerance: z.number().int().min(0).max(10).optional(),
      })
      .strict(),
    ui: z
      .object({
        scanHint: safeText(200),
        foundHint: safeText(200).optional(),
        themeColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
        showTargetThumbnail: z.boolean(),
      })
      .strict(),
    privacy: z.object({ cameraFramesStayOnDevice: z.literal(true) }).strict(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ExperienceManifest = z.infer<typeof experienceManifestSchema>;
export type ExperienceEffect = ExperienceManifest["effect"];
export type EffectPlacement = ExperienceEffect["placement"];
