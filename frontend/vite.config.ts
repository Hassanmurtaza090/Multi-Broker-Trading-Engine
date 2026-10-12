import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest 5: the `test` block requires vitest's own defineConfig (vite 8
// dropped the inline-test-key typing). All vite fields work as before.
// https://vitest.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev proxy to the M10 gateway (`python backend/main.py` → :8000).
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
  },
});
