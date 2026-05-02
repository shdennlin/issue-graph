# Outbound webhook system

Related Linear issues: TEAM-18, TEAM-20

## Why

Customers integrating Lumi need a push channel for `task.created`, `task.updated`,
and `task.completed` events. Polling our REST API works but eats their rate budget.

## What changes

- `webhook_endpoints` table stores per-user URL + secret.
- BullMQ job per outbound delivery, retries with exponential backoff.
- HMAC-SHA256 signature in `X-Lumi-Signature` header.
- Admin UI to manage endpoints, see delivery history, replay failed deliveries.

## Out of scope

- Ingress webhooks (receiving from third parties) — Phase 2.
- WebSockets for browser clients — Phase 2.
