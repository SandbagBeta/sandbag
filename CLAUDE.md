# CLAUDE.md — project brain for AI agents

You are working on **SandBag**, an open-source 3D boulder visualizer. Read this fully before touching code. The spec is [docs/PRD.md](docs/PRD.md); the roadmap and agent workflow is [PLAN.md](PLAN.md).

## Non-negotiable values (PRD §2)

1. **Access privacy is safety-critical.** Any code path that outputs coordinates MUST go through the location-privacy formatter in `src/lib/location.ts` (`getAreaLocation` / `getClimbLocation`; server-only, fails closed to `hidden`). Never add a raw-coords shortcut. Lint enforces this: `sandbag/no-raw-coordinates` (`eslint-rules/`) fails CI on geo fields (`lat`/`lng`/`bbox`/…), coordinate GraphQL selections and `*_coords` tables outside `src/lib/location.ts`. Disabling it on a line needs a written reason. `location_privacy: hidden` areas must never leak coords — not in APIs, logs, OG tags, or exports.
2. **Open data.** Never add features that lock contributed data behind auth or obscure formats. Exports stay documented and complete.
3. **Don't duplicate OpenBeta.** Climbing metadata (areas, routes, grades-of-record) comes from OpenBeta; we store the 3D layer only.

## Architecture (PRD §7)

Next.js App Router (TypeScript, Tailwind) on Vercel · react-three-fiber + drei for 3D · Supabase: Postgres (+RLS), Auth, Storage, Edge Functions for the QC pipeline · canonical mesh format: compressed GLB.

## Conventions

- **Branches:** `feat/<issue#>-<slug>`, `fix/<issue#>-<slug>`. One issue = one PR. Squash-merge only. Never push to `main`.
- **Every PR:** includes tests for its logic, updates docs it invalidates, references `Closes #NN`.
- **Types are contracts:** shared types live in `src/lib/types.ts`. Don't fork shapes locally. Schema changes are their own PR, landed before dependent features.
- **State machine discipline:** scan/climb status transitions ONLY through the lifecycle module — no ad-hoc `status` writes.
- **Keep diffs small:** target ≤400 lines. If the issue needs more, say so in the PR and split.
- **Commands:** `pnpm dev` / `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm seed`. All must pass before opening a PR.
- **Stay in your lane:** issues carry `lane:*` labels (frontend / backend / 3d / infra / docs). Cross-lane changes (e.g. a frontend issue needing a schema tweak) → stop, comment on the issue, don't improvise schema.

## Role instructions

Specialized guidance per lane lives in [.claude/agents/](.claude/agents/): `frontend.md`, `backend.md`, `pipeline-3d.md`, `reviewer.md`. Read the one matching your issue's lane label.

## Definition of done for any issue

Acceptance checks in the issue pass · CI green · no values violations · docs current · PR description explains *why*, links the issue, and notes anything a reviewer should look hardest at.
