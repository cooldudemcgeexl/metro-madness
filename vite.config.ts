import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base: './'` emits relative asset URLs, so the built `dist/` folder works whether it is
// served from the domain root or from a sub-path such as https://example.com/transit/.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
