import { defineConfig } from 'vite';

export default defineConfig({
  base: '/colony-sim/',
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
});
