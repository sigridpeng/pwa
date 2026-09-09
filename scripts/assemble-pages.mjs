import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "_site");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(root, "pages", "index.html"), resolve(output, "index.html"));
cpSync(resolve(root, "spikes", "mindar-png", "dist"), resolve(output, "png"), { recursive: true });
cpSync(resolve(root, "spikes", "mindar-gif", "dist"), resolve(output, "gif"), { recursive: true });

const player = resolve(root, "apps", "player", "dist");
cpSync(resolve(player, "assets"), resolve(output, "assets"), { recursive: true });
cpSync(resolve(player, "experiences"), resolve(output, "experiences"), { recursive: true });
for (const entry of readdirSync(resolve(player, "experiences"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const route = resolve(output, "ar", entry.name);
  mkdirSync(route, { recursive: true });
  cpSync(resolve(player, "index.html"), resolve(route, "index.html"));
}
