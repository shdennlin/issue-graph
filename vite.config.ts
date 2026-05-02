import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = Number(env.PORT) || 31415
  const vitePort = Number(env.VITE_PORT) || 31414
  return {
    root: 'src/frontend',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@frontend': fileURLToPath(new URL('./src/frontend', import.meta.url)),
      },
    },
    server: {
      port: vitePort,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: '../../dist',
      emptyOutDir: true,
      sourcemap: true,
    },
  }
})
