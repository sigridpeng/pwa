import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pngSource = resolve(root, "spikes", "mindar-png", "public");
const gifSource = resolve(root, "spikes", "mindar-gif", "public");
const experiences = resolve(root, "apps", "player", "public", "experiences");
const pngOutput = resolve(experiences, "demo");
const gifOutput = resolve(experiences, "demo-gif");

mkdirSync(pngOutput, { recursive: true });
copyFileSync(resolve(pngSource, "card.mind"), resolve(pngOutput, "target.mind"));
copyFileSync(resolve(pngSource, "card.png"), resolve(pngOutput, "target-preview.png"));
copyFileSync(resolve(pngSource, "effect.png"), resolve(pngOutput, "effect.png"));

mkdirSync(gifOutput, { recursive: true });
copyFileSync(resolve(gifSource, "card.mind"), resolve(gifOutput, "target.mind"));
copyFileSync(resolve(gifSource, "card.png"), resolve(gifOutput, "target-preview.png"));
copyFileSync(resolve(gifSource, "effect.gif"), resolve(gifOutput, "effect.gif"));
