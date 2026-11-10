# 🧗 SandBag

**Open-source 3D boulder visualizer, built on community contribution.**

Climbers scan boulders with their phones, upload the renders, and annotate them in 3D — start holds, the line, topout, downclimb, community grades. Everyone else gets to walk around the boulder before they ever touch rock. All of it open: AGPL-3.0 code, CC BY-SA 4.0 data.

> *sandbag (v.): to rate a climb easier than it actually is. We keep the receipts.*

## How it works

```
📱 scan a boulder (Polycam / Scaniverse / any app that exports GLB/OBJ/PLY)
→ ⬆️ upload — automated quality checks + community review
→ 📍 attach to real climbing data via OpenBeta
→ ✍️ annotate holds, lines, topout, downclimb
→ 🧗 anyone can view in 3D, vote grades, download the open data
```

## Status

🚧 Pre-alpha — building toward v1. See [PLAN.md](PLAN.md) for the roadmap and [docs/PRD.md](docs/PRD.md) for the full product spec. Issues labeled `good-first-issue` are a great place to start.

## Quickstart (dev)

Prereqs: Node 20+, pnpm, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker.

```bash
git clone https://github.com/sandbagbeta/sandbag && cd sandbag
pnpm install
cp .env.example .env.local   # fill in values printed by `supabase start`
supabase start               # local Postgres/Auth/Storage stack
pnpm seed                    # demo scan + fixture climbs
pnpm dev                     # http://localhost:3000
```

*(`supabase start` and `pnpm seed` come online with issues #2 and #8; the app scaffold, lint/typecheck/test/build already work.)*

## Stack

Next.js (App Router, TypeScript) · three.js via react-three-fiber · Supabase (Postgres + Auth + Storage + Edge Functions) · [OpenBeta](https://openbeta.io) GraphQL API for climbing metadata · Vercel.

## Values

Open by default · respect climbing access (sensitive areas stay hidden/fuzzed) · community over moderators · don't duplicate open data — build on OpenBeta · contributor-friendly (free-tier self-host in <10 min). Details in [docs/PRD.md §2](docs/PRD.md).

## Contributing

Humans and AI agents both welcome — this repo is set up for parallel agent development (see [PLAN.md §2](PLAN.md) and [CLAUDE.md](CLAUDE.md)). Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

- **Code:** [AGPL-3.0](LICENSE)
- **Contributed scans & climb data:** [CC BY-SA 4.0](DATA_LICENSE.md) — by uploading, contributors agree to share their scans and annotations under this license.
