import { pino, type Logger } from 'pino'
import { loadConfig } from './env.js'

let cached: Logger | null = null

export function getLogger(): Logger {
  if (cached) return cached
  const cfg = loadConfig()
  const isProd = process.env.NODE_ENV === 'production'
  cached = pino({
    level: cfg.LOG_LEVEL,
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
  })
  return cached
}
