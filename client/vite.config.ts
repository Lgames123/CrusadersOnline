import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
