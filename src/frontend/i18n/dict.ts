// Type-only export. The English dictionary is the canonical shape — every
// other locale must structurally match it. Locale files declare their object
// as `const xx: Dict = { ... }` so a missing or mistyped key is a
// compile-time error rather than a runtime "key not found".
//
// We widen string literals from `typeof en` to plain `string` so other
// locales can supply their own translations (otherwise `as const` on en.ts
// would require zh-TW values to be byte-identical to English).

import type { en } from './locales/en'

type Widen<T> = T extends string
  ? string
  : T extends ReadonlyArray<infer U>
    ? Widen<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Widen<T[K]> }
      : T

export type Dict = Widen<typeof en>
