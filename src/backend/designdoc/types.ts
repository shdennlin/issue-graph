import type { DesignDocChange } from '@shared/types.js'

export interface DesignDocAdapter {
  readonly name: string
  detect(repoRoot: string): boolean
  scan(repoRoot: string): DesignDocChange[]
}
