import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'

export function useTheme(): void {
  const theme = useViewStore((s) => s.theme)
  useEffect(() => {
    const apply = () => {
      let resolved = theme
      if (theme === 'auto') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      document.documentElement.dataset.theme = resolved
    }
    apply()
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    return undefined
  }, [theme])
}
