import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ICD-NetworkViz/',
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  publicDir: 'data'
});
