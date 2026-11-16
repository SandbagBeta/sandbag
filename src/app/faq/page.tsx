import type { Metadata } from "next";
import { FAQ_SECTIONS, faqJsonLd } from "./faq";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "How to scan, upload, review and annotate boulders on SandBag, how access is protected, and how the open data is licensed.",
};

/** URLs inside plain-text answers become links. */
function Paragraph({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <p>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            className="text-moss underline underline-offset-4 hover:no-underline"
          >
            {part.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export default function FaqPage() {
  return (
    <main className="page">
      <header className="mb-8 max-w-2xl space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Frequently asked questions
        </h1>
        <p className="text-muted">
          Short answers about scanning, review, access and data. Missing
          something? Ask on{" "}
          <a
            href="https://github.com/sandbagbeta/sandbag/issues"
            className="text-moss underline underline-offset-4 hover:no-underline"
          >
            GitHub
          </a>
          .
        </p>
        <nav aria-label="FAQ sections">
          <ul className="flex flex-wrap gap-2 text-sm">
            {FAQ_SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="border-line hover:bg-surface inline-flex min-h-11 items-center rounded-full border px-4"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="max-w-2xl space-y-12">
        {FAQ_SECTIONS.map((s) => (
          <section
            key={s.id}
            id={s.id}
            aria-labelledby={`${s.id}-h`}
            className="scroll-mt-6"
          >
            <h2
              id={`${s.id}-h`}
              className="font-display mb-3 text-2xl font-semibold tracking-tight"
            >
              {s.title}
            </h2>
            <div className="border-line divide-line divide-y border-y">
              {s.items.map((item) => (
                <details key={item.q} className="group py-1">
                  <summary className="hover:text-moss flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-2 text-base font-medium [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                      className="text-muted shrink-0 transition-transform group-open:rotate-180"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <div className="text-muted space-y-3 pb-4 text-[15px] leading-relaxed">
                    {item.a.map((p) => (
                      <Paragraph key={p} text={p} />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <script
        type="application/ld+json"
        // Static content with "<" escaped (see faqJsonLd).
        dangerouslySetInnerHTML={{ __html: faqJsonLd() }}
      />
    </main>
  );
}
