import { memo } from 'react'
import type { NodeProps } from 'reactflow'

interface BucketNodeData {
  bucket: { id: string; name: string; color: string; count: number }
}

function BucketNodeImpl({ data }: NodeProps<BucketNodeData>) {
  const b = data.bucket
  return (
    <div className="bucket-node" style={{ borderColor: b.color || 'var(--node-border)' }}>
      <div className="name">{b.name}</div>
      <div className="count">{b.count} issue{b.count === 1 ? '' : 's'}</div>
    </div>
  )
}

export const BucketNode = memo(BucketNodeImpl)
