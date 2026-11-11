const steps = [
  [
    "📱",
    "Scan",
    "Capture a boulder with Polycam, Scaniverse, or any app that exports GLB/OBJ/PLY.",
  ],
  ["⬆️", "Upload", "Automated quality checks, then community review."],
  ["📍", "Attach", "Link the scan to real climbing data via OpenBeta."],
  [
    "✍️",
    "Annotate",
    "Mark holds, the line, topout and downclimb. Vote grades.",
  ],
  [
    "🧗",
    "Explore",
    "Walk around the boulder in 3D before you ever touch rock.",
  ],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-20">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sandstone text-sm font-semibold tracking-widest uppercase">
            Pre-alpha
          </p>
          {/* Static link keeps this page static; signed-out users are sent
              to /sign-in by the proxy. */}
          <a
            href="/account"
            className="text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Sign in / Account
          </a>
        </div>
        <h1 className="text-5xl font-bold tracking-tight">SandBag</h1>
        <p className="text-lg text-stone-600 dark:text-stone-400">
          Open-source 3D boulder visualizer, built on community contribution.
        </p>
        <p className="text-sm text-stone-500 italic">
          sandbag (v.): to rate a climb easier than it actually is. We keep the
          receipts.
        </p>
        <p>
          <a
            href="/areas"
            className="inline-block rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            Browse boulders
          </a>
        </p>
      </header>

      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map(([icon, title, body]) => (
          <li
            key={title}
            className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden="true">{icon}</span>
              <h2 className="font-semibold">{title}</h2>
            </div>
            <p className="text-sm text-stone-600 dark:text-stone-400">{body}</p>
          </li>
        ))}
      </ol>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-500">
        <a
          className="hover:underline"
          href="https://github.com/sandbagbeta/sandbag"
        >
          GitHub
        </a>
        <span>Code: AGPL-3.0</span>
        <span>Data: CC BY-SA 4.0</span>
        <a className="hover:underline" href="https://openbeta.io">
          Built on OpenBeta
        </a>
      </footer>
    </main>
  );
}
