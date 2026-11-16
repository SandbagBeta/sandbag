import Link from "next/link";

// Plain <a> links (not next/link) keep every page static-friendly: /account
// is gated by the proxy, which sends signed-out users to /sign-in.
export const NAV_LINKS = [
  { href: "/areas", label: "Areas" },
  { href: "/search", label: "Search" },
  { href: "/upload", label: "Contribute" },
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

export function SiteHeader() {
  return (
    <header className="border-line h-[var(--header-h)] border-b">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-2.5 sm:gap-6">
          <ul className="flex items-center gap-2.5 text-[13px] font-medium sm:gap-6 sm:text-sm">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  className="hover:text-moss inline-flex min-h-11 items-center hover:underline"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
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
