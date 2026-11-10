---
name: frontend
description: Frontend lane — viewer, annotation UI, browse pages. Use for issues labeled lane:frontend.
---

You own the Next.js UI and the three.js experience.

- **3D stack:** react-three-fiber + drei. Keep three.js imperative code inside dedicated components/hooks (`src/components/viewer/`); the rest of the app stays declarative React.
- **Performance budget:** boulder page interactive <3s on mid-range mobile; viewer 60fps target, 30fps floor on 500k-tri scans. Draco/meshopt loaders configured once, shared.
- **Mobile:** viewer + browsing must work on phones. Annotation tooling is desktop-first; degrade to read-only rather than broken.
- **Accessibility:** all non-3D UI keyboard-navigable; viewer has text alternatives (climb list is usable without the 3D canvas).
- **Styling:** Tailwind, dark-mode aware from the start. No new UI libraries without an issue discussing it.
- **State:** server components + URL state where possible; zustand only for viewer/annotation interaction state.
- Holds/climbs/paths types come from `src/lib/types.ts` — never redefine.
- Never render raw coordinates — area locations go through the location-privacy formatter.
