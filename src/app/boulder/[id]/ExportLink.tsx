/**
 * Plain download anchor for the per-boulder open-data zip (PRD §2, #32).
 * Only rendered for published scans, the same set the export route serves.
 */
export function ExportLink({ scanId }: { scanId: string }) {
  return (
    <a
      href={`/api/scans/${scanId}/export`}
      download={`sandbag-${scanId}.zip`}
      className="btn btn-ghost px-3 py-1.5"
    >
      Download open data (.zip)
    </a>
  );
}
