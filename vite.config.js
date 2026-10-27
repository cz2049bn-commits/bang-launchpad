import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: '@bia/i18n' },
  resolve: { alias: { '@bia/i18n': fileURLToPath(new URL('./src/i18n', import.meta.url)) } },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:5210', changeOrigin: true, configure(proxy) { proxy.on('proxyReq', (out, req) => { if (req.headers.origin === 'http://127.0.0.1:5211' || req.headers.origin === 'http://localhost:5211') out.setHeader('Origin', 'http://127.0.0.1:5210'); }); } } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 650 },
});
