# SandBagBeta — Execution Plan

Companion to [docs/PRD.md](docs/PRD.md) (what/why). This is the how/when: milestones, the parallel-agent workflow, and working conventions.

**Pace assumption:** primary side project, 10+ hrs/wk of Collin-time plus parallel agent sessions. v1 target: **~8 weeks** (mid-January 2027), with winter break as the big push.

---

## 1. Milestones & dependency graph

```
M0 Foundation ──► M1 Viewer ──────────┐
       │                              ├──► M3 Annotation ──► M5 Launch
       └────────► M2 Upload + QC ─────┘                        ▲
       └────────► M4 OpenBeta + browse ────────────────────────┘
```

M1, M2, M4 are **independent lanes** once M0 lands — this is where parallel agents pay off. M3 needs both the viewer (M1) and published scans (M2). M5 integrates everything.

| Milestone | Target | Issues | Exit criteria |
|---|---|---|---|
| **M0 Foundation** | Wk 1–2 | #1–8 | Deployed skeleton: Next.js + Supabase wired, schema v1 migrated, CI green on PRs, demo GLB in storage |
| **M1 Viewer** | Wk 2–4 | #9–13 | A hardcoded scan renders in r3f viewer with orbit controls on desktop + mobile; holds render from fixture data |
| **M2 Upload + QC** | Wk 2–5 | #14–20 | Sign in → upload GLB/OBJ/PLY → pipeline converts/validates → review queue → publish. QC report visible |
| **M3 Annotation** | Wk 4–7 | #21–26 | Place/edit holds on mesh, define climb + line + topout/downclimb, grade voting live |
| **M4 OpenBeta + browse** | Wk 3–6 | #27–31 | Area/boulder browse pages from OpenBeta API w/ cache, attach-scan flow, location-privacy enforcement |
| **M5 Launch** | Wk 7–8 | #32–38 | 10 seeded scans, 20 climbs, capture guide, dataset export, README self-host path verified, community posts out |

Milestone issues live in `project/issues.json` and are mirrored to GitHub Issues/Milestones by `scripts/bootstrap_github.sh`.

## 2. Parallel-agent workflow

Goal: multiple coding agents working different issues simultaneously without stepping on each other, with Collin as architect/integrator.

### 2.1 Runtimes — what to use when

| Runtime | Best for | Notes |
|---|---|---|
| **Claude Code cloud sessions** (claude.ai/code / app) | The default workhorse. One session per issue; each gets an isolated sandbox, branches, opens a PR | Kick off 2–3 in parallel, review PRs when they land. Works from phone between classes |
| **Local Claude Code + git worktrees** | Work needing fast iteration against a running local stack (viewer/annotation UX, Supabase local), or anything you want to watch closely | `git worktree add ../sandbag-issue-NN -b feat/NN`; one terminal tab per worktree. You are the merge point |
| **GitHub Actions — `@claude` on issues** (claude-code-action) | Async small/well-specified issues: bugs, docs, test gaps, refactors. Comment `@claude` on the issue → agent opens a PR | Set up in M0 (#7). Also runs the **reviewer agent** on every PR |

Rule of thumb: UX-heavy or architecturally novel → local; well-scoped feature with clear spec → cloud session; small and mechanical → `@claude` the issue.

### 2.2 Specialized roles

Role instructions live in `.claude/agents/` (subagent definitions) and scoped `CLAUDE.md` context. Any runtime inherits them.

| Agent | Lane label | Owns | Instructions file |
|---|---|---|---|
| `frontend` | `lane:frontend` | Viewer, annotation UI, browse pages (Next.js/r3f/Tailwind) | `.claude/agents/frontend.md` |
| `backend` | `lane:backend` | Schema, RLS, QC pipeline, storage, OpenBeta integration | `.claude/agents/backend.md` |
| `pipeline-3d` | `lane:3d` | Mesh conversion/compression/validation, gltf-transform, thumbnails | `.claude/agents/pipeline-3d.md` |
| `reviewer` | — | Reviews every PR: correctness, PRD-value alignment, RLS/security, scope creep | `.claude/agents/reviewer.md` |

Docs/tests have no dedicated agent: every PR includes its own tests + doc updates (enforced by reviewer).

### 2.3 Issue → merge flow

```
groom issue (clear spec, lane label, milestone, "agent-ready" when self-contained)
→ assign to a runtime (cloud session / local worktree / @claude comment)
→ agent works on branch feat/<issue#>-<slug>, opens PR closing #NN
→ gate 1: CI — lint (eslint+prettier), typecheck (tsc), unit tests (vitest), build
→ gate 2: reviewer agent posts structured review (blocking concerns vs nits)
→ gate 3: Collin — reads reviewer output + diff, resolves concerns, merges
```

Merge discipline: squash-merge, `main` protected (PRs only, CI required), no agent ever merges. Conflicts are minimized by lanes — two agents never work the same lane simultaneously; cross-lane contracts (API shapes, schema) are defined in the issue before agents start.

### 2.4 Conventions that make parallelism work

- **Issues are the spec.** An `agent-ready` issue states: goal, files likely touched, contracts (types/API), out-of-scope, acceptance checks. Grooming is Collin-work; 15 min of grooming saves an hour of PR surgery.
- **Small PRs.** One issue = one PR ≤ ~400 lines diff where possible. Big features get split at grooming time.
- **Contracts first.** Shared TypeScript types in `packages/shared` (or `src/lib/types.ts` pre-monorepo); schema changes land alone before features that need them.
- **CLAUDE.md is the project brain**: architecture decisions, values (access-privacy!), commands, conventions. Agents read it first; keep it current — stale CLAUDE.md = confused agents.
- **Budget realism:** parallel cloud sessions burn subscription usage fast. Prefer 2 concurrent sessions + `@claude` for small stuff; batch low-priority issues.

## 3. Collin's weekly loop (~10 hrs)

| Time | Activity |
|---|---|
| ~2h | Groom next issues, define contracts, update CLAUDE.md/PLAN |
| ~4h | Deep work on the hard/fun problems (annotation UX, QC heuristics) — local |
| ~3h | Review & merge agent PRs (reviewer agent pre-digested), kick off next sessions |
| ~1h | Seed data: scan boulders, test real flows, file bugs |

## 4. Definition of done (v1)

- All M0–M5 exit criteria met; demo loop (upload → QC → review → annotate → view → download) works on production URL.
- ≥10 published scans, ≥20 annotated climbs, seeded from a real local area.
- A stranger can self-host from README in <10 min (verified by a fresh clone test).
- LICENSE (AGPL-3.0), data licensing (CC BY-SA 4.0), CONTRIBUTING, capture guide, values doc all in repo.
- Launch posts: OpenBeta community/Discord, r/bouldering, NightHacks/Stevens channels.

## 5. Open questions (tracked as issues)

- Supabase Storage vs Cloudflare R2 for mesh files at scale (#18) — proposed in [ADR 002](docs/decisions/002-mesh-storage.md); pending maintainer sign-off.
- Edge Function limits for mesh conversion — may need a small worker (Fly.io/Railway) if >150s or >256MB (#16 spike).
- OpenBeta API: rate limits/ToS for caching; reach out to their community early (#27 spike). Spike done: [ADR 001](docs/decisions/001-openbeta-api.md) (CC0 data, no published limits/ToS; questions for the OpenBeta community still open).
- In-app guided capture (v2): browser photogrammetry feasibility spike (#38).
