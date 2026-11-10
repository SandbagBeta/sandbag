import { isUuid, parseRawObjectKey, rawFolder, rawObjectKey } from "./keys";
import {
  checkUploadFile,
  checkZipEntries,
  extensionOf,
  MAX_UPLOAD_BYTES,
  storedFileName,
} from "./validate";
import { readZipEntryNames } from "./zip";

const MB = 1024 * 1024;
const USER = "00000000-0000-4000-8000-0000000000a1";
const SCAN = "20000000-0000-4000-8000-0000000000a1";

describe("checkUploadFile", () => {
  it.each([
    ["scan.glb", "glb", "model/gltf-binary"],
    ["scan.gltf", "gltf", "model/gltf+json"],
    ["scan.ply", "ply", "application/octet-stream"],
    ["scan.zip", "zip", "application/zip"],
    ["SCAN.GLB", "glb", "model/gltf-binary"],
    ["Scan.Ply", "ply", "application/octet-stream"],
    ["my.boulder.v2.ply", "ply", "application/octet-stream"],
    ["evil.exe.ply", "ply", "application/octet-stream"],
  ])("accepts %j as %s", (name, kind, contentType) => {
    expect(checkUploadFile({ name, size: 10 })).toEqual({
      ok: true,
      kind,
      contentType,
    });
  });

  it.each([
    "scan.ply.exe",
    "scan.glb.zip.js",
    "scan.stl",
    "scan.fbx",
    "scan",
    "scan.",
    "scan.ply ",
  ])("rejects %j", (name) => {
    const r = checkUploadFile({ name, size: 10 });
    expect(r.ok).toBe(false);
  });

  it("tells OBJ users to zip the OBJ with its textures", () => {
    const r = checkUploadFile({ name: "scan.OBJ", size: 10 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/zip/) });
  });

  it.each([
    [0, false],
    [1, true],
    [200 * MB, true],
    [200 * MB + 1, false],
    [-1, false],
    [Number.NaN, false],
  ])("size %d accepted: %s", (size, ok) => {
    expect(checkUploadFile({ name: "a.glb", size }).ok).toBe(ok);
  });

  it("caps at the 200MiB bucket limit in supabase/config.toml", () => {
    expect(MAX_UPLOAD_BYTES).toBe(200 * MB);
    const r = checkUploadFile({ name: "a.ply", size: 250 * MB });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("200 MB") });
  });

  it("reads the extension of the last path segment only", () => {
    expect(extensionOf("dir.glb/scan")).toBe("");
    expect(extensionOf("C:\\x.zip\\scan.PLY")).toBe("ply");
  });
});

describe("checkZipEntries", () => {
  it("needs an .obj or .gltf inside", () => {
    expect(
      checkZipEntries(["scan/model.OBJ", "scan/model.mtl", "tex.jpg"]),
    ).toBeNull();
    expect(checkZipEntries(["scene.gltf", "scene.bin"])).toBeNull();
    expect(checkZipEntries(["readme.txt", "tex.jpg"])).toMatch(
      /no \.obj or \.gltf/,
    );
    expect(checkZipEntries([])).not.toBeNull();
  });
});

/** Minimal stored zip: central directory + end record (no local data needed). */
function zipWith(names: string[], comment = ""): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [new Uint8Array(100)]; // stand-in for file data
  let cdSize = 0;
  for (const n of names) {
    const name = enc.encode(n);
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(28, name.length, true);
    parts.push(new Uint8Array(h.buffer), name);
    cdSize += 46 + name.length;
  }
  const c = enc.encode(comment);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, 100, true);
  e.setUint16(20, c.length, true);
  parts.push(new Uint8Array(e.buffer), c);
  return new Blob(parts as BlobPart[]);
}

describe("readZipEntryNames", () => {
  it("lists entries from the central directory", async () => {
    expect(
      await readZipEntryNames(zipWith(["a/model.obj", "a/model.mtl"])),
    ).toEqual(["a/model.obj", "a/model.mtl"]);
  });

  it("finds the end record behind an archive comment", async () => {
    expect(
      await readZipEntryNames(zipWith(["x.gltf"], "made by a scanner app")),
    ).toEqual(["x.gltf"]);
  });

  it("returns null for a file that isn't a zip", async () => {
    expect(await readZipEntryNames(new Blob([new Uint8Array(500)]))).toBeNull();
    expect(await readZipEntryNames(new Blob([]))).toBeNull();
  });
});

describe("storage keys (ADR 002 §3)", () => {
  it("drops the contributor's filename for a fixed one", () => {
    expect(storedFileName("ply")).toBe("source.ply");
  });

  it("builds uploads/{uploader}/{scan}/raw/source.<ext>", () => {
    expect(rawObjectKey(USER, SCAN, "glb")).toBe(
      `${USER}/${SCAN}/raw/source.glb`,
    );
    expect(rawObjectKey(USER.toUpperCase(), SCAN, "zip")).toBe(
      `${USER}/${SCAN}/raw/source.zip`,
    );
    expect(rawFolder(USER, SCAN)).toBe(`${USER}/${SCAN}/raw`);
  });

  it("refuses anything but ids in the path", () => {
    expect(() => rawObjectKey("../etc", SCAN, "glb")).toThrow(TypeError);
    expect(() => rawObjectKey(USER, "Bishop/Buttermilks", "glb")).toThrow(
      TypeError,
    );
  });

  it("parses only keys it built", () => {
    expect(parseRawObjectKey(rawObjectKey(USER, SCAN, "ply"))).toEqual({
      uploaderId: USER,
      scanId: SCAN,
      fileName: "source.ply",
    });
    expect(parseRawObjectKey(`${USER}/${SCAN}/raw/other.ply`)).toBeNull();
    expect(parseRawObjectKey(`${USER}/${SCAN}/derived/source.ply`)).toBeNull();
    expect(parseRawObjectKey(`x/${SCAN}/raw/source.ply`)).toBeNull();
    expect(parseRawObjectKey("")).toBeNull();
  });

  it("isUuid", () => {
    expect(isUuid(USER)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
