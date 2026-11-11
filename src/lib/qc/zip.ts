import { unzipSync } from "fflate";
import { MeshParseError } from "./mesh";
import { ZIP_INFLATED_BYTES_LIMIT } from "./thresholds";

/**
 * Unzips an OBJ or glTF upload with fflate (pure JS, no dependencies).
 * Only entries a mesh can use are inflated, and their uncompressed sizes are
 * summed from the central directory first, so a zip bomb fails before any
 * inflating (ADR 003 §6). Entry names come from the file: they are used to
 * find files, never copied into messages.
 */

const USEFUL = /\.(obj|mtl|gltf|bin|png|jpe?g|webp|ktx2)$/i;

export class ZipTooLargeError extends MeshParseError {
  constructor(limit: number) {
    super(
      `This scan is too large: the .zip unpacks to more than ${Math.round(limit / 1e6)} MB. Decimate the mesh or shrink the textures and upload again.`,
      "too_large",
    );
  }
}

export interface ZipMesh {
  kind: "obj" | "gltf";
  /** The mesh file's bytes. */
  mesh: Uint8Array;
  /** Finds a file referenced by the mesh, relative to the mesh's folder. */
  resolve(ref: string): Uint8Array | null;
}

const normalise = (p: string) =>
  p
    .replace(/\\/g, "/")
    .split("/")
    .reduce<string[]>((out, part) => {
      if (part === "..") out.pop();
      else if (part && part !== ".") out.push(part);
      return out;
    }, [])
    .join("/")
    .toLowerCase();

const ignored = (name: string) =>
  name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\._/.test(name);

export function openZip(
  bytes: Uint8Array,
  limit = ZIP_INFLATED_BYTES_LIMIT,
): ZipMesh {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        if (ignored(entry.name) || !USEFUL.test(entry.name)) return false;
        total += entry.originalSize;
        if (total > limit) throw new ZipTooLargeError(limit);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ZipTooLargeError) throw e;
    throw new MeshParseError(
      "The .zip is damaged and couldn't be opened. Zip the files again and upload the new .zip.",
      "corrupt",
    );
  }

  const names = Object.keys(files).sort();
  const meshes = names.filter((n) => /\.(obj|gltf)$/i.test(n));
  if (meshes.length === 0) {
    throw new MeshParseError(
      "The .zip has no .obj or .gltf file inside. Add the mesh and upload again.",
      "unsupported",
    );
  }
  if (meshes.length > 1) {
    throw new MeshParseError(
      "The .zip has more than one mesh (.obj or .gltf). Upload one boulder per .zip.",
      "unsupported",
    );
  }
  const meshName = meshes[0]!;
  const dir = meshName.includes("/")
    ? meshName.slice(0, meshName.lastIndexOf("/") + 1)
    : "";
  const byPath = new Map(names.map((n) => [normalise(n), files[n]!]));
  const byBase = new Map<string, Uint8Array | null>();
  for (const n of names) {
    const base = normalise(n).split("/").pop()!;
    // Two files with the same base name: ambiguous, so no fallback.
    byBase.set(base, byBase.has(base) ? null : files[n]!);
  }

  return {
    kind: /\.obj$/i.test(meshName) ? "obj" : "gltf",
    mesh: files[meshName]!,
    resolve(ref) {
      let r = ref.trim();
      try {
        r = decodeURIComponent(r);
      } catch {
        // keep as written
      }
      const exact = byPath.get(normalise(dir + r));
      if (exact) return exact;
      return byBase.get(normalise(r).split("/").pop() ?? "") ?? null;
    },
  };
}
