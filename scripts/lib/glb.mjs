// GLB build/read helpers on top of @gltf-transform. Pure in-memory: callers
// decide where bytes go. Output is the project's canonical form (lane guide):
// GLB, meshopt-compressed (EXT_meshopt_compression + KHR_mesh_quantization),
// Y-up, meters.
import { Document, Logger, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { getBounds, meshopt, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

export const MAX_FIXTURE_BYTES = 10 * 1024 * 1024;

let ioPromise;
/** Shared NodeIO with meshopt codec + quantization registered. */
export function getIO() {
  ioPromise ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]).then(
    () =>
      new NodeIO()
        .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
        .registerDependencies({
          "meshopt.decoder": MeshoptDecoder,
          "meshopt.encoder": MeshoptEncoder,
        }),
  );
  return ioPromise;
}

/**
 * Builds a single-mesh GLB from raw geometry.
 * @param {{ positions: Float32Array, normals: Float32Array, colors?: Float32Array, indices: Uint32Array }} geometry
 * @param {{ name?: string }} [options]
 * @returns {Promise<Uint8Array>} GLB bytes
 */
export async function buildGLB(geometry, { name = "boulder" } = {}) {
  const io = await getIO();
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  doc.createBuffer();
  doc.getRoot().getAsset().generator = "sandbag demo-boulder generator";

  const position = doc
    .createAccessor("POSITION")
    .setType("VEC3")
    .setArray(geometry.positions);
  const normal = doc
    .createAccessor("NORMAL")
    .setType("VEC3")
    .setArray(geometry.normals);
  const indices = doc
    .createAccessor("indices")
    .setType("SCALAR")
    .setArray(geometry.indices);

  const material = doc
    .createMaterial("rock")
    .setRoughnessFactor(0.95)
    .setMetallicFactor(0);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setIndices(indices)
    .setMaterial(material);
  if (geometry.colors) {
    prim.setAttribute(
      "COLOR_0",
      doc.createAccessor("COLOR_0").setType("VEC3").setArray(geometry.colors),
    );
  }

  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene("scene").addChild(node);
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);

  await doc.transform(
    weld(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  return io.writeBinary(doc);
}

/**
 * Reads a GLB back into flat, world-space geometry (node transforms applied,
 * so quantized positions come out in meters) plus summary stats.
 */
export async function readGLB(bytes) {
  const io = await getIO();
  const doc = await io.readBinary(bytes);
  const scene =
    doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("GLB has no scene");
  const nodes = scene.listChildren().filter((n) => n.getMesh());
  if (nodes.length !== 1) {
    throw new Error(`expected exactly one mesh node, found ${nodes.length}`);
  }
  const node = nodes[0];
  const prims = node.getMesh().listPrimitives();
  if (prims.length !== 1) {
    throw new Error(`expected exactly one primitive, found ${prims.length}`);
  }
  const prim = prims[0];
  const m = node.getWorldMatrix();
  const positions = transformVec3Array(prim.getAttribute("POSITION"), m, 1);
  const normals = transformVec3Array(prim.getAttribute("NORMAL"), m, 0);
  const indices = prim.getIndices().getArray();
  const { min, max } = getBounds(scene);
  return {
    positions,
    normals,
    indices,
    triCount: indices.length / 3,
    vertexCount: positions.length / 3,
    bounds: { min, max },
    hasColors: Boolean(prim.getAttribute("COLOR_0")),
    extensions: doc
      .getRoot()
      .listExtensionsUsed()
      .map((e) => e.extensionName),
  };
}

/** Dequantize + apply a column-major 4x4 matrix (w=1 points, w=0 normals). */
function transformVec3Array(accessor, m, w) {
  const count = accessor.getCount();
  const out = new Float32Array(count * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    accessor.getElement(i, v); // handles normalized integer attributes
    const [x, y, z] = v;
    let ox = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    let oy = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    let oz = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    if (w === 0) {
      const len = Math.hypot(ox, oy, oz) || 1;
      ox /= len;
      oy /= len;
      oz /= len;
    }
    out[i * 3] = ox;
    out[i * 3 + 1] = oy;
    out[i * 3 + 2] = oz;
  }
  return out;
}
