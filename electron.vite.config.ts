import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve('src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve('src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: path.resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: { index: path.resolve('src/renderer/index.html') },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve('src/renderer/src'),
        '@shared': path.resolve('src/shared'),
      },
    },
  },
});
