import * as THREE from "three";
import { createPlane } from "../../shared/session.js";
import { mountSpike } from "../../shared/ui.js";
import "../../shared/style.css";

mountSpike({
  kind: "PNG",
  effectFile: "effect.png",
  async createEffect(group, assetUrl) {
    const texture = await new THREE.TextureLoader().loadAsync(assetUrl);
    const { geometry, material } = createPlane(group, texture);
    return {
      texture,
      onFound() {},
      onLost() {},
      update() {},
      dispose() {
        geometry.dispose();
        material.dispose();
        texture.dispose();
      },
    };
  },
});
