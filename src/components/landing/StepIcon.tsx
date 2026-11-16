import type { ReactNode } from "react";

export type StepIconName =
  "scan" | "upload" | "attach" | "annotate" | "explore";

const paths: Record<StepIconName, ReactNode> = {
  scan: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M10.5 18.5h3M3 8V5.5M21 8V5.5M3 16v2.5M21 16v2.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v4.5h16V15" />
    </>
  ),
  attach: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  annotate: (
    <>
      <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  explore: (
    <>
      <path d="M2.5 19.5 9 7l4 7 2.5-4 6 9.5z" />
      <path d="M9 7l1.5 3" />
    </>
  ),
};

export function StepIcon({ name }: { name: StepIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
