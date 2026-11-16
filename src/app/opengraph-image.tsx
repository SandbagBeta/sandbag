import { ImageResponse } from "next/og";

// Default site card. Static and generic on purpose: no area, boulder or
// location data of any kind (PRD §2, ADR 001).
export const alt = "SandBag: open 3D boulder visualizer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#f5efe3",
        color: "#25211a",
        fontFamily: "serif",
      }}
    >
      <svg width="140" height="140" viewBox="0 0 24 24" fill="none">
        <path
          d="M2.5 19.5 9 7l4 7 2.5-4 6 9.5z"
          stroke="#3d5a38"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{ fontSize: 128, fontWeight: 700, marginTop: 24 }}>
        SandBag
      </div>
      <div style={{ fontSize: 44, color: "#5b5244", marginTop: 12 }}>
        Open 3D boulder visualizer
      </div>
      <div style={{ fontSize: 30, color: "#8a5628", marginTop: 40 }}>
        Open code · Open data · Access first
      </div>
    </div>,
    size,
  );
}
