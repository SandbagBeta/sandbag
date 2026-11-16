# Contributing to SandBag

Stoked you're here. Two ways to contribute: **data** (scan boulders!) and **code**.

## Contributing scans

Grab any app that exports a mesh (Polycam, Scaniverse, RealityScan, Luma…), scan a boulder, export GLB/OBJ/PLY, upload on the site. Read the capture guide (docs/capture-guide.md) for quality tips. By uploading you license your scan + annotations under CC BY-SA 4.0.

**Access matters:** if a boulder is in a sensitive or closed area, flag it during upload. When in doubt, ask your local climbing org.

## Contributing code

1. Pick an issue — `good-first-issue` for newcomers, `agent-ready` means the spec is complete. Comment to claim it.
2. Read [CLAUDE.md](CLAUDE.md) (yes, even humans — it's the project conventions) and the `.claude/agents/` file for your issue's lane.
3. Branch `feat/<issue#>-<slug>`, keep the diff focused, include tests.
4. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before opening the PR. You need Node 24 or newer. If you touch a page or flow, also run `pnpm e2e` (setup in [docs/e2e.md](docs/e2e.md)); CI runs it as the `e2e` job.
5. Open a PR with `Closes #NN`. CI (`checks`: lint, typecheck, test, build; `db`: migrations and pgTAP; `e2e`: Playwright against a local Supabase stack) must pass, along with CodeQL. Run the first four commands locally before pushing. A maintainer adds the `claude-review` label to run the reviewer agent, then merges.

AI agents are first-class contributors here — the repo is built for parallel agent development (see [PLAN.md](PLAN.md)). Agent PRs meet the same bar as human PRs.

## Code of conduct

Be excellent to each other: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licensing of contributions

Code contributions are AGPL-3.0; by submitting a PR you agree to license your contribution under it. Data contributions are CC BY-SA 4.0.
