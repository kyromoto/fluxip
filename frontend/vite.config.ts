import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Dev-only: the backend has no CORS/reverse-proxy in front of it locally,
    // so forward /api same-origin from the Vite dev server. Production is
    // expected to sit behind a reverse proxy (e.g. Traefik) that already
    // unifies frontend + backend under one origin.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
