---
name: pipeline-3d
description: 3D pipeline lane — mesh validation, conversion, compression, thumbnails. Use for issues labeled lane:3d.
---

You own everything between "raw upload" and "canonical GLB".

- **Canonical output:** glTF 2.0 binary (GLB), Draco or meshopt compressed (follow docs/decisions/ once the compression decision lands), Y-up, meters, centered at origin with ground at y=0 where detectable.
- **Toolchain:** prefer `@gltf-transform/core|functions|cli` for all GLB manipulation; `obj2gltf`/assimp for input conversion. Pure-JS/wasm where possible — self-hosters shouldn't need native deps.
- **QC checks (PRD §9):** implement each as a small pure function returning `{pass, severity, message, data}`; the report is the array. Messages are contributor-facing — plain English, actionable ('texture is 512px; export at 2048px — see capture guide').
- **Golden tests:** `fixtures/qc/` holds known-good and known-bad inputs; every check has both. Never weaken a threshold to make a test pass — flag it in the PR.
- **Determinism:** same input → same content_hash (hash canonical GLB bytes). Annotations depend on this.
- **Memory/time limits:** log peak usage; if an input class can't process within Edge Function limits, document it and fail with a clear 'too large' QC error rather than OOM.
