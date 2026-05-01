import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'

export function useFontSize(): void {
  const fs = useViewStore((s) => s.fontSize)
  useEffect(() => {
    document.documentElement.dataset.fontsize = fs
  }, [fs])
}
