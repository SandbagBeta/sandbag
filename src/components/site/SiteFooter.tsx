export function SiteFooter() {
  return (
    <footer className="border-line text-muted mt-20 border-t text-sm">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-8 sm:px-6">
        <p>
          <span className="font-display text-ink font-semibold">SandBag</span> ·
          open 3D boulder visualizer
        </p>
        <ul className="flex flex-wrap gap-x-6 [&>li]:flex [&>li]:min-h-11 [&>li]:items-center">
          <li>
            <a
              className="hover:text-ink inline-flex min-h-11 items-center underline-offset-4 hover:underline"
              href="https://github.com/sandbagbeta/sandbag"
            >
              GitHub
            </a>
          </li>
          <li>Code: AGPL-3.0</li>
          <li>Data: CC BY-SA 4.0</li>
          <li>
            <a
              className="hover:text-ink inline-flex min-h-11 items-center underline-offset-4 hover:underline"
              href="https://openbeta.io"
            >
              Built on OpenBeta
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
