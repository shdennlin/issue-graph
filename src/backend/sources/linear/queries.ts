// GraphQL queries against Linear's public API. PRD §5.3.

export const ISSUES_QUERY = /* GraphQL */ `
  query GraphData($after: String, $filter: IssueFilter) {
    issues(first: 100, after: $after, filter: $filter) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        url
        priority
        state { name type }
        assignee { id displayName email }
        labels(first: 30) {
          nodes {
            id
            name
            color
            parent { id name }
          }
        }
        cycle { number startsAt endsAt }
        project { id name }
        parent { identifier }
        children(first: 20) { nodes { identifier } }
        relations(first: 30) {
          nodes {
            type
            relatedIssue { identifier }
          }
        }
        createdAt
        updatedAt
        completedAt
      }
    }
  }
`

export const ISSUE_DETAIL_QUERY = /* GraphQL */ `
  query IssueDetail($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      priority
      state { name type }
      assignee { id displayName email }
      labels(first: 30) {
        nodes { id name color parent { id name } }
      }
      cycle { number startsAt endsAt }
      project { id name }
      parent { identifier }
      children(first: 20) { nodes { identifier } }
      relations(first: 30) {
        nodes { type relatedIssue { identifier } }
      }
      createdAt
      updatedAt
      completedAt
    }
  }
`

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer { id displayName email }
  }
`

export const LABELS_QUERY = /* GraphQL */ `
  query Labels($after: String) {
    issueLabels(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        color
        parent { id name }
      }
    }
  }
`
