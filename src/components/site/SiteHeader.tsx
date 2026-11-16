import Link from "next/link";

// Plain <a> links (not next/link) keep every page static-friendly: /account
// is gated by the proxy, which sends signed-out users to /sign-in.
export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/areas", label: "Areas" },
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Contribute" },
  { href: "/faq", label: "FAQ" },
] as const;

export function Wordmark() {
  return (
    <Link
      href="/"
      className="font-display flex min-h-11 items-center gap-1.5 text-lg font-semibold tracking-tight sm:text-xl"
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-moss hidden min-[400px]:block"
      >
        <path d="M2.5 19.5 9 7l4 7 2.5-4 6 9.5z" />
      </svg>
      SandBag
    </Link>
  );
}

const linkClass =
  "hover:text-moss inline-flex min-h-11 items-center hover:underline";

export function SiteHeader() {
  return (
    <header className="border-line relative h-[var(--header-h)] border-b">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-2.5 sm:gap-6">
          {/* Wide screens: every link inline. */}
          <ul className="hidden items-center gap-6 text-sm font-medium sm:flex">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a href={href} className={linkClass}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
          {/* Phones: a native disclosure, so it needs no JavaScript and works
              from the keyboard. Each link is a full page load, which closes it. */}
          <details className="group sm:hidden">
            <summary className="border-line hover:bg-surface inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
              Menu
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
                className="transition-transform group-open:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <ul className="bg-paper border-line absolute inset-x-0 top-full z-40 border-b px-4 py-2 shadow-md">
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="hover:text-moss flex min-h-11 items-center text-base font-medium"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <a
            href="/account"
            className="border-line hover:bg-surface inline-flex min-h-11 items-center rounded-md border px-2 text-[13px] font-medium sm:px-3 sm:text-sm"
          >
            Account
          </a>
        </nav>
      </div>
    </header>
  );
}
