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
returns 404 on Vercel production and on self-hosted `next start` builds. It
stays available in `next dev` and on Vercel preview deployments, so PR
previews can be tested on real phones (see `src/app/dev/devHarness.ts`).

To test on a phone against your local dev server instead: add your computer's
LAN IP to `DEV_ALLOWED_ORIGINS` in `.env.local`, run `pnpm dev -H 0.0.0.0`, and
open `http://<lan-ip>:3000/dev/viewer` on the same Wi-Fi. Without the env var
the page stays blank, because Next.js blocks dev scripts for non-localhost
origins.

## Files

| File                     | Role                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BoulderViewer.tsx`      | `<Canvas>` (demand frameloop, dpr 1–2, no shadows), lights, ground `Grid`, `OrbitControls`, loading overlay, error boundary, a11y; optional `scene` slot for extra r3f content. |
| `ScanModel.tsx`          | `useGLTF` (Draco + meshopt) → `<primitive>`; fits the camera once mounted.                                                          |
| `loaders.ts`             | The single place loaders/decoders are configured (`useScanGLTF`, `preloadScanGLTF`, `clearScanGLTF`).                               |
| `fitCamera.ts`           | Pure `measureBounds()` + `Box3 → CameraFit` math (target, position, min/max distance, polar limit, near/far); throws "scan has no geometry" for empty/degenerate meshes. Unit tested. |
| `useFitCamera.ts`        | Applies a `CameraFit` to the r3f camera and the controls, then `invalidate()`s.                                                     |
| `ViewerErrorBoundary.tsx` | Catches 404 / invalid-GLB / WebGL errors; readable message + Retry (clears the loader cache and remounts the canvas).              |
| `LoadingOverlay.tsx`     | DOM overlay driven by drei `useProgress` (outside the canvas, so it works before WebGL is up).                                       |
| `srcParam.ts`            | `parseViewerSrc()` — allowlist for `?src=` (http(s) or root-relative only).                                                        |
| `holds/`                 | `HoldMarkers`, `ClimbLine`, `ClimbViewer`; pure `holdMath.ts` (orientation, offsets, grouping) and `holdStyle.ts` (palette + shapes). |
| `climbs/`                | DOM-only `ClimbList` / `ClimbInfo` (`ClimbPanel.tsx`) and `ClimbExplorer` (selection + layout).                                     |

## Holds, climb line and selection (#10)

`climbs/ClimbExplorer` = lazily loaded `holds/ClimbViewer` (BoulderViewer plus
markers and line, passed through the `scene` slot) beside a DOM climb list and
info panel. The dev page uses it for the demo fixture: `/dev/viewer?climb=<id>`.

- **Frame:** hold positions/normals are world space (GLB node transforms
  applied), so markers and the line are siblings of the model, never children
  of a mesh node.
- **Markers:** one `InstancedMesh` per hold type (≤ 4 draw calls for any hold
  count), oriented +Y → `normal`, lifted 5 mm. Okabe–Ito hue _and_ shape per
  type (`holdStyle.ts`): start = ring, hand = disc, foot = square tile,
  finish = cone.
- **Selection:** URL state (`?climb=`, synced with `history.replaceState`).
  Other climbs’ holds are dimmed (toward gray, 70 % scale) rather than hidden,
  so they stay clickable; clicking a hold selects its climb (drags > 4 px are
  ignored).
- **Paths:** only the selected climb’s, lifted 1 cm along the nearest hold
  normal. A faint depth-ignoring pass under the solid pass keeps segments that
  chord through the rock readable.
- **Topout / downclimb (#11):** dashed lines (`PATH_STYLE` in `holdStyle.ts`):
  topout = vermillion long dashes, downclimb = white short dashes, line =
  solid yellow. Pattern is the non-color cue. Each gets a text label at its
  arc-length midpoint (drei `Html`, `aria-hidden`). Their points are lifted
  only within 30 cm of a hold, so a downclimb on the far side never borrows a
  wrong-facing normal.
- **Legend:** `climbs/ViewerLegend` (DOM) keys all hold types and path kinds;
  `ClimbInfo` lists which paths the selected climb has, as text.
- **Without WebGL:** the climb list and info panel are plain buttons and text
  and work without the canvas.

## Decoders

- **meshopt** (`EXT_meshopt_compression`, our canonical format): decoder is
  bundled from `three/examples/jsm/libs/meshopt_decoder.module.js` via drei.
  Works offline.
- **Draco** (`KHR_draco_mesh_compression`): WASM decoder is self-hosted at
  `/draco/` (`DRACO_DECODER_PATH` in `loaders.ts`) and fetched lazily, only
  when a Draco file is actually loaded. `scripts/copy-draco.mjs` copies it from
  the installed `three` on postinstall/predev/prebuild; `public/draco/` is
  gitignored.

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

## Hold placement (`annotate/`, issue #21)

`/dev/annotate` runs the desktop hold editor on the demo fixture. `AnnotateEditor`
falls back to the read-only `ClimbExplorer` below `md` or on `pointer: coarse`.
Click (at most 4 px of travel) places a hold, drag moves it (one undo step on
release), keys 1-4 pick the type (sticky; also retypes the selected hold),
Delete/Backspace removes, Ctrl+Z / Ctrl+Shift+Z undo/redo. `<BoulderViewer bvh>`
wraps the scan in drei `<Bvh firstHitOnly>`. Holds live in client state only;
saving is a later PR.
