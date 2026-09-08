import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { dedupe: ['three'] },
  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },
  plugins: [vinext()],
});
