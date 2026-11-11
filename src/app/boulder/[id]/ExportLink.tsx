/**
 * Plain download anchor for the per-boulder open-data zip (PRD §2, #32).
 * Only rendered for published scans, the same set the export route serves.
 */
export function ExportLink({ scanId }: { scanId: string }) {
  return (
    <a
      href={`/api/scans/${scanId}/export`}
      download={`sandbag-${scanId}.zip`}
      className="inline-block rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-stone-700 dark:hover:bg-stone-800"
    >
      Download open data (.zip)
    </a>
  );
}
