/**
 * Terminal "box-drawing" tables (┌─┬─┐ / │ a │ b │ / ├─┼─┤ / └─┴─┘) are what
 * a CLI prints and what gets pasted into a note. They are not Markdown, so
 * marked emits them as one paragraph, and a proportional font — CJK especially —
 * cannot keep the columns aligned. This rewrites each such block into a GFM
 * table before marked sees it, so it renders as a real <table> (styled in
 * globals.css) instead of a smear of pipes.
 *
 * Pure string → string so it can be tested without a DOM.
 */

const TOP = /^\s*[┌╭]/
const ROW = /^\s*│/
const SEP = /^\s*[├╞╟]/
const BOTTOM = /^\s*[└╰]/
const FENCE = /^\s*(```|~~~)/

function splitCells(line: string): string[] {
  const t = line.trim()
  // Drop the leading and trailing │, keep the interior ones as separators.
  const inner = t.slice(1, t.endsWith('│') ? -1 : undefined)
  return inner.split('│').map((c) => c.trim())
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/** Rows of cells → GFM table. Returns null when the shape is unusable. */
function toMarkdown(rows: string[][]): string | null {
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (rows.length < 1 || width < 1) return null
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => escapeCell(r[i] ?? ''))
  const [head, ...body] = rows
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [
    line(pad(head!)),
    line(Array.from({ length: width }, () => '---')),
    ...body.map((r) => line(pad(r))),
  ].join('\n')
}

function convertBlock(block: string[]): string | null {
  const hasSep = block.filter((l) => SEP.test(l)).length
  // groups[i] = the │ lines of one logical row (a cell may wrap over several).
  const groups: string[][][] = []
  let current: string[][] = []
  const flush = () => {
    if (current.length) groups.push(current)
    current = []
  }
  for (const l of block) {
    if (ROW.test(l)) current.push(splitCells(l))
    else if (SEP.test(l)) flush()
  }
  flush()

  let rows: string[][]
  if (hasSep >= 2) {
    // Rows are delimited by ├ lines: join each row's wrapped lines per column.
    rows = groups.map((g) => {
      const cols = Math.max(...g.map((c) => c.length))
      return Array.from({ length: cols }, (_, i) =>
        g.map((c) => c[i] ?? '').filter(Boolean).join(' '),
      )
    })
  } else {
    // Only a header rule (or none): every │ line is its own row.
    rows = groups.flat()
  }
  return toMarkdown(rows)
}

export function convertBoxTables(src: string): string {
  if (!/[┌╭]/.test(src)) return src
  const lines = src.split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE.test(line)) inFence = !inFence
    if (inFence || !TOP.test(line)) {
      out.push(line)
      continue
    }
    let j = i
    const block: string[] = []
    while (j < lines.length && (TOP.test(lines[j]!) || ROW.test(lines[j]!) || SEP.test(lines[j]!) || BOTTOM.test(lines[j]!))) {
      block.push(lines[j]!)
      j++
      if (BOTTOM.test(block[block.length - 1]!)) break
    }
    const md = block.length >= 3 ? convertBlock(block) : null
    if (md === null) {
      out.push(line)
      continue
    }
    // Blank lines on both sides, or the table glues onto neighbouring prose.
    if (out.length && out[out.length - 1]!.trim() !== '') out.push('')
    out.push(md)
    if (j < lines.length && lines[j]!.trim() !== '') out.push('')
    i = j - 1
  }
  return out.join('\n')
}
