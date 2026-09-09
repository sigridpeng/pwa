import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/pwa/" : "/",
  plugins: [react()],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1_500,
  },
});
