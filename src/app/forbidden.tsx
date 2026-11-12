import Link from "next/link";

/** Rendered with a 403 when a page calls `forbidden()` (e.g. /review). */
export default function Forbidden() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">403 Forbidden</h1>
      <p className="mt-3 text-stone-600 dark:text-stone-400">
        You do not have access to this page. Reviewing is limited to
        maintainers.
      </p>
      <Link href="/" className="mt-4 inline-block underline">
        Back to the home page
      </Link>
    </main>
  );
}
