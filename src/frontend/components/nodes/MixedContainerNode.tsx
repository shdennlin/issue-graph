import { memo } from 'react'
import type { NodeProps } from 'reactflow'

interface MixedContainerData {
  bucket: { id: string; name: string; color: string; count: number }
}

function MixedContainerImpl({ data }: NodeProps<MixedContainerData>) {
  const b = data.bucket
  return (
    <div
      className="mixed-container"
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: '8px 12px',
        position: 'relative',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: b.color || 'var(--fg)' }}>
        {b.name} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({b.count})</span>
      </div>
    </div>
  )
}

export const MixedContainerNode = memo(MixedContainerImpl)
