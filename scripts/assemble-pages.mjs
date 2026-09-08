import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "_site");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(root, "pages", "index.html"), resolve(output, "index.html"));
cpSync(resolve(root, "spikes", "mindar-png", "dist"), resolve(output, "png"), { recursive: true });
cpSync(resolve(root, "spikes", "mindar-gif", "dist"), resolve(output, "gif"), { recursive: true });
