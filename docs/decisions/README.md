# Architecture decisions

One markdown file per significant decision (lightweight ADRs). Spikes (`spike` label) land their writeups here.

Format: `NNN-short-title.md` — context, options considered, decision, consequences.

Pending (from PLAN.md §5): mesh compression strategy, capture v2 approach. QC worker runtime is proposed in 003.

## Index

| # | Title | Status | Issue |
|---|---|---|---|
| [001](001-openbeta-api.md) | OpenBeta API: terms, rate limits, queries, cache design | Proposed (spike) | #27 |
| [002](002-mesh-storage.md) | Mesh storage: Supabase Storage vs Cloudflare R2 | Accepted | #18, #50 |
| [003](003-qc-pipeline-runtime.md) | QC pipeline runtime: Edge Function vs worker | Proposed (spike) | #16 |
