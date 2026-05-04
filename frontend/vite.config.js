import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // SPA fallback — serve index.html for all routes (/, /app, etc.)
    historyApiFallback: true,
    proxy: {
      // SSE streaming endpoint — needs special handling to prevent buffering
      '/api/rag/chat/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // selfHandleResponse: false lets http-proxy stream the response
        // directly without buffering it in memory first
        selfHandleResponse: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Tell any upstream proxy/nginx not to buffer
            proxyReq.setHeader('X-Accel-Buffering', 'no');
          });
          proxy.on('proxyRes', (proxyRes) => {
            // Ensure the SSE content-type is preserved
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
