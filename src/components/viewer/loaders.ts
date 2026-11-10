/**
 * Shared GLTF loader configuration (lane rule: Draco/meshopt configured once).
 *
 * - meshopt: drei's `useGLTF` bundles `MeshoptDecoder` from three/examples and
 *   enables it when the third argument is `true`. Our canonical GLBs are
 *   meshopt-compressed (EXT_meshopt_compression), so this is the hot path and
 *   needs no network access.
 * - Draco: three's DRACOLoader needs WASM decoder files served from somewhere.
 *   We use drei's default host (Google's gstatic CDN), pinned below. To
 *   self-host, copy `node_modules/three/examples/jsm/libs/draco/gltf/` into
 *   `public/draco/` and change DRACO_DECODER_PATH to "/draco/".
 */
import { useGLTF } from "@react-three/drei";

export const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

/** Load a scan GLB with Draco + meshopt enabled. Suspends while loading. */
export function useScanGLTF(url: string) {
  return useGLTF(url, DRACO_DECODER_PATH, true);
}

/** Drop a cached (possibly failed) load so a retry re-fetches the file. */
export function clearScanGLTF(url: string) {
  useGLTF.clear(url);
}

/** Warm the cache ahead of mount (e.g. on hover of a boulder card). */
export function preloadScanGLTF(url: string) {
  useGLTF.preload(url, DRACO_DECODER_PATH, true);
}
