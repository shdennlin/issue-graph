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
        project { id name color }
        projectMilestone { id name targetDate sortOrder }
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
      projectMilestone { id name targetDate sortOrder }
      parent { identifier }
      children(first: 20) { nodes { identifier } }
      relations(first: 30) {
        nodes { type relatedIssue { identifier } }
      }
      createdAt
      updatedAt
      completedAt
      comments(first: 50) {
        nodes {
          id
          body
          createdAt
          updatedAt
          user { displayName }
        }
      }
    }
  }
`

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      id
      displayName
      email
      organization { name urlKey }
    }
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

export const WORKFLOW_STATES_QUERY = /* GraphQL */ `
  query WorkflowStates($filter: WorkflowStateFilter) {
    workflowStates(first: 250, filter: $filter) {
      nodes {
        id
        name
        type
        color
        position
        team { key }
      }
    }
  }
`
