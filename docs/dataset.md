# Dataset export (schema_version 1)

The whole published corpus as an open dataset, for researchers and for training the hold-detection model described in [PRD §10](PRD.md). It is the bulk counterpart of the [per-boulder export](export-format.md). Licence: CC BY-SA 4.0 (see `LICENSE.txt` in every export). Climbing metadata remains under OpenBeta's terms.

## Getting it

- **Weekly artifact:** the `Dataset export` GitHub Actions workflow runs every Monday and attaches `sandbag-dataset` (30 days of retention) to the run. It needs the repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY`; without them it reports "skipped".
- **Yourself:** `pnpm export:dataset [--out dist/dataset]` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set (`.env.local` works). It reads with the **public anon key only**, so it can export nothing an anonymous visitor couldn't already see. Never give it a service-role key.

## Layout

```
manifest.json            schema_version, exported_at, license, counts, one entry per scan
labels.jsonl             one JSON object per hold, flat, ready to stream
scans/<scan_id>/mesh.glb       canonical GLB; sha256 equals the scan's content_hash
scans/<scan_id>/climbs.json    published climbs of the scan
scans/<scan_id>/holds.json     their holds
scans/<scan_id>/paths.json     their lines, topouts and downclimbs
LICENSE.txt
ATTRIBUTION.txt         contributor handles (the only place handles appear)
```

Scans are ordered by id, so two exports of the same data differ only in `exported_at`.

### `manifest.json`

`scans[]` entries: `id`, `directory`, `glb_file`, `content_hash`, `tri_count`, `texture_res`, `capture_app`, `captured_at`, `openbeta_area_id`, `openbeta_climb_id`, `climb_count`, `hold_count`. `counts` totals scans, climbs and holds.

### Labels (`labels.jsonl`, `holds.json`)

One hold = one label:

| Field | Meaning |
|---|---|
| `scan_id`, `climb_id`, `id` | Which scan, climb and hold (`scan_id` only in `labels.jsonl`) |
| `scan_content_hash` | sha256 of the exact GLB the hold was placed on; equals the scan's `content_hash` |
| `position` | `[x, y, z]` in metres, in the GLB's own frame (Y-up) |
| `normal` | Unit outward surface normal at `position` |
| `face_index` | Global triangle index: the concatenation of the GLB's triangle primitives in glTF scene order (default scene, depth-first node traversal, primitives in order; non-triangle and empty primitives skipped) |
| `type` | `start`, `hand`, `foot` or `finish` |
| `seq_order` | 0-based order along the climbing line for `start`, `hand` and `finish` holds, or `null`. Always `null` for `foot` holds: feet are optional single points of one climb, not part of the line, and belong to that climb only |

The GLB is Draco-compressed. Face numbering is that of the **decoded** mesh, so decode with a standard glTF + Draco loader and flatten as above.

### Climbs and paths

`climbs.json`: `id`, `scan_id`, `name`, `description`, `proposed_grade`, `fa_info`. `paths.json`: `id`, `climb_id`, `kind` (`line`, `topout`, `downclimb`; at most one of each per climb), `points` (`[[x, y, z], ...]`, same frame). Grades are the contributor's *proposed* grade; per-user votes are never exported.

## What is never in the dataset

- **Coordinates.** Nothing geographic exists in these records; geometry is mesh-local. The OpenBeta area and climb ids are included (they are public ids, as in the per-boulder export), so a consumer who wants a location must go to OpenBeta, whose own privacy rules apply.
- **User ids, emails, grade votes, review notes, QC reports, and the private "can't find it" attach notes** (#28).
- Anything unpublished: pending, rejected and taken-down scans and climbs.

Every record is rebuilt from an explicit field list (`src/lib/export/dataset.ts`), so a new database column can't leak into a future export by accident. The builder also refuses a mesh whose hash doesn't match, and holds or paths that don't belong to their scan.

## Reading it

```python
import json
manifest = json.load(open("manifest.json"))
for line in open("labels.jsonl"):
    hold = json.loads(line)   # {"scan_id", "climb_id", "type", "position", "face_index", ...}
```

## Limits and v2 plan

- v0 builds the whole corpus in memory (every GLB at once). Fine for the first hundreds of scans; stream per scan before it grows past a few GB.
- Snapshots are not versioned beyond `schema_version` and `exported_at`; each run is the current state. Keep the artifact if you need to reproduce a training set.
- ML plan (PRD §10): sample local geometry patches (curvature, normals) and texture around each labelled `position` to train a patch classifier or mesh segmentation model that proposes holds on new scans; a human confirms in the annotation tool. The suggested gate to start is 50 published scans and 1,500 annotated holds. Planned additions: pre-sampled patch tensors per hold, and train/validation splits by scan (never by hold, since holds on one mesh are correlated).
