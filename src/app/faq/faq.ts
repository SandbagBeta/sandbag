/**
 * FAQ content. Every claim here is checked against the code or docs it names;
 * if one of those changes, change the answer (the tests only guard shape).
 * Answers are plain text (also used for the FAQPage structured data).
 */
export interface FaqItem {
  q: string;
  /** Paragraphs of plain text. */
  a: string[];
}

export interface FaqSection {
  id: string;
  title: string;
  items: FaqItem[];
}

const REPO = "https://github.com/sandbagbeta/sandbag";

export const FAQ_SECTIONS: readonly FaqSection[] = [
  {
    id: "scanning",
    title: "Scanning and uploading",
    items: [
      {
        q: "Which apps can I scan with?",
        a: [
          "Any app that exports a 3D mesh: Polycam, Scaniverse, RealityScan, Luma and similar. Export as .glb, .gltf or .ply, or as a .zip that holds an .obj (or .gltf) together with its textures.",
          `The capture guide has per-app tips: ${REPO}/blob/main/docs/capture-guide.md`,
        ],
      },
      {
        q: "How big can a file be?",
        a: [
          "Up to 200 MB on a normal setup. The free hosted storage plan caps every file at 50 MB, and that cap cannot be raised, so on the current hosted site a larger file is refused with a message that says so. Compressing or decimating the scan in your scanning app before export usually gets under it.",
        ],
      },
      {
        q: "What do the automatic checks look for?",
        a: [
          "Right after upload, a set of checks runs: the file type matches its contents, the mesh loads, it has between 10,000 and 5,000,000 triangles, and its longest side is between 0.3 m and 30 m. It also fails if more than half of the mesh is loose floating pieces, and if the scan has a colour texture it must be at least 1,024 px on its longest side.",
          "Some things only warn and do not block you: a size outside 2 m to 20 m (check that you exported in metres), a texture under 2,048 px, many loose pieces, and small mesh defects.",
        ],
      },
      {
        q: "How long do the checks take?",
        a: [
          "Usually a minute or two. Your scan page shows each step as it happens, so you can leave and come back.",
        ],
      },
      {
        q: "My scan failed the checks. What now?",
        a: [
          "Your scan page lists every failed check in plain English with what to do about it. After fixing the file, choose “Upload a new version”. The old attempt keeps its history, and nothing is lost.",
        ],
      },
    ],
  },
  {
    id: "review",
    title: "Review and publishing",
    items: [
      {
        q: "What does “waiting for a reviewer” mean?",
        a: [
          "The automatic checks passed and a person now looks at the scan. They ask: is it actually a boulder, is it the boulder you claim, is the coverage good enough, and is the area free of access concerns.",
        ],
      },
      {
        q: "Who reviews, and can I approve my own scan?",
        a: [
          "For now, maintainers review. Community reviewers who earn trust are planned for later. No one can approve their own scan; the app refuses it.",
        ],
      },
      {
        q: "How long does review take?",
        a: [
          "There is no promised turnaround. SandBag is run by volunteers, so it can take a while. You will see the result on your notifications page.",
        ],
      },
      {
        q: "What can a reviewer decide?",
        a: [
          "Approve (the scan is published), request changes, or reject. Request changes and reject always come with a written reason, shown on your scan page. A scan is usually rejected for not being a boulder, being the wrong boulder, poor coverage, or being in an area that should not be shown.",
        ],
      },
      {
        q: "Can I add climbs to a published scan?",
        a: [
          "Yes. Open a published boulder and choose “Add a climb”. You place the holds on the mesh, mark the line, topout and downclimb, and propose a grade. A climb is reviewed before it is published, and you can edit your own while it is waiting.",
        ],
      },
    ],
  },
  {
    id: "access",
    title: "Access and privacy",
    items: [
      {
        q: "How does SandBag protect sensitive areas?",
        a: [
          "Every area has a privacy level: exact, fuzzed (shifted by about a kilometre) or hidden. A hidden area never shows coordinates anywhere: not on pages, in previews, or in downloads. The strictest level among an area and its parent areas wins, and if the lookup ever fails, the area is treated as hidden.",
          "Area and boulder names are public; precise locations are kept in tables the public cannot read.",
        ],
      },
      {
        q: "How do I flag an area as sensitive or closed?",
        a: [
          "Tick “This area is sensitive or closed” on the upload form (it needs an attached area). If you notice a published area that should be hidden, open an issue on GitHub or contact a maintainer and it will be flagged.",
        ],
      },
      {
        q: "Does a scan reveal where it was taken?",
        a: [
          "The published model has its metadata stripped, so embedded location data is not served. Your original upload is kept private.",
        ],
      },
      {
        q: "Where do areas and climbs come from?",
        a: [
          "From OpenBeta, the open climbing database. SandBag stores only the 3D layer (scans, holds, lines and grade votes) and links it to OpenBeta records, so the climbing data stays theirs.",
        ],
      },
    ],
  },
  {
    id: "licensing",
    title: "Licensing and data",
    items: [
      {
        q: "What licence are my scans and annotations under?",
        a: [
          "CC BY-SA 4.0. By uploading you agree to that. Anyone can reuse the data with credit and share-alike, and it can never be locked up. Contributors are credited by handle.",
        ],
      },
      {
        q: "What licence is the code under?",
        a: [
          `AGPL-3.0, so improvements flow back. You can self-host SandBag: the README has the steps. ${REPO}`,
        ],
      },
      {
        q: "Can I download the data?",
        a: [
          "Yes. Every published boulder has “Download open data (.zip)” with the mesh and the annotations as JSON, plus attribution. A whole-dataset export is documented too, for researchers and tool builders.",
          `Format: ${REPO}/blob/main/docs/dataset.md`,
        ],
      },
      {
        q: "Is my email public? What happens if I delete my account?",
        a: [
          "Public pages and downloads show your handle only, never your email. If an account is deleted, its scans, climbs and reviews stay (the data is CC BY-SA) but become anonymous, and its grade votes are deleted. There is no self-service delete button yet: open an issue or contact a maintainer.",
        ],
      },
    ],
  },
];

/** schema.org FAQPage as JSON, safe to inline in a script tag. */
export function faqJsonLd(sections: readonly FaqSection[] = FAQ_SECTIONS) {
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: sections.flatMap((s) =>
      s.items.map((i) => ({
        "@type": "Question",
        name: i.q,
        acceptedAnswer: { "@type": "Answer", text: i.a.join(" ") },
      })),
    ),
  });
  // "<" can never end the script element, whatever the text says.
  return json.replace(/</g, "\\u003c");
}
