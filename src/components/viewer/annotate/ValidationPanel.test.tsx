import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { V_GRADES } from "@/lib/grades/vScale";
import { ValidationPanel } from "./ValidationPanel";

const meta = {
  name: "",
  proposed_grade: "",
  description: "",
  fa_info: "",
};

describe("ValidationPanel grade", () => {
  it("lists a missing proposed grade instead of saying No issues", () => {
    render(
      <ValidationPanel
        holds={[]}
        meta={meta}
        scanContentHash="h"
        mesh={null}
      />,
    );
    expect(screen.getByText("Choose a proposed grade.")).toBeTruthy();
    expect(screen.queryByText("No issues.")).toBeNull();
  });

  it("is clean once a grade is chosen (mesh not loaded yet)", () => {
    render(
      <ValidationPanel
        holds={[]}
        meta={{ ...meta, proposed_grade: "V3" }}
        scanContentHash="h"
        mesh={null}
      />,
    );
    expect(screen.getByText("No issues.")).toBeTruthy();
  });
});

describe("grade options", () => {
  it("run from VB then V0 upward, in order", () => {
    expect(V_GRADES.slice(0, 3)).toEqual(["VB", "V0", "V1"]);
    expect(V_GRADES.at(-1)).toBe("V17");
  });
});
