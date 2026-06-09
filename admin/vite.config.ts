import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone admin SPA for the Terra Gate permission console.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4717",
        changeOrigin: true,
      },
    },
  },
});
