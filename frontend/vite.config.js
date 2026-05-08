import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // appType: 'spa' tells Vite to serve index.html for all unmatched routes
  // This is the correct Vite equivalent of webpack's historyApiFallback
  appType: 'spa',
  server: {
    port: 5173,
    proxy: {
      // SSE streaming endpoint — needs special handling to prevent buffering
      '/api/rag/chat/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        selfHandleResponse: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('X-Accel-Buffering', 'no');
          });
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        }
      },
      // All other API routes — standard proxy
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
