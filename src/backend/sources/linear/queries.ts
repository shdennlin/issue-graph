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
        estimate
        dueDate
        startedAt
        state { name type }
        team { id key name color }
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
            createdAt
            relatedIssue { identifier }
          }
        }
        createdAt
        updatedAt
        completedAt
        # Newest comment only. Linear orders this connection newest-first, so
        # first:1 is the one we want — measured at +64ms and +2 complexity over
        # a 100-issue page, which is what makes it affordable in the BULK query
        # rather than only in ISSUE_DETAIL_QUERY.
        comments(first: 1) {
          nodes { createdAt }
        }
      }
    }
  }
`

export const RECONCILE_IDENTIFIERS_QUERY = /* GraphQL */ `
  query ReconcileIdentifiers($after: String, $filter: IssueFilter) {
    issues(first: 250, after: $after, filter: $filter) {
      pageInfo { hasNextPage endCursor }
      nodes { identifier }
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
      estimate
      dueDate
      startedAt
      state { name type }
      team { id key name color }
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
        nodes { type createdAt relatedIssue { identifier } }
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

export const PROJECT_DETAIL_QUERY = /* GraphQL */ `
  query ProjectDetail($id: String!) {
    project(id: $id) {
      id
      state
      progress
      startDate
      targetDate
      description
      content
      lead { displayName }
      projectMilestones(first: 50) {
        nodes { id name targetDate sortOrder description progress status }
      }
      projectUpdates(first: 5, orderBy: updatedAt) {
        nodes {
          id
          body
          createdAt
          health
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

export const UPDATE_ISSUE_MUTATION = /* GraphQL */ `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
    }
  }
`

export const ADD_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddComment($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
    }
  }
`
