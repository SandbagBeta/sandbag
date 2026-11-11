"use client";

import { useEffect, useId, useState } from "react";
import type { AttachArea, AttachClimb } from "@/lib/upload/attach";
import { listClimbsAction, searchAreasAction } from "./attach-actions";

const field =
  "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900";
const option =
  "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-stone-100 focus-visible:outline-2 dark:hover:bg-stone-800";
const muted = "text-sm text-stone-600 dark:text-stone-400";

/** Typeahead for an OpenBeta area, then an optional climb in it. Emits areaId/climbId form fields. */
export function AttachPicker() {
  const id = useId();
  const [q, setQ] = useState("");
  const [areas, setAreas] = useState<AttachArea[]>([]);
  const [area, setArea] = useState<AttachArea | null>(null);
  const [climbs, setClimbs] = useState<AttachClimb[]>([]);
  const [climb, setClimb] = useState<AttachClimb | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (area || q.trim().length < 2) return;
    let stale = false;
    const t = setTimeout(async () => {
      const res = await searchAreasAction(q);
      if (stale) return;
      setSearched(true);
      if (res.ok) {
        setAreas(res.items);
        setNote(res.incomplete ? "Results may be incomplete." : null);
      } else setNote(res.error);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, area]);

  async function pickArea(a: AttachArea) {
    setArea(a);
    setClimb(null);
    setClimbs([]);
    const res = await listClimbsAction(a.id);
    if (res.ok) {
      setClimbs(res.items);
      setNote(null);
    } else setNote(res.error);
  }

  function clear() {
    setArea(null);
    setClimb(null);
    setClimbs([]);
    setAreas([]);
    setSearched(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="areaId" value={area?.id ?? ""} />
      <input type="hidden" name="climbId" value={climb?.id ?? ""} />

      {area ? (
        <p className="flex items-center justify-between gap-3 text-sm">
          <span>
            <strong>{area.name}</strong>
            {area.path && <span className={muted}> in {area.path}</span>}
          </span>
          <button type="button" onClick={clear} className="underline">
            Change area
          </button>
        </p>
      ) : (
        <>
          <label htmlFor={`${id}-q`} className="flex flex-col gap-1 text-sm">
            Search OpenBeta areas
            <input
              id={`${id}-q`}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Pawtuckaway"
              autoComplete="off"
              className={field}
            />
          </label>
          {areas.length > 0 && (
            <ul aria-label="Matching areas" className="flex flex-col">
              {areas.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={option}
                    onClick={() => void pickArea(a)}
                  >
                    <span className="font-medium">{a.name}</span>
                    {a.path && (
                      <span className={`block text-xs ${muted}`}>{a.path}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searched && areas.length === 0 && (
            <p className="text-sm">No match.</p>
          )}
        </>
      )}

      {area && climbs.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          Climb (optional)
          <select
            className={field}
            value={climb?.id ?? ""}
            onChange={(e) =>
              setClimb(climbs.find((c) => c.id === e.target.value) ?? null)
            }
          >
            <option value="">No specific climb</option>
            {climbs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.grade ? ` (${c.grade})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <p role="status" className={muted}>
        {note}
      </p>
      <p className={muted}>
        Can&apos;t find it? Upload without attaching, and{" "}
        <a
          href="https://openbeta.io/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          add the area or boulder on OpenBeta
        </a>{" "}
        first.
      </p>
    </div>
  );
}
