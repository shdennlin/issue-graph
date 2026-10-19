// Pan/zoom chrome for a rendered mermaid SVG or an inline image — either can
// come out much larger than the panel (a 13-node architecture graph at
// native size; a full-resolution screenshot pasted into a Linear comment),
// so showing it at 1:1 would either get clipped or force the whole panel to
// scroll past it. Fits it to a bounded viewport instead (like object-fit:
// contain) and lets the viewport itself be a drag-to-pan / wheel-to-zoom
// canvas, plus an expand button that reopens the same media in a larger,
// viewport-filling overlay — the "click to view it bigger" Notion-embed
// pattern, built with plain DOM/events since this runs inside
// dangerouslySetInnerHTML content, not a mounted React tree.

type MediaEl = SVGSVGElement | HTMLImageElement

const MIN_SCALE = 0.25
const MAX_SCALE = 6

interface PanZoomState {
  scale: number
  tx: number
  ty: number
  naturalW: number
  naturalH: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function applyTransform(stage: HTMLElement, state: PanZoomState) {
  stage.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
}

// "Contain" fit — scales (up or down) so the whole diagram is visible
// inside the viewport on whichever axis is more constraining, then centers
// it. Re-run on container resize so a panel that goes from docked to wide
// mode re-fits instead of leaving the diagram off-center.
function fitToViewport(viewport: HTMLElement, stage: HTMLElement, state: PanZoomState) {
  const vw = viewport.clientWidth
  const vh = viewport.clientHeight
  if (vw === 0 || vh === 0 || state.naturalW === 0 || state.naturalH === 0) return
  state.scale = Math.min(vw / state.naturalW, vh / state.naturalH)
  state.tx = (vw - state.naturalW * state.scale) / 2
  state.ty = (vh - state.naturalH * state.scale) / 2
  applyTransform(stage, state)
}

// Zooms toward a point (the cursor, for wheel zoom; the viewport's own
// center for the +/- buttons) by solving for the translate that keeps that
// point visually stationary under the new scale.
function zoomAt(viewport: HTMLElement, stage: HTMLElement, state: PanZoomState, factor: number, clientX?: number, clientY?: number) {
  const rect = viewport.getBoundingClientRect()
  const cx = clientX !== undefined ? clientX - rect.left : rect.width / 2
  const cy = clientY !== undefined ? clientY - rect.top : rect.height / 2
  const nextScale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE)
  const ratio = nextScale / state.scale
  state.tx = cx - (cx - state.tx) * ratio
  state.ty = cy - (cy - state.ty) * ratio
  state.scale = nextScale
  applyTransform(stage, state)
}

// Binds drag-to-pan and wheel-to-zoom once for a given viewport/stage pair.
// Safe to call exactly once per element — called once per inline diagram
// (each gets its own fresh viewport) and once for the whole lifetime of the
// shared overlay (which reuses one viewport across every "expand" click, so
// re-binding per open would stack duplicate listeners).
function bindPanZoom(viewport: HTMLElement, stage: HTMLElement, state: PanZoomState) {
  let dragging = false
  let lastX = 0
  let lastY = 0
  viewport.addEventListener('pointerdown', (e) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    viewport.setPointerCapture(e.pointerId)
    viewport.classList.add('is-dragging')
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return
    state.tx += e.clientX - lastX
    state.ty += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    applyTransform(stage, state)
  })
  const stopDrag = () => { dragging = false; viewport.classList.remove('is-dragging') }
  viewport.addEventListener('pointerup', stopDrag)
  viewport.addEventListener('pointercancel', stopDrag)
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.0015)
    zoomAt(viewport, stage, state, factor, e.clientX, e.clientY)
  }, { passive: false })
  viewport.addEventListener('dblclick', () => fitToViewport(viewport, stage, state))
  new ResizeObserver(() => fitToViewport(viewport, stage, state)).observe(viewport)
}

