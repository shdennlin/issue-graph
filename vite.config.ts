import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: 'src/frontend',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@frontend': fileURLToPath(new URL('./src/frontend', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:31415',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
