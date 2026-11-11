import { buildAreaTree, crumbs, findNode, type AreaRow } from "./tree";

const USA = "00000000-0000-4000-8000-0000000000a1";
const NH = "00000000-0000-4000-8000-0000000000a2";
const PAW = "00000000-0000-4000-8000-0000000000a3";
const BOULDER = "00000000-0000-4000-8000-0000000000a4";
const MA = "00000000-0000-4000-8000-0000000000a5";

const row = (id: string, path: string[], ancestors: string[]): AreaRow => ({
  openbeta_area_id: id,
  name: path[path.length - 1]!,
  path_tokens: path,
  ancestors,
});

const boulderRow = row(
  BOULDER,
  ["USA", "New Hampshire", "Pawtuckaway", "Round Pond"],
  [USA, NH, PAW],
);
const pawRow = row(PAW, ["USA", "New Hampshire", "Pawtuckaway"], [USA, NH]);
const maRow = row(MA, ["USA", "Massachusetts"], [USA]);

describe("crumbs", () => {
  it("zips root-first ancestors with path tokens, ending at the area", () => {
    expect(crumbs(boulderRow)).toEqual([
      { id: USA, name: "USA" },
      { id: NH, name: "New Hampshire" },
      { id: PAW, name: "Pawtuckaway" },
      { id: BOULDER, name: "Round Pond" },
    ]);
  });
});

describe("buildAreaTree", () => {
  it("rolls scan counts up the chain and nests by ancestry", () => {
    const tree = buildAreaTree(
      [boulderRow, pawRow, maRow],
      new Map([
        [BOULDER, 2],
        [PAW, 1],
        [MA, 1],
      ]),
    );
    expect(tree).toHaveLength(1);
    const usa = tree[0]!;
    expect(usa).toMatchObject({ id: USA, name: "USA", scanCount: 4 });
    // Children sorted by name.
    expect(usa.children.map((c) => c.name)).toEqual([
      "Massachusetts",
      "New Hampshire",
    ]);
    const paw = findNode(tree, PAW)!;
    expect(paw.scanCount).toBe(3);
    expect(paw.children.map((c) => [c.name, c.scanCount])).toEqual([
      ["Round Pond", 2],
    ]);
  });

  it("names ancestors from path tokens even without their own cache row", () => {
    const tree = buildAreaTree([boulderRow], new Map([[BOULDER, 1]]));
    expect(findNode(tree, NH)?.name).toBe("New Hampshire");
  });

  it("leaves out areas without published scans", () => {
    expect(buildAreaTree([maRow], new Map([[MA, 0]]))).toEqual([]);
    expect(buildAreaTree([], new Map([[MA, 1]]))).toEqual([]);
  });
});
