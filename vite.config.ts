import { defineConfig } from 'vite';
export default defineConfig({ clearScreen: false, build: { outDir: 'dist-ui', emptyOutDir: true }, server: { strictPort: true }, envPrefix: ['VITE_', 'TAURI_ENV_'] });
