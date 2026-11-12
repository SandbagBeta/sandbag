import { createHash } from "node:crypto";
import { Document, NodeIO, type Texture } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { meshopt, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import type { ParsedMesh } from "./mesh";
import { imageMimeType } from "./image";
import { stripImageMetadata } from "./strip";

/**
 * Builds the canonical GLB (ADR 003 flow step 4, O7, O10): ONE mesh, ONE
 * primitive, one node with no transform, welded, meshopt reorder + quantize +
 * compress. SERVER ONLY.
 *
 * Frame. Positions are the parsed mesh (already relative to its bbox centre,
 * which drops any georeference offset) with y shifted so the lowest point sits
 * at y = 0: centred on x/z, resting on the ground plane. This is "the GLB's
 * own frame", the one holds are anchored in. The validator reads holds against
 * the decoded GLB (`flattenDocument` + `meshSurfaceFromParsed`), so
 * quantization and triangle reordering are accounted for by construction;
 * never validate against `ParsedMesh` from the source.
 *
 * Location (O10): nothing from the source is copied but geometry, UVs, vertex
 * colours and one base-colour texture with its metadata stripped. No names,
 * `extras`, extensions or cameras survive, because the document is built fresh.
 *
 * Determinism: no clocks or randomness; same input and same pinned encoder
 * versions give the same bytes (and so the same `content_hash`).
 */

/** Pinned toolchain, recorded in `QC_PIPELINE_VERSION` (bump with it). */
export const CANONICAL_ENCODER = {
  gltf_transform: "4.5.1",
  meshoptimizer: "1.3.0",
} as const;

export interface CanonicalGlb {
  bytes: Uint8Array;
  /** sha256 hex of `bytes`: `scans.content_hash`. */
  contentHash: string;
  /** The grounded, centred source geometry (for the thumbnail). */
  positions: Float32Array;
  indices: Uint32Array;
  /** Whether the source was off-origin and had to be recentred. */
  recentred: boolean;
  /** A texture was dropped because the source used several (see docs). */
  textureDropped: boolean;
}

/** The single base-colour texture the mesh's UVs address, if unambiguous. */
function singleTexture(source: Document | null): {
  texture: Texture | null;
  ambiguous: boolean;
} {
  if (!source) return { texture: null, ambiguous: false };
  const found = new Set<Texture>();
  for (const mesh of source.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const t = prim.getMaterial()?.getBaseColorTexture();
      if (t?.getImage()) found.add(t);
    }
  }
  return {
    texture: found.size === 1 ? [...found][0]! : null,
    ambiguous: found.size > 1,
  };
}

export async function buildCanonicalGlb(
  mesh: ParsedMesh,
  source: Document | null,
): Promise<CanonicalGlb> {
  await MeshoptEncoder.ready;

  const positions = Float32Array.from(mesh.positions);
  let lowY = Infinity;
  for (let i = 1; i < positions.length; i += 3)
    lowY = Math.min(lowY, positions[i]!);
  if (!Number.isFinite(lowY)) lowY = 0;
  for (let i = 1; i < positions.length; i += 3)
    positions[i] = positions[i]! - lowY;

  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (
    type: "SCALAR" | "VEC2" | "VEC3" | "VEC4",
    array: Float32Array | Uint32Array | Uint8Array,
    normalized = false,
  ) =>
    doc
      .createAccessor()
      .setType(type)
      .setArray(array as Float32Array<ArrayBuffer>)
      .setNormalized(normalized)
      .setBuffer(buffer);

  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", acc("VEC3", positions))
    .setIndices(acc("SCALAR", mesh.indices));
  if (mesh.colors) {
    prim.setAttribute(
      "COLOR_0",
      acc(mesh.colorSize === 3 ? "VEC3" : "VEC4", mesh.colors, true),
    );
  }

  const material = doc
    .createMaterial()
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  const { texture, ambiguous } = singleTexture(source);
  let textureDropped = ambiguous;
  const image = texture?.getImage();
  if (texture && image && mesh.uvs) {
    const mime = texture.getMimeType() || imageMimeType(image) || "image/png";
    prim.setAttribute("TEXCOORD_0", acc("VEC2", mesh.uvs));
    material.setBaseColorTexture(
      doc
        .createTexture()
        .setImage(stripImageMetadata(image, mime))
        .setMimeType(mime),
    );
  } else if (texture) {
    textureDropped = true;
  }
  prim.setMaterial(material);

  doc
    .createScene()
    .addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));

  await doc.transform(
    weld(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const bytes = await io.writeBinary(doc);

  return {
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    positions,
    indices: mesh.indices,
    recentred: mesh.centre.some((c) => Math.abs(c) > 1e-6),
    textureDropped,
  };
}
