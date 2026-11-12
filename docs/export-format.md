# Per-boulder export format (schema_version 1)

`GET /api/scans/:id/export` (linked as "Download open data" on each boulder page) returns a store-only zip for one published scan:

| File | Contents |
|---|---|
| `manifest.json` | `schema_version`, `exported_at`, license, scan metadata (no coordinates, no uploader id) |
| `mesh.glb` | Canonical GLB; its sha256 equals `scan.content_hash` |
| `climbs.json` / `holds.json` / `paths.json` | Published climbs (`id`, `scan_id`, `name`, `description`, `proposed_grade`, `fa_info`, `status`; never the creator's user id) and their mesh-local annotations |
| `grades.json` | Proposed grade per climb (vote aggregates land with #24) |
| `LICENSE.txt`, `ATTRIBUTION.txt` | CC BY-SA 4.0 notice and contributor handles |

Import validation (`parseBoulderExport`) checks the schema version, GLB hash, and that every hold's `scan_content_hash` matches. Geometry is mesh-local; location never appears in exports.
