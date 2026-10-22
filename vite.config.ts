import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __WS_URL__: JSON.stringify(process.env.VITE_WS_URL || ''),
  },
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      // Dev only: local consensus relay (npm run dev:consensus)
      '/consensus-ws': { target: 'ws://localhost:8091', ws: true },
      '/api': {
        target: 'https://live.solanacompass.com',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'client/index.html'),
        classic: resolve(__dirname, 'client/classic.html'),
      },
    },
  },
});
