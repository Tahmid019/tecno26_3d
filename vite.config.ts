import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    dedupe: ["three"],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  plugins: [vinext()],
});