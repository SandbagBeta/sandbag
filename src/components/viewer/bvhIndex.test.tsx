// @vitest-environment jsdom
import { Bvh } from "@react-three/drei";
import { createRoot, extend, type RootState } from "@react-three/fiber";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster } from "three";

extend({ Group, Mesh, BoxGeometry, MeshBasicMaterial });

/**
 * Regression for the hold face numbers (#129): the server numbers faces by
 * the file's index order, so a hit's faceIndex only matches if drei's Bvh
 * leaves the index buffer alone. The default BVH reorders it in place;
 * `indirect` does not. Mounted in a real R3F root with a stub renderer (jsdom
 * has no WebGL), which is enough for Bvh: it only needs the raycaster.
 */
describe("<Bvh indirect>", () => {
  async function mountIndexAfter(indirect: boolean) {
    const geometry = new BoxGeometry(1, 1, 1, 8, 8, 8);
    const before = Array.from(geometry.index!.array);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const canvas = document.createElement("canvas");
    const root = createRoot(canvas);
    let state: RootState | undefined;
    await root.configure({
      gl: () =>
        ({
          domElement: canvas,
          setPixelRatio() {},
          setSize() {},
          render() {},
          dispose() {},
          shadowMap: {},
          outputColorSpace: "",
          toneMapping: 0,
          xr: {
            enabled: false,
            addEventListener() {},
            removeEventListener() {},
          },
          getContext: () => ({}),
        }) as never,
      frameloop: "never",
      events: undefined,
      onCreated: (s) => (state = s),
      raycaster: new Raycaster(),
    });
    root.render(
      <Bvh firstHitOnly indirect={indirect}>
        <primitive object={mesh} />
      </Bvh>,
    );
    await vi.waitFor(() => expect(geometry.boundsTree).toBeTruthy());
    const after = Array.from(geometry.index!.array);
    root.unmount();
    void state;
    return { before, after };
  }

  it("keeps geometry.index in file order", async () => {
    const { before, after } = await mountIndexAfter(true);
    expect(after).toEqual(before);
  });

  it("(control) the default BVH does reorder it", async () => {
    const { before, after } = await mountIndexAfter(false);
    expect(after).not.toEqual(before);
  });
});
