import {
  consensusGrade,
  sandbagGrades,
  sandbagLabel,
  tally,
  totalVotes,
} from "./consensus";
import { gradeRank } from "./vScale";

describe("gradeRank", () => {
  it("orders VB < V0 < V10 and rejects junk", () => {
    expect(gradeRank("VB")).toBe(-1);
    expect(gradeRank("v4")).toBe(4);
    expect(gradeRank("V17")).toBe(17);
    expect(gradeRank("V18")).toBeNull();
    expect(gradeRank("5.10a")).toBeNull();
  });
});

describe("tally", () => {
  it("counts valid grades and drops invalid ones", () => {
    const d = tally(["V3", "v3", "V4", "nope"]);
    expect(d).toEqual({ V3: 2, V4: 1 });
    expect(totalVotes(d)).toBe(3);
  });
});

describe("consensusGrade", () => {
  it("is null below the minimum votes", () => {
    expect(consensusGrade({ V4: 2 })).toBeNull();
    expect(consensusGrade({})).toBeNull();
  });
  it("picks the mode", () => {
    expect(consensusGrade({ V3: 1, V5: 3 })).toBe("V5");
  });
  it("breaks ties toward the median, then the lower grade", () => {
    expect(consensusGrade({ V2: 2, V6: 2 })).toBe("V2");
    expect(consensusGrade({ V2: 2, V4: 2, V9: 1 })).toBe("V4");
    expect(consensusGrade({ V2: 2, V4: 2, V3: 1 })).toBe("V2");
  });
});

describe("sandbagGrades / label", () => {
  it("counts grades harder than baseline only", () => {
    expect(sandbagGrades("V6", "V4")).toBe(2);
    expect(sandbagGrades("V4", "V4")).toBe(0);
    expect(sandbagGrades("V2", "V4")).toBe(0);
    expect(sandbagGrades(null, "V4")).toBe(0);
    expect(sandbagGrades("V4", "hard")).toBe(0);
    expect(sandbagGrades("V0", "VB")).toBe(1);
  });
  it("labels singular/plural, none when 0", () => {
    expect(sandbagLabel(1)).toBe("Sandbagged by 1 grade");
    expect(sandbagLabel(3)).toBe("Sandbagged by 3 grades");
    expect(sandbagLabel(0)).toBeNull();
  });
});
