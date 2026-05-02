---
linear: TEAM-12
---

# CSV export — switch to streaming

## Why

Exports >10k rows OOM the API. Switch to streaming via cursor + chunked transfer.

## What changes

- `/api/export.csv` uses `pg-cursor` instead of full SELECT.
- Response sets `Transfer-Encoding: chunked`.
- Client-side download progress via Content-Length hint (best-effort).
