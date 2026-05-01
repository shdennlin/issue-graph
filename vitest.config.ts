import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@backend': fileURLToPath(new URL('./src/backend', import.meta.url)),
      '@frontend': fileURLToPath(new URL('./src/frontend', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
  },
})