function readNaturalSize(media: MediaEl): { w: number; h: number } {
  if (media instanceof HTMLImageElement) {
    const w = media.naturalWidth || parseFloat(media.getAttribute('width') ?? '') || 600
    const h = media.naturalHeight || parseFloat(media.getAttribute('height') ?? '') || 400
    return { w, h }
  }
  let w = parseFloat(media.getAttribute('width') ?? '')
  let h = parseFloat(media.getAttribute('height') ?? '')
  if (!(w > 0) || !(h > 0)) {
    const viewBox = media.getAttribute('viewBox')
    const parts = viewBox?.trim().split(/\s+/).map(Number)
    const [, , vbW, vbH] = parts ?? []
    if (parts?.length === 4 && parts.every((n) => Number.isFinite(n)) && vbW !== undefined && vbH !== undefined) {
      w = vbW
      h = vbH
    }
  }
  if (!(w > 0) || !(h > 0)) {
    const rect = media.getBoundingClientRect()
    w = rect.width || 600
    h = rect.height || 400
  }
  return { w, h }
}

// mermaid's own SVG output sizes itself with width/height (often 100%)
// meant to stretch to its container; a plain <img> has the opposite
// problem, no sizing at all beyond its intrinsic pixels — both need
// pinning to their measured natural size so the stage's transform math has
// a stable reference, since the stage is scaled by transform, not by
// letting the element's own size do the work.
function pinNaturalSize(media: MediaEl, w: number, h: number) {
  media.removeAttribute('width')
  media.removeAttribute('height')
  media.style.width = `${w}px`
  media.style.height = `${h}px`
  media.style.display = 'block'
  media.style.maxWidth = 'none'
}

function toolbarHtml(withExpand: boolean): string {
  return `
    <div class="mermaid-toolbar">
      <button type="button" class="mermaid-btn" data-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
      <button type="button" class="mermaid-btn" data-action="zoom-reset" aria-label="Fit to view" title="Fit to view">⤢</button>
      <button type="button" class="mermaid-btn" data-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
      ${withExpand ? '<button type="button" class="mermaid-btn mermaid-btn-expand" data-action="expand" aria-label="Expand diagram" title="Expand">⛶</button>' : ''}
    </div>`
}

function bindToolbar(root: ParentNode, viewport: HTMLElement, stage: HTMLElement, state: PanZoomState, onExpand?: () => void) {
  root.querySelectorAll<HTMLButtonElement>('.mermaid-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      switch (btn.dataset.action) {
        case 'zoom-in': zoomAt(viewport, stage, state, 1.3); break
        case 'zoom-out': zoomAt(viewport, stage, state, 1 / 1.3); break
        case 'zoom-reset': fitToViewport(viewport, stage, state); break
        case 'expand': onExpand?.(); break
      }
    }
  })
}

// Lazily-created, reused across every "expand" click in the app — one
// overlay, not one per diagram, so pan/zoom listeners are bound exactly
// once (see bindPanZoom's own note on why rebinding per open is unsafe).
let overlay: HTMLDivElement | null = null
let overlayState: PanZoomState | null = null

