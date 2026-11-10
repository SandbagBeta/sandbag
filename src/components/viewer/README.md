# `src/components/viewer/` — 3D boulder viewer

All imperative three.js for SandBag lives here (lane rule). The rest of the
app only renders `<BoulderViewer>` and passes a URL.

## Usage

```tsx
"use client";
import dynamic from "next/dynamic";

const BoulderViewer = dynamic(
  () => import("@/components/viewer").then((m) => m.BoulderViewer),
  { ssr: false }, // needs WebGL; never render on the server
);

<BoulderViewer
  src="/fixtures/demo-boulder.glb" // or a Supabase Storage public URL
  label="3D scan of Demo Boulder"
  className="h-[60dvh] w-full rounded-lg"
>
  {/* visually hidden text alternative, e.g. the climb list */}
</BoulderViewer>;
```

`src` is any absolute `http(s)` or root-relative URL. When it comes from user
input (query string, form), validate it with `parseViewerSrc()` first.

Dev harness: `/dev/viewer?src=<url>` (defaults to `/fixtures/demo-boulder.glb`,
which issue #8 produces; it is **not** committed by this module). The route
returns 404 when `NODE_ENV=production`, so it never ships.

## Files

| File                     | Role                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BoulderViewer.tsx`      | `<Canvas>` (demand frameloop, dpr 1–2, no shadows), lights, ground `Grid`, `OrbitControls`, loading overlay, error boundary, a11y. |
| `ScanModel.tsx`          | `useGLTF` (Draco + meshopt) → `<primitive>`; fits the camera once mounted.                                                          |
| `loaders.ts`             | The single place loaders/decoders are configured (`useScanGLTF`, `preloadScanGLTF`, `clearScanGLTF`).                               |
| `fitCamera.ts`           | Pure `measureBounds()` + `Box3 → CameraFit` math (target, position, min/max distance, polar limit, near/far); throws "scan has no geometry" for empty/degenerate meshes. Unit tested. |
| `useFitCamera.ts`        | Applies a `CameraFit` to the r3f camera and the controls, then `invalidate()`s.                                                     |
| `ViewerErrorBoundary.tsx` | Catches 404 / invalid-GLB / WebGL errors; readable message + Retry (clears the loader cache and remounts the canvas).              |
| `LoadingOverlay.tsx`     | DOM overlay driven by drei `useProgress` (outside the canvas, so it works before WebGL is up).                                       |
| `srcParam.ts`            | `parseViewerSrc()` — allowlist for `?src=` (http(s) or root-relative only).                                                        |

## Decoders

- **meshopt** (`EXT_meshopt_compression`, our canonical format): decoder is
  bundled from `three/examples/jsm/libs/meshopt_decoder.module.js` via drei.
  Works offline.
- **Draco** (`KHR_draco_mesh_compression`): WASM decoder is fetched lazily
  from Google's gstatic CDN (`DRACO_DECODER_PATH` in `loaders.ts`), only when
  a Draco file is actually loaded. To self-host, copy
  `node_modules/three/examples/jsm/libs/draco/gltf/` to `public/draco/` and
  point `DRACO_DECODER_PATH` at `/draco/`.

Adding another loader/extension (e.g. KTX2 textures): extend the `GLTFLoader`
in `loaders.ts` via `useGLTF`'s fourth `extendLoader` argument, keep the
decoder/transcoder instantiation there, and document the network dependency
in this section.

## Performance notes

- `frameloop="demand"`: nothing renders unless something changes (controls
  change, resize, load). Call `invalidate()` from any new imperative code.
- Target: 60 fps on a mid-range phone with a 500k-tri scan, 30 fps floor.
  Keep the scene to one draw call per scan; no shadows, no post-processing,
  no HDR environment maps (they add a network fetch and GPU memory).
- `dpr={[1, 2]}` caps device pixel ratio at 2. Drop to `[1, 1.5]` on very
  heavy scans if needed.
- Camera limits scale with the mesh bounding sphere, so meshes of any size
  frame correctly; `maxPolarAngle` keeps the camera above ground.
