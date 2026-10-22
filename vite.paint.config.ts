import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    emptyOutDir: false,
    rollupOptions: { input: 'paint.html' },
  },
});
