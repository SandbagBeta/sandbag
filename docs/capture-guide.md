# Capture guide: how to scan a boulder well

A good scan passes SandBag's automated checks the first time and makes holds easy to place. This page covers how to shoot, what to export, and how to fix the checks people hit most. The numbers come from `src/lib/qc/thresholds.ts` (QC pipeline `qc-1.2.0`); if they change, this page should change with them.

**Respect access and privacy.** Only scan boulders you are allowed to be at. Don't scan on closed or access-restricted land, and don't publish a location a landowner or local group asks you to keep private. SandBag never asks for GPS coordinates; leave location tagging off in your capture app and strip it from anything you share elsewhere. Location is attached by linking the scan to an OpenBeta area, and the app decides what is shown.

## What the checks need

| Check | Fails if | Warns if |
| --- | --- | --- |
| File | Not GLB, glTF, PLY, or a zip with an OBJ/glTF plus textures; or over 200 MB (50 MB on hosted Free) | |
| Triangles | Under 10,000 or over 5,000,000 | |
| Size | Longest side under 0.3 m or over 30 m | Under 2 m or over 20 m (advisory: a reviewer checks the scale) |
| Volume | Mesh is flat (almost no enclosed volume) | |
| Floating pieces | 50% or more of the mesh is disconnected from the main piece | 20% or more |
| Colour | No texture and no vertex colours | |
| Texture | Longest side under 1024 px | Under 2048 px |
| Mesh defects | | Over 1% zero-area faces or non-manifold edges |

Passing the automated checks sends the scan to a human reviewer, who also asks: is it a boulder, is it the one claimed, is coverage adequate.

## Before you shoot

- **Light:** Overcast or open shade is best. Hard sun puts shadows and blown-out highlights into the texture, and they move as you walk around, which confuses reconstruction. Avoid dusk, when phones drop exposure and blur.
- **Surface:** Photogrammetry needs texture to match. Dry, textured rock works well. Wet, glossy, or very uniform rock reconstructs poorly.
- **Clear the area:** Move pads, bags and people out of frame. Things that move between shots become floating junk.
- **Leave the rock as it is:** Don't brush or alter the rock or vegetation just to scan it.
- **Battery and storage:** A full scan can be several hundred photos or a few minutes of video.

## Coverage pattern

1. **Orbit low**, about waist height, keeping the whole boulder in frame and overlapping each shot by 60-80%. Walk slowly in one full circle.
2. **Orbit high** from a higher angle (a step up, or arms raised) in a second circle, looking down at the top and upper faces.
3. **Orbit again low**, aimed at the base and the problem faces. Get down to knee height for overhangs and undercuts.
4. **Fill gaps.** Anywhere you plan to place holds needs coverage from at least two angles. Overhangs, caves, and the landing area are where holes appear.
5. **Do the top** only if you can see it safely. Don't climb on fragile or restricted rock to do it; a hole in the top is better than a risky scan.
6. Include a little ground around the boulder. You will crop it later, but it gives the software context.

Keep one scan to one boulder. Other boulders, trees or buildings left in the export are the usual cause of the floating-pieces failure.

## Export settings by app

> **Unverified:** app menus change often, and these notes have not been checked against current app versions. Treat them as the settings to look for, not exact click paths, and check each app's own help if a name below doesn't match.

What every app should give you: a **GLB** (best), glTF, PLY, or OBJ zipped with its textures; **textures or vertex colour on**; **texture at 2048 px or larger** where the app lets you choose; and a **mesh somewhere between 100k and 2M triangles** (the 100k to 2M range is a practical suggestion, not a QC rule; the hard limits are 10k and 5M).

- **Polycam:** Process at the highest detail your plan allows, then export as GLB (or OBJ with textures). Look for texture-size and mesh-quality options on the export screen. Use the crop tool before export to cut away ground and surroundings.
- **Scaniverse:** Export a mesh as GLB, OBJ or PLY. A splat or point-cloud-only output is not a mesh and will not pass. Crop before exporting if the app offers it.
- **RealityScan:** Run a high-detail reconstruction, then texture and export a mesh. Look in the export dialog for texture resolution and a triangle limit. Simplify the mesh if it exceeds 5M triangles.
- **Luma:** Its default output is a radiance-field capture, not a mesh. Only use it if it offers a textured mesh export (GLB or OBJ), and check the result in a viewer first. If it exports only a splat or point cloud, SandBag cannot use it.
- **Anything else (Meshroom, Metashape, Kiri, etc.):** Export a textured mesh as GLB, glTF, PLY or OBJ plus textures. The same rules apply.

Scale: most phone apps export in metres. If your boulder reads as 0.01 m or 400 m, the unit is wrong; re-export with metres selected, or rescale before uploading.

## Common QC failures and fixes

| Message | What it means | Fix |
| --- | --- | --- |
| "Only N triangles; we need at least 10,000" | Mesh is too low-poly | Re-export at higher mesh quality or detail |
| "This scan is too large ... limit is 5M triangles" | Mesh is too dense | Simplify or decimate to under 5M and upload again |
| Scale: "check the units" | Size outside 2-20 m (warn) or 0.3-30 m (fail) | Re-export in metres; check you scanned one boulder, not a whole area |
| "The mesh is flat (no volume)" | Only one side was captured | Re-shoot with full orbits, including low and high passes |
| "disconnected floating pieces" | Debris, other objects, or ground fragments | Crop to the boulder in the app before export |
| "no colour" or "texture image isn't in the upload" | Texture was off or missing | Export with textures on. For OBJ, zip the .obj, .mtl and texture images together, or export a GLB with the texture embedded |
| Texture under 1024 px (fail) or 2048 px (warn) | Low texture resolution | Export the texture at 2048 px or higher |
| Zero-area faces or non-manifold edges | Messy mesh, advisory only | Use the app's mesh clean-up or repair option, if it has one |
| File over 200 MB (or 50 MB on hosted Free) | Too big to upload | Lower the texture size or simplify the mesh; prefer GLB |

## Before you upload

- Open the file in a viewer and orbit it. Look for holes, smears, and stray geometry.
- Confirm it is one boulder, cropped, with colour.
- Check the file type and size.
- Then go to `/upload`. If a check fails, the scan page shows the reason in plain English, and "Upload a new version" starts a retry.

Scans are shared under CC BY-SA 4.0. See [PRD section 9](PRD.md) for the full QC spec.

*Issue #34 asks that a first-time scanner can produce a passing scan using only this page. That has not been tested yet; please report where you got stuck.*
