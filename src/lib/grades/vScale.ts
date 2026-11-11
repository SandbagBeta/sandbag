/** V-scale helpers. Grades are strings like "VB", "V0", "V10"; unknown strings rank as null. */
export const V_GRADES: readonly string[] = [
  "VB",
  ...Array.from({ length: 18 }, (_, i) => `V${i}`),
];

/** Numeric rank for ordering/differences: VB = -1, V0 = 0, V4 = 4. Null if not a V grade. */
export function gradeRank(grade: string): number | null {
  const g = grade.trim().toUpperCase();
  if (g === "VB") return -1;
  const m = /^V(\d{1,2})$/.exec(g);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 17 ? n : null;
}
