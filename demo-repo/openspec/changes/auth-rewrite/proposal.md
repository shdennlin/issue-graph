---
linear: [TEAM-15, TEAM-21]
---

# Auth rewrite — Auth0 + JWT

## Why

Hand-rolled session cookies don't survive horizontal scaling. Move to Auth0-issued
JWTs so any worker can validate without sharing a session store.

## What changes

- Replace `express-session` middleware with JWT bearer auth.
- Auth0 universal-login redirect flow on the frontend.
- Refresh token rotation, 5-minute access-token TTL.
- Logout endpoint revokes the refresh token at Auth0.

## Out of scope

- Multi-tenant org switching (separate proposal).
- Magic-link login (v1.1).
