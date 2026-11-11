import { gradesInRange, parseSearchParams, terms, toTsQuery } from "./query";

describe("parseSearchParams", () => {
  it("trims the query and parses the grade range", () => {
    expect(
      parseSearchParams({ q: "  Lieback   crack ", min: "2", max: "V4" }),
    ).toEqual({
      q: "Lieback crack",
      minV: 2,
      maxV: 4,
    });
  });

  it("swaps an inverted range and drops invalid grades", () => {
    expect(parseSearchParams({ min: "6", max: "3" })).toMatchObject({
      minV: 3,
      maxV: 6,
    });
    expect(parseSearchParams({ min: "V99", max: "abc" })).toMatchObject({
      minV: null,
      maxV: null,
    });
  });

  it("takes the first of repeated params and caps the length", () => {
    const p = parseSearchParams({ q: ["a".repeat(500), "b"] });
    expect(p.q).toHaveLength(100);
  });
});

describe("toTsQuery", () => {
  it("ANDs prefix terms so a partial name still matches", () => {
    expect(toTsQuery("Lieback")).toBe("lieback:*");
    expect(toTsQuery("lieb crack")).toBe("lieb:* & crack:*");
  });

  it("strips tsquery syntax from user input", () => {
    expect(toTsQuery("a & !b | (c) <-> d:*")).toBe("a:* & b:* & c:* & d:*");
    expect(toTsQuery("  !&|()  ")).toBeNull();
    expect(toTsQuery("")).toBeNull();
  });

  it("keeps non-ASCII letters", () => {
    expect(terms("Église Überhang")).toEqual(["église", "überhang"]);
  });
});

describe("gradesInRange", () => {
  it("lists V grades inclusively, open ends default to the scale bounds", () => {
    expect(gradesInRange(2, 4)).toEqual(["V2", "V3", "V4"]);
    expect(gradesInRange(16, null)).toEqual(["V16", "V17"]);
    expect(gradesInRange(null, 1)).toEqual(["V0", "V1"]);
    expect(gradesInRange(null, null)).toBeNull();
  });
});
