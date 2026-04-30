# issue-graph

Self-hosted, read-only graph viewer for issue dependencies — fetches from a project-management backend, optionally enriches with local design-doc progress, renders an interactive graph.

> **Status:** PRD approved · Phase 1a not yet started.

## What it shows

- **Dependency view** — `blocks` edges between issues; the default landing view answers "what should I work on next?"
- **Bucket view** — issues grouped by a configurable Linear label group (`service`, `module`, `team`, `area` — auto-detected).
- **Mix view** — buckets as containers + issues inside; cross-bucket `blocks` edges highlighted in red.

## Backends

- v1: [Linear](https://linear.app) (read-only via personal API key)
- Future: Jira, Plane, GitHub Projects (the backend adapter abstraction is in place)

## Quick start

Not yet — see PRD §11.5 for the planned `docker compose up -d` flow.

## Documentation

Full design document: [`docs/PRD.md`](docs/PRD.md) — 20 sections covering:

- Architecture + backend adapter abstraction
- 3-layer label schema (auto-detect → env override → `label-schema.yaml`)
- Optional design-doc integration (Spectra / OpenSpec adapter)
- Deployment topology
- Phasing plan (1a → 1b → 2 → 3 → 4)
- 48 logged decisions with chosen / rejected / reason

## License

[MIT](LICENSE)
