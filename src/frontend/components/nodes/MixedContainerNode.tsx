import { memo } from 'react'
import type { CSSProperties } from 'react'
import type { NodeProps } from 'reactflow'

interface MixedContainerData {
  bucket: { id: string; name: string; color: string; count: number }
}

function MixedContainerImpl({ data }: NodeProps<MixedContainerData>) {
  const b = data.bucket
  // The bucket's accent color is exposed as a CSS variable so the container's
  // tinted background + border can be color-mixed against it (per-bucket
  // visual identity) without splattering inline styles across multiple
  // properties.
  const tint = b.color || 'var(--fg-muted)'
  return (
    <div
      className="mixed-container"
      style={{ '--bucket-tint': tint } as CSSProperties}
    >
      <div className="mixed-container-header">
        <span className="mixed-container-name" style={{ color: tint }}>{b.name}</span>
        <span className="mixed-container-count">{b.count}</span>
      </div>
    </div>
  )
}

export const MixedContainerNode = memo(MixedContainerImpl)
