# Roadmap

Direction, not commitment. Issues and PRs welcome on anything below.

## v1.0 — shipped

- Linear backend (read-only sync, configurable team/scope)
- Views: dependency, bucket, mix, design-doc, timeline
- Spectra/OpenSpec adapter (frontmatter, folder-name, regex-line strategies)
- SQLite persistence, daily snapshots with retention
- Annotations, settings page, PNG export
- Auto-detected label schema with optional `label-schema.yaml` override
- Single-binary Docker image

## v1.1 — next

- [ ] Optional auth (basic-auth or token gate) for non-localhost deployments
- [ ] Resolve the 4 known `react-hooks/exhaustive-deps` warnings in `FilterPanel` and `DetailPanel`
- [ ] Migrate the remaining v7 hook-rule violations (`set-state-in-effect`, `purity`)
- [ ] Document the JSON shape of `/api/export` so users can build their own tools on top

## v1.2+ — likely

- [ ] **GitHub Issues backend** — same `Source` interface as Linear; high-value for OSS teams
- [ ] Multi-workspace / multi-team toggle in the UI (currently env-pinned)
- [ ] Saved views (named filter sets, not just URL params)
- [ ] Bucket view: drag to reorder, collapsible groups

## Maybe — no commitment

- [ ] **Jira backend** — env shape already sketched in `docs/PRD.md` §10
- [ ] Plane / GitLab issue backends
- [ ] Read-write mode (state transitions from the graph itself)
- [ ] WebSocket live updates (currently poll-on-load + manual sync)
- [ ] Themed graph exports (SVG with embedded fonts)

## Not planned

- Replacing Linear/Jira/GitHub UI — this is a *visualizer*, not a tracker
- Multi-tenant SaaS hosting — self-hosted by design
- Mobile app — desktop-first; the mobile web view should still work, but no native app

---

If you want to work on something in **v1.1** or **v1.2+**, open an issue first so we can align on scope.
For **Maybe** items, open an issue to gauge interest before writing code.
