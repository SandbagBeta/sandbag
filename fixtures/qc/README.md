# QC golden fixtures

Inputs for the QC golden tests (`src/lib/qc/golden.test.ts`, ADR 003 §7). Every file is written by `pnpm fixtures:qc` (`scripts/generate-qc-fixtures.mjs`), which is deterministic; the test regenerates the set in memory and fails if a committed file differs. Don't edit these by hand: change the generator and rerun it.

Each file is at most 1 MB and the set at most 6 MB. Large inputs (1M–5M triangles) are covered by the opt-in benchmark in `src/lib/qc/bench.test.ts`.

ZIP timestamps use fixed local calendar fields (2026-01-01 00:00:00), because ZIP's DOS timestamp has no time zone and fflate serializes local date/time fields. A fixed UTC instant would produce different bytes across machines. The golden tests regenerate all fixtures in separate Node processes under UTC, America/New_York, and Asia/Kathmandu and compare their SHA-256 hashes to the committed files. The two ZIP fixtures were regenerated with this timestamp fix; their mesh and texture contents are unchanged.

| File | Expect | Exercises |
|---|---|---|
| `good-polycam-like.glb` | pass | GLB, 20k tris, 2048² JPEG, UV seams (split vertices welded for topology) |
| `good-scaniverse-like.ply` | pass | Binary little-endian PLY, vertex colours (count as colour; no texture check, O6) |
| `good-obj.zip` | pass, 2 warnings | OBJ + MTL + 1024² JPEG in a zip, ~30% floaters: S1 texture and S2 floater warnings |
| `good-draco.glb` | pass | Draco-compressed input, vertex colours |
| `good-georeferenced.zip` | pass | OBJ with UTM-sized offsets (+500,000 / +1,500 / +4,600,000) and a JPEG with EXIF GPS (synthetic, open sea). The report must hold no location |
| `bad-magic.glb` | `file_type` | A JPEG named `.glb` |
| `bad-truncated.glb` | `parse` | GLB cut in half |
| `bad-too-few-tris.ply` | `tri_count` | 2,028 triangles, binary big-endian PLY |
| `bad-scale-mm.glb` | `scale` | The boulder exported in millimetres (~2,500 units across) |
| `bad-flat.ply` | `volume` | 20k coplanar triangles, ASCII PLY |
| `bad-floaters.glb` | `floaters` | 60% of vertices in disconnected blobs |
| `bad-small-texture.glb` | `texture_res` | 512² texture |
| `bad-too-many-tris.ply` | `too_large` | Header claims 6M faces, body truncated: fails before parsing |
