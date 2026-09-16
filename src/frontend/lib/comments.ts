import type { IssueComment } from '@shared/types.js'

export function sortCommentsOldestFirst(comments: IssueComment[]): IssueComment[] {
  return comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => {
      const diff = new Date(a.comment.createdAt).getTime() - new Date(b.comment.createdAt).getTime()
      return diff === 0 ? a.index - b.index : diff
    })
    .map(({ comment }) => comment)
}
