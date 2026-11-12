# Draft: Stevens / NightHacks

**DRAFT, not posted.** Fill in the `[...]` details (event, track, team) yourself; they are not in the repo. Read [README.md](README.md) first.

---

**SandBag: open-source 3D boulder visualizer**

[One-line pitch] Climbers scan boulders with their phones; everyone else can walk around the boulder in 3D, with the line, holds and community grades on top, before they go.

**What we built**
- Next.js (App Router, TypeScript) + react-three-fiber for the 3D viewer and annotation tool.
- Supabase: Postgres with row-level security, Auth, Storage.
- An automated quality pipeline for uploads (parse, triangle count, scale, floaters, texture checks) that decides pass / fail / advisory warning, with plain-language messages.
- A review and publish flow with a strict lifecycle (a scan can only move along allowed steps, and only one module is allowed to change status).
- Annotation: place holds on the mesh, draw the line, validated on the server against the stored mesh before saving.
- OpenBeta integration for climbing metadata (we only store the 3D layer).
- Open data: per-boulder export and a dataset export (GLB + JSON + labels) under CC BY-SA 4.0.

**Engineering we're proud of**
- Location privacy as a code-level invariant: one server-only formatter, lint that fails CI on raw coordinates.
- Failure UX: every upload, QC and save failure says what happened, at which step, what you can do next; failures we cause get a reference and are logged privately.
- A 1M-triangle wall scan went through upload, QC, review, publish, annotate and save on a local stack.

**Where it stands (honest)**
- Pre-alpha. Works locally end to end. Not deployed publicly yet; very little seed data. Some flows (grade voting, review notifications, retry after failed checks) are verified at the database level and still being checked in the browser.
- Annotation is desktop-first.

**Roadmap:** train a hold-detection model on the open dataset (needs about 50 published scans and 1,500 labelled holds first); human confirms suggestions in the same UI.

**Links:** repo https://github.com/sandbagbeta/sandbag · demo <DEMO URL or "run locally from the README"> · [Devpost/slides link]