function getOverlay(): { overlay: HTMLDivElement; viewport: HTMLElement; stage: HTMLElement; state: PanZoomState } {
  if (overlay && overlayState) {
    return {
      overlay,
      viewport: overlay.querySelector<HTMLElement>('.mermaid-overlay-viewport')!,
      stage: overlay.querySelector<HTMLElement>('.mermaid-stage')!,
      state: overlayState,
    }
  }
  const el = document.createElement('div')
  el.className = 'mermaid-overlay'
  el.innerHTML = `
    <div class="mermaid-overlay-backdrop"></div>
    <div class="mermaid-overlay-panel">
      <div class="mermaid-viewport mermaid-overlay-viewport"><div class="mermaid-stage"></div></div>
      ${toolbarHtml(false)}
      <button type="button" class="mermaid-overlay-close" aria-label="Close">✕</button>
    </div>`
  document.body.appendChild(el)
  const viewport = el.querySelector<HTMLElement>('.mermaid-overlay-viewport')!
  const stage = el.querySelector<HTMLElement>('.mermaid-stage')!
  const state: PanZoomState = { scale: 1, tx: 0, ty: 0, naturalW: 0, naturalH: 0 }
  const close = () => el.classList.remove('is-open')
  el.querySelector('.mermaid-overlay-backdrop')!.addEventListener('click', close)
  el.querySelector('.mermaid-overlay-close')!.addEventListener('click', close)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('is-open')) close()
  })
  bindPanZoom(viewport, stage, state)
  bindToolbar(el, viewport, stage, state)
  overlay = el
  overlayState = state
  return { overlay: el, viewport, stage, state }
}

function openExpanded(media: MediaEl) {
  const { overlay: el, viewport, stage, state } = getOverlay()
  const { w, h } = readNaturalSize(media)
  const clone = media.cloneNode(true) as MediaEl
  stage.replaceChildren(clone)
  pinNaturalSize(clone, w, h)
  state.naturalW = w
  state.naturalH = h
  el.classList.add('is-open')
  requestAnimationFrame(() => fitToViewport(viewport, stage, state))
}

/** Wraps a just-inserted, already-in-the-live-DOM mermaid SVG or image with
 *  the fit/pan/zoom/expand chrome. `container` is the element `media` was
 *  placed into (its only child); replaces that child in place. */
function wireMedia(container: HTMLElement, media: MediaEl) {
  const { w, h } = readNaturalSize(media)

  const viewport = document.createElement('div')
  viewport.className = 'mermaid-viewport'
  const stage = document.createElement('div')
  stage.className = 'mermaid-stage'
  viewport.appendChild(stage)

  container.insertBefore(viewport, media)
  stage.appendChild(media)
  pinNaturalSize(media, w, h)

  const toolbar = document.createElement('div')
  toolbar.innerHTML = toolbarHtml(true)
  container.appendChild(toolbar.firstElementChild!)

  const state: PanZoomState = { scale: 1, tx: 0, ty: 0, naturalW: w, naturalH: h }
  bindPanZoom(viewport, stage, state)
  bindToolbar(container, viewport, stage, state, () => openExpanded(media))
  requestAnimationFrame(() => fitToViewport(viewport, stage, state))
}

/** Wraps a just-inserted, already-in-the-live-DOM mermaid SVG with the
 *  fit/pan/zoom/expand chrome. `container` is the element the SVG was
 *  placed into (its only child); replaces that child in place. */
export function wireMermaidDiagram(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>('svg')
  if (!svg) return
  wireMedia(container, svg)
}

const LARGE_IMAGE_THRESHOLD_W = 560
const LARGE_IMAGE_THRESHOLD_H = 420

/** Finds plain <img> elements inside rendered markdown and, only for ones
 *  large enough to actually overflow a panel (a pasted screenshot, not a
 *  small inline icon or avatar), wraps them with the same fit/pan/zoom/
 *  expand chrome as a mermaid diagram. Idempotent per image (marks each
 *  one it's already handled), so it's safe to call on every re-render. */
export function wireImagesIn(root: ParentNode) {
  root.querySelectorAll<HTMLImageElement>('img:not([data-media-wired])').forEach((img) => {
    img.dataset.mediaWired = '1'
    const consider = () => {
      if (img.naturalWidth <= LARGE_IMAGE_THRESHOLD_W && img.naturalHeight <= LARGE_IMAGE_THRESHOLD_H) return
      const container = document.createElement('div')
      container.className = 'mermaid-diagram'
      img.replaceWith(container)
      container.appendChild(img)
      wireMedia(container, img)
    }
    if (img.complete) consider()
    else img.addEventListener('load', consider, { once: true })
  })
}
