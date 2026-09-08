import { mountSpike } from "../../shared/ui.js";
import "../../shared/style.css";
import { createGifEffect } from "./gifEffect.js";

mountSpike({ kind: "GIF", effectFile: "effect.gif", createEffect: createGifEffect });
