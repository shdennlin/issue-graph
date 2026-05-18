import { memo } from 'react'
import type { CSSProperties } from 'react'
import type { NodeProps } from 'reactflow'

export interface ProjectBackdropData {
  /** Display name of the project. Rendered as the backdrop's super-title. */
  projectName: string
  /** Resolved tint color (Linear color or hash fallback). */
  color: string
  /** Completed issue count across all milestones in this project. */
  done: number
  /** Total issue count across all milestones in this project. */
  total: number
}

function ProjectBackdropImpl({ data }: NodeProps<ProjectBackdropData>) {
  return (
    <div
      className="project-backdrop"
      style={{ '--project-tint': data.color } as CSSProperties}
    >
      <div className="project-backdrop-header">
        <span className="project-backdrop-name" style={{ color: data.color }}>
          {data.projectName}
        </span>
        <span className="project-backdrop-count">{data.done}/{data.total}</span>
      </div>
    </div>
  )
}

export const ProjectBackdropNode = memo(ProjectBackdropImpl)
