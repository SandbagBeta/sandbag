# Capture guide: how to scan a boulder well

A good scan passes our automated QC the first time and makes annotating holds easy. This guide covers what to do before, during and after capture, per-app export settings, and how to fix common QC failures.

The QC thresholds quoted here come from [PRD §9](PRD.md). If they change there, update this page.

## Before you go

- **Check access first.** Only scan boulders on land where climbing and photography are allowed. If the area is access-sensitive, tell us when you upload so its location can be hidden. Never share exact coordinates elsewhere that the area owners have asked to keep private.
- **Bring** a charged phone with free storage (scans are often 1–5 GB while processing), a brush to clean chalk and dirt off the holds you care about, and a clean, dry lens cloth.
- **Clear the landing.** Move crash pads, bags and ropes out of frame. Anything that moves during capture ends up as floating junk in the mesh.

## Lighting

- **Best:** even, overcast light, or full shade. Shadows that stay put are fine; shadows that move during the scan are not.
- **Avoid:** harsh direct sun (blown-out highlights, hard shadows baked into the texture), dawn/dusk low light (noise, blur), and rain or wet rock (reflections confuse alignment).
- **Don't use flash.** It bakes highlights into the texture.
- Lock exposure and focus if your app allows it, so brightness doesn't pump between frames.

## Coverage pattern

Photogrammetry needs every surface seen from several angles with plenty of overlap. Aim for **70–80% overlap** between neighbouring frames.

1. **Walk a full loop** around the boulder at about 1–2 m from the rock, camera at chest height, pointed at the surface. Move slowly.
2. **Second loop, higher.** Hold the phone above your head, angled down, to capture the top-outs and slabby faces.
3. **Third loop, lower.** Crouch, angled slightly up, for overhangs, undercuts and the base.
4. **Detail passes.** Move closer (0.5–1 m) over the main climbing features: start holds, crux and top-out.
5. **Overlap the start.** End the loop where you began so the app can close it.
6. **The base.** You can't scan the underside. Capture the ground contact line, and don't worry about the bottom surface.

Tips:

- Move in a smooth arc, not by turning on the spot. Parallax between frames is what lets the software work out depth.
- Keep the whole boulder in at least some frames so the app can work out its overall shape.
- Avoid scanning featureless rock from far away. Move in.
- Keep people, pads and pets out of the shot, or wait for them to move.
- If you scan a hard-to-reach section, a second quick pass is better than a single blurry one.

## Per-app settings

App menus change between versions. Treat the names below as a guide, and prefer the highest-quality option that your device and the 200 MB upload limit allow.

### Polycam

- Use **Photo mode** (photogrammetry) for boulders. LiDAR mode has too short a range for most boulders and gives poor texture.
- Use the highest quality processing option on offer (Full or Detailed) rather than the fast preview.
- Export as **GLB** if offered. Otherwise **OBJ** with textures. Include the texture in the export.
- If the file is over 200 MB, reduce the polygon count in the export options rather than lowering the texture resolution. Keep the texture at 2048 px or more.

### Scaniverse

- Use the **Area** or **Large object** mode, not Small object.
- Scaniverse processes on-device. Use the highest detail setting, and let processing finish with the app in the foreground.
- Export as **GLB** (preferred), or OBJ. Choose the full-quality option, not the reduced one.

### RealityScan

- Capture inside the app, using its guidance overlay, until coverage is shown as complete.
- Process at **Normal** or **High** detail and make sure texturing is enabled.
- Export a **textured mesh** as GLB, OBJ or FBX. Don't export just a point cloud.
- Export the texture at 2048 px or larger (4096 px is better).

### Luma

- Luma's default output is a NeRF/Gaussian splat, which SandBag can't ingest. Use the **mesh export** and download a **GLB** or OBJ.
- Check that the exported mesh has texture or vertex colour before uploading. If it only has vertex colour, a texture is still needed to pass QC. Re-export with a textured mesh.

### Other tools (Metashape, RealityCapture, Meshroom, COLMAP + meshing)

Export a textured mesh as GLB, OBJ + texture or PLY. Decimate to under 5M triangles and use 2048 px or larger textures.

## Before you upload

Open the exported file in a viewer (your phone's file preview or any desktop GLB viewer) and check:

- The boulder is complete and recognisable, without large holes on faces you expect to climb.
- There is a texture, not a flat grey or single colour.
- It's about the right size. A 3 m boulder should not be 30 cm or 300 m. Some apps export in arbitrary units, so check the scale.
- The file is under **200 MB**.

## What QC checks (and fixes for failures)

| QC check | Limit | If it fails |
|---|---|---|
| File type and size | Valid GLB/OBJ/PLY, ≤ 200 MB | Re-export in a supported format. Reduce polygon count (not texture size) if too large. |
| Mesh loads, has geometry | ≥ 1 mesh | Re-export. Make sure you export the mesh, not a point cloud or splat. |
| Triangle count | 10k – 5M | Too few: reprocess at higher detail. Too many: decimate in the app's export options. |
| Bounding box | 0.3 m – 30 m | Wrong scale. Re-export with metric units, or rescale in your tool. If you scanned more than one boulder, trim to just the one. |
| Degenerate geometry | Volume > 0 | Usually a failed or partial reconstruction. Rescan with more overlap. |
| Floaters | < 50% disconnected vertices | Remove floating junk in the app's crop/trim tool. Rescan with the landing cleared and nobody moving through the shot. |
| Texture present | Required | Re-export with texture enabled. Check that the texture file is included (OBJ needs its `.mtl` and image). |
| Texture resolution | Must be ≥ 1024 px (fails below); warns below 2048 px | Export the texture at 2048 px or higher. |

Common problems that don't fail QC but may fail community review:

- **Holes or melted surfaces** on key faces: not enough overlap or light was too low. Rescan those areas.
- **Smeared texture / blur**: moved too fast or low light. Rescan slower.
- **Wrong boulder** or one that doesn't match the OpenBeta entry: link the right area and boulder when uploading.
- **Large background included** (ground, trees, other boulders): crop it out before export.

When QC rejects a scan, the report lists the failed checks. Match each reason to the table above, fix it, and upload again.
