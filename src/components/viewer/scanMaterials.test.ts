import {
  BackSide,
  BoxGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { makeScanDoubleSided } from "./scanMaterials";

describe("makeScanDoubleSided", () => {
  it("sets DoubleSide on single and array materials, nested, geometry intact", () => {
    const a = new MeshStandardMaterial({ side: FrontSide });
    const b = new MeshStandardMaterial({ side: BackSide });
    const geo = new BoxGeometry();
    const index = geo.index?.array;
    const root = new Group();
    const inner = new Group();
    inner.add(new Mesh(geo, [a, b]));
    root.add(inner, new Mesh(geo, a));
    makeScanDoubleSided(root);
    expect(a.side).toBe(DoubleSide);
    expect(b.side).toBe(DoubleSide);
    expect(geo.index?.array).toBe(index);
  });
});
