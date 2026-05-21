import { memo } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import type { NodeProps } from 'reactflow'
import { useViewStore } from '../../store/viewStore'
import { useT } from '../../i18n'

export interface ProjectBackdropData {
  /** Linear project id — null for the synthetic "(No project)" group. */
  projectId: string | null
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
  const openProjectPanel = useViewStore((s) => s.openProjectPanel)
  const t = useT()
  const canOpen = Boolean(data.projectId)

  const onChevronClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (data.projectId) openProjectPanel(data.projectId)
  }
  // React Flow attaches its drag start listener to `pointerdown` on the
  // dragHandle. Stop the chevron's pointerdown from bubbling so a click on
  // the button doesn't initiate a drag of the whole project group.
  const stopPointer = (e: PointerEvent<HTMLButtonElement>) => e.stopPropagation()

  return (
    <div
      className="project-backdrop"
      style={{ '--project-tint': data.color } as CSSProperties}
    >
      <div className="project-backdrop-header">
        {canOpen ? (
          <button
            type="button"
            className="project-backdrop-name project-backdrop-name-btn"
            style={{ color: data.color }}
            onClick={onChevronClick}
            onPointerDown={stopPointer}
            title={t('projectPanel.openDetail')}
          >
            {data.projectName}
          </button>
        ) : (
          <span className="project-backdrop-name" style={{ color: data.color }}>
            {data.projectName}
          </span>
        )}
        <span className="project-backdrop-count">{data.done}/{data.total}</span>
        {canOpen && (
          <button
            type="button"
            className="project-backdrop-open"
            onClick={onChevronClick}
            onPointerDown={stopPointer}
            title={t('projectPanel.openDetail')}
            aria-label={t('projectPanel.openDetail')}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

export const ProjectBackdropNode = memo(ProjectBackdropImpl)
