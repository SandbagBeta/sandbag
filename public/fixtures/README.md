# Demo fixtures

## `demo-boulder.glb`

A **procedurally generated placeholder boulder** — not a scan of a real rock. It
exists so the viewer, annotation tools and seed script have a known-good mesh to
work against before a real capture lands. It has no geographic location.

- glTF 2.0 binary, meshopt-compressed (`EXT_meshopt_compression` +
  `KHR_mesh_quantization`); loaders need a meshopt decoder (three.js:
  `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`).
- Y-up, meters, centered on the x/z origin with the ground plane at y = 0;
  about 2.5 m wide × 1.8 m tall × 1.85 m deep, 62,208 triangles, vertex colors,
  no texture. One mesh, one primitive.
- Served by Next.js at `/fixtures/demo-boulder.glb`; `pnpm seed` uploads the
  same bytes to the `published` storage bucket at `demo/demo-boulder.glb`.

The companion `src/lib/fixtures/demo-boulder.json` holds the scan metadata,
two climbs, their holds (all four types) and paths (line, topout, downclimb),
with every hold pinned to the GLB's sha256 content hash and a face index.

## Regenerating

```bash
pnpm fixtures:generate   # scripts/generate-demo-boulder.mjs
```

Generation is deterministic: the same code produces byte-identical output, so
the content hash in the JSON only changes when the generator does. Regenerate
and commit **both** files together — `pnpm seed` and the tests refuse a
mismatched pair. Lumpiness, size and seed live in `DEFAULT_PARAMS` in
`scripts/lib/boulder-geometry.mjs`.

## License

The fixture files in this directory and `src/lib/fixtures/` are released under
[CC BY-SA 4.0](../../DATA_LICENSE.md), the same license as contributed scans and
annotations. Attribution: "SandBag demo boulder (procedural)". They will be
replaced by a real, CC BY-SA 4.0 scan once one is captured.
