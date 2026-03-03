import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    __DEMO_ENABLED__: JSON.stringify(process.env.BUILD_TARGET === 'internal'),
  },
  plugins: [
    react(),
    ...(process.env.ANALYZE === 'true'
      ? [
          visualizer({
            filename: 'dist/bundle-report.html',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('/node_modules/')) return undefined;
          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/react-router-dom/')
          ) {
            return 'react-vendor';
          }
          if (normalizedId.includes('/node_modules/@radix-ui/')) {
            return 'radix-vendor';
          }
          if (normalizedId.includes('/node_modules/@tanstack/react-query/')) {
            return 'query-vendor';
          }
          if (normalizedId.includes('/node_modules/framer-motion/')) {
            return 'motion-vendor';
          }
          if (normalizedId.includes('/node_modules/lucide-react/')) {
            return 'icons-vendor';
          }
          if (
            normalizedId.includes('/node_modules/clsx/') ||
            normalizedId.includes('/node_modules/tailwind-merge/') ||
            normalizedId.includes('/node_modules/class-variance-authority/') ||
            normalizedId.includes('/node_modules/sonner/') ||
            normalizedId.includes('/node_modules/axios/') ||
            normalizedId.includes('/node_modules/zustand/')
          ) {
            return 'ui-utils-vendor';
          }
          if (
            normalizedId.includes('/node_modules/@xyflow/react/') ||
            normalizedId.includes('/node_modules/d3-force/') ||
            normalizedId.includes('/node_modules/dagre/')
          ) {
            return 'graph-vendor';
          }
          if (normalizedId.includes('/node_modules/recharts/')) {
            return 'chart-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
