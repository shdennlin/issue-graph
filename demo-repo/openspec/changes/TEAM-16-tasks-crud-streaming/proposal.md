# Tasks CRUD with streaming pagination

## Why

Initial spec called for cursor pagination at the application layer. Profiling
shows we're round-tripping Postgres for every batch. Switch to a server-side
cursor + chunked response to keep memory flat for very large result sets.

## What changes

- Tasks list endpoint accepts `Accept: application/x-ndjson` for streaming.
- Underlying query uses `pg-cursor` for true streaming.
- Backwards-compatible: JSON array response still supported.

## Out of scope

- Filtering DSL (separate proposal).
