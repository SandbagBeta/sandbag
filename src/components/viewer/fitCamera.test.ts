import { Box3, BoxGeometry, Group, Mesh, Vector3 } from "three";
import {
  computeCameraFit,
  measureBounds,
  NO_GEOMETRY_MESSAGE,
} from "./fitCamera";

// Demo-boulder-shaped box: 2.5 m × 1.8 m × 2 m, ground at y = 0, centered.
const boulder = new Box3(new Vector3(-1.25, 0, -1), new Vector3(1.25, 1.8, 1));

describe("computeCameraFit", () => {
  it("targets the bounds center and puts the ground at box.min.y", () => {
    const fit = computeCameraFit(boulder);
    expect(fit.target.toArray()).toEqual([0, 0.9, 0]);
    expect(fit.groundY).toBe(0);
    expect(fit.radius).toBeCloseTo(Math.hypot(2.5, 1.8, 2) / 2, 6);
  });

  it("places the camera in front/above, looking at the target, within limits", () => {
    const fit = computeCameraFit(boulder, { fovDeg: 50, margin: 1.25 });
    expect(fit.position.y).toBeGreaterThan(fit.target.y);
    expect(fit.position.z).toBeGreaterThan(0);
    const d = fit.position.distanceTo(fit.target);
    expect(d).toBeGreaterThan(fit.minDistance);
    expect(d).toBeLessThan(fit.maxDistance);
    // Bounding sphere must fit the vertical FOV with margin.
    expect(d).toBeCloseTo((fit.radius / Math.sin((50 * Math.PI) / 360)) * 1.25);
  });

  it("derives orbit limits from the bounding sphere", () => {
    const fit = computeCameraFit(boulder);
    expect(fit.minDistance).toBeCloseTo(fit.radius * 0.25);
    expect(fit.maxDistance).toBeCloseTo(fit.radius * 8);
    expect(fit.maxPolarAngle).toBeLessThan(Math.PI / 2);
    expect(fit.near).toBeGreaterThan(0);
    expect(fit.far).toBeGreaterThan(fit.maxDistance + fit.radius);
  });

  it("scales with the mesh (10× bigger box → 10× distances)", () => {
    const small = computeCameraFit(boulder);
    const big = computeCameraFit(
      new Box3(
        boulder.min.clone().multiplyScalar(10),
        boulder.max.clone().multiplyScalar(10),
      ),
    );
    expect(big.radius).toBeCloseTo(small.radius * 10);
    expect(big.maxDistance).toBeCloseTo(small.maxDistance * 10);
    expect(big.position.distanceTo(big.target)).toBeCloseTo(
      small.position.distanceTo(small.target) * 10,
    );
    expect(big.maxPolarAngle).toBe(small.maxPolarAngle);
  });

  it("still fits a flat (zero-volume) mesh such as a single wall", () => {
    const wall = new Box3(new Vector3(-1, 0, 0), new Vector3(1, 2, 0));
    const fit = computeCameraFit(wall);
    expect(Number.isFinite(fit.maxDistance)).toBe(true);
    expect(fit.minDistance).toBeGreaterThan(0);
  });

  it("throws 'scan has no geometry' for empty, point-sized or NaN bounds", () => {
    const point = new Box3(new Vector3(1, 1, 1), new Vector3(1, 1, 1));
    const nan = new Box3(new Vector3(NaN, 0, 0), new Vector3(1, 1, 1));
    for (const box of [new Box3(), point, nan]) {
      expect(() => computeCameraFit(box)).toThrow(NO_GEOMETRY_MESSAGE);
    }
  });
});

describe("measureBounds", () => {
  it("measures a mesh in world space", () => {
    const mesh = new Mesh(new BoxGeometry(2, 1, 2));
    mesh.position.set(0, 0.5, 0);
    const group = new Group().add(mesh);
    const box = measureBounds(group);
    expect(box.min.toArray()).toEqual([-1, 0, -1]);
    expect(box.max.toArray()).toEqual([1, 1, 1]);
  });

  it("throws 'scan has no geometry' for an object with no meshes", () => {
    expect(() => measureBounds(new Group())).toThrow(NO_GEOMETRY_MESSAGE);
  });
});
