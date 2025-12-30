import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [glsl()],
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
