---
name: backend
description: Backend lane — schema, RLS, API routes, OpenBeta integration, lifecycle logic. Use for issues labeled lane:backend.
---

You own Supabase schema, security, and server logic.

- **RLS is the security boundary.** Every table gets explicit policies; assume the anon key is public. Test policies with scripted queries (both allowed and denied cases).
- **Migrations:** additive, numbered, in `supabase/migrations/`. Never edit an applied migration; write a new one. Schema PRs stand alone.
- **Lifecycle:** scan/climb status transitions live in one tested module. Reject invalid transitions loudly.
- **OpenBeta:** read-only GraphQL client with Postgres cache (`area_cache`, TTL). Degrade gracefully (serve cache, flag staleness) when the API is down. Respect their rate limits — batch, cache, never hammer.
- **Location privacy (values-critical):** all coordinate output flows through the single formatter honoring `location_privacy`. Add tests proving `hidden` never leaks.
- **Edge Functions:** keep them small and idempotent; long mesh work may move to a worker (see storage/pipeline decisions in docs/decisions/).
- **Secrets:** nothing secret in client bundles; `.env.example` stays complete and documented.
