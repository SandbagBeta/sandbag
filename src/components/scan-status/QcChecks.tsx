import type { FailureGroups } from "@/lib/scan-report/format";

function List({ items }: { items: { id: string; message: string }[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((c) => (
        <li key={c.id}>{c.message}</li>
      ))}
    </ul>
  );
}

/** Plain-English QC results. Messages come from the pipeline's own templates. */
export function QcChecks({ groups }: { groups: FailureGroups }) {
  const { blocking, advisory, passed } = groups;
  if (!blocking.length && !advisory.length && !passed.length)
    return <p>No automated check results yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {blocking.length > 0 && (
        <div>
          <h3 className="font-semibold text-red-700 dark:text-red-400">
            Needs fixing ({blocking.length})
          </h3>
          <List items={blocking} />
        </div>
      )}
      {advisory.length > 0 && (
        <div>
          <h3 className="font-semibold">Worth a look ({advisory.length})</h3>
          <List items={advisory} />
        </div>
      )}
      {passed.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            {passed.length} checks passed
          </summary>
          <List items={passed} />
        </details>
      )}
    </div>
  );
}
