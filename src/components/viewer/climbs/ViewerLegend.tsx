import {
  HOLD_STYLE,
  HOLD_TYPES,
  PATH_KINDS,
  PATH_STYLE,
} from "../holds/holdStyle";

/** Swatch dash pattern in px, proportional to the 3D pattern in meters. */
const PX_PER_M = 100;

/** Key for the 3D markers and paths. DOM-only, so it renders without WebGL. */
export function ViewerLegend() {
  return (
    <section aria-labelledby="viewer-legend-heading">
      <h2 id="viewer-legend-heading" className="mb-2 text-sm font-semibold">
        Legend
      </h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {HOLD_TYPES.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <span aria-hidden style={{ color: HOLD_STYLE[t].color }}>
              {HOLD_STYLE[t].glyph}
            </span>
            {HOLD_STYLE[t].label} hold
          </li>
        ))}
        {PATH_KINDS.map((k) => {
          const { color, dash, label } = PATH_STYLE[k];
          return (
            <li key={k} className="flex items-center gap-2">
              {/* Dark backdrop stands in for rock so the white downclimb shows. */}
              <svg
                aria-hidden
                width="28"
                height="12"
                viewBox="0 0 28 12"
                className="shrink-0 rounded-sm bg-stone-700"
              >
                <line
                  x1="2"
                  y1="6"
                  x2="26"
                  y2="6"
                  stroke={color}
                  strokeWidth="3"
                  strokeDasharray={
                    dash
                      ? `${dash.size * PX_PER_M} ${dash.gap * PX_PER_M}`
                      : undefined
                  }
                />
              </svg>
              {label}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
