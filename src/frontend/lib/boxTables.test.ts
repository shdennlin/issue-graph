import { describe, expect, it } from 'vitest'
import { convertBoxTables } from './boxTables'

describe('convertBoxTables', () => {
  it('leaves text without a box table alone', () => {
    const s = '# hi\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    expect(convertBoxTables(s)).toBe(s)
  })

  it('converts a simple table', () => {
    const src = ['┌───┬───┐', '│ 項目 │ 狀態 │', '├───┼───┤', '│ A │ 完成 │', '└───┴───┘'].join('\n')
    expect(convertBoxTables(src)).toBe('| 項目 | 狀態 |\n| --- | --- |\n| A | 完成 |')
  })

  it('joins a cell that wraps over several lines when rows are ├-separated', () => {
    const src = [
      '┌──┬──┐', '│ h1 │ h2 │', '├──┼──┤',
      '│ one │ x │', '│ two │    │', '├──┼──┤',
      '│ next │ y │', '└──┴──┘',
    ].join('\n')
    expect(convertBoxTables(src)).toBe('| h1 | h2 |\n| --- | --- |\n| one two | x |\n| next | y |')
  })

  it('treats every │ line as a row when only the header has a rule', () => {
    const src = ['┌──┬──┐', '│ h │ k │', '├──┼──┤', '│ a │ 1 │', '│ b │ 2 │', '└──┴──┘'].join('\n')
    expect(convertBoxTables(src)).toBe('| h | k |\n| --- | --- |\n| a | 1 |\n| b | 2 |')
  })

  it('separates the table from surrounding prose and escapes pipes', () => {
    const src = ['before', '┌──┬──┐', '│ a|b │ c │', '├──┼──┤', '│ 1 │ 2 │', '└──┴──┘', 'after'].join('\n')
    expect(convertBoxTables(src)).toBe('before\n\n| a\\|b | c |\n| --- | --- |\n| 1 | 2 |\n\nafter')
  })

  it('does not touch a box inside a fenced code block', () => {
    const src = '```\n┌─┐\n│ a │\n└─┘\n```'
    expect(convertBoxTables(src)).toBe(src)
  })
})
