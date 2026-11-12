"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { Upload, type PreviousUpload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { parseRawObjectKey, rawObjectKey } from "@/lib/upload/keys";
import { buildTusOptions, describeUploadError } from "@/lib/upload/tus";
import {
  ACCEPT_ATTR,
  checkUploadFile,
  checkZipEntries,
  CONTENT_TYPES,
  extensionOf,
  formatBytes,
  type UploadKind,
} from "@/lib/upload/validate";
import { readZipEntryNames } from "@/lib/upload/zip";
import { AttachPicker } from "./AttachPicker";
import { canResumeScan, createScan, notifyUploadComplete } from "./actions";

type Phase = "idle" | "starting" | "uploading" | "paused" | "error" | "done";
type Progress = { sent: number; total: number; rate: number };

const button =
  "rounded-lg px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
const primary = `${button} bg-stone-900 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300`;
const secondary = `${button} border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800`;

async function fileProblem(file: File): Promise<string | null> {
  const check = checkUploadFile(file);
  if (!check.ok) return check.error;
  if (check.kind !== "zip") return null;
  const names = await readZipEntryNames(file);
  return names ? checkZipEntries(names) : "That .zip couldn't be read.";
}

export function UploadForm(props: {
  userId: string;
  supabaseUrl: string;
  anonKey: string;
  /** A retry scan created by the scan page (#17); the file uploads into it. */
  retryScanId?: string;
}) {
  const { userId, supabaseUrl, anonKey, retryScanId } = props;
  const [startedScanId, setStartedScanId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null); // blocks upload
  const [message, setMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  // Scan row exists for this file: its OpenBeta fields are fixed now.
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useRef<Upload | null>(null);
  const sample = useRef({ t: 0, bytes: 0 });

  async function choose(f: File | undefined) {
    if (!f || phase === "uploading" || phase === "starting") return;
    setPhase("idle");
    setProgress(null);
    setMessage(null);
    upload.current = null;
    setStarted(false);
    setFile(f);
    setProblem(await fileProblem(f));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files[0]);
  }

  function resume() {
    sample.current = { t: performance.now(), bytes: progress?.sent ?? 0 };
    setPhase("uploading");
    upload.current?.start();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || problem) return;
    if (upload.current) return resume(); // Retry after an error.
    setPhase("starting");
    setMessage(null);
    try {
      await start(file, new FormData(e.currentTarget));
    } catch {
      setMessage("Something went wrong starting the upload. Try again.");
      setPhase("idle");
    }
  }

  async function start(file: File, form: FormData) {
    const supabase = createClient();
    const tusBase = {
      supabaseUrl,
      anonKey,
      userId,
      getAccessToken: async () =>
        (await supabase.auth.getSession()).data.session?.access_token ?? null,
    };

    // A stored upload of this same file (page reload, crash) resumes into its
    // existing scan instead of creating a second one.
    const probe = new Upload(
      file,
      buildTusOptions({ ...tusBase, objectName: "", contentType: "" }),
    );
    let previous: PreviousUpload | undefined;
    let target:
      { scanId: string; objectName: string; contentType: string } | undefined;
    for (const prev of await probe.findPreviousUploads()) {
      const key = parseRawObjectKey(prev.metadata.objectName ?? "");
      if (key?.uploaderId === userId && (await canResumeScan(key.scanId)).ok) {
        previous = prev;
        const kind = extensionOf(key.fileName) as UploadKind;
        target = {
          scanId: key.scanId,
          objectName: `${key.uploaderId}/${key.scanId}/raw/${key.fileName}`,
          contentType: CONTENT_TYPES[kind],
        };
        break;
      }
      await probe.options.urlStorage?.removeUpload(prev.urlStorageKey);
    }
    if (!target && retryScanId && (await canResumeScan(retryScanId)).ok) {
      const kind = extensionOf(file.name) as UploadKind;
      target = {
        scanId: retryScanId,
        objectName: rawObjectKey(userId, retryScanId, kind),
        contentType: CONTENT_TYPES[kind],
      };
    }
    if (!target) {
      const created = await createScan({
        fileName: file.name,
        fileSize: file.size,
        areaId: String(form.get("areaId") ?? ""),
        climbId: String(form.get("climbId") ?? ""),
        sensitive: form.get("sensitive") === "on",
      });
      if (!created.ok) {
        setMessage(created.error);
        setPhase("idle");
        return;
      }
      target = created;
    }

    const { scanId } = target;
    setStartedScanId(scanId);
    const tus = new Upload(file, {
      ...buildTusOptions({ ...tusBase, ...target }),
      onProgress: (sent, total) => {
        const dt = (performance.now() - sample.current.t) / 1000;
        const rate = dt > 1 ? (sent - sample.current.bytes) / dt : 0;
        setProgress((p) => ({ sent, total, rate: rate || p?.rate || 0 }));
      },
      onError: (err) => {
        setMessage(describeUploadError(err));
        setPhase("error");
      },
      onSuccess: async () => {
        const done = await notifyUploadComplete(scanId);
        if (done.ok) {
          setPhase("done");
          setMessage(null);
        } else {
          setMessage(done.error);
          setPhase("error");
        }
      },
    });
    if (previous) tus.resumeFromPreviousUpload(previous);
    upload.current = tus;
    setStarted(true);
    resume();
  }

  const busy = phase === "starting" || phase === "uploading";
  const pct = progress ? Math.floor((progress.sent / progress.total) * 100) : 0;
  const eta =
    progress && progress.rate > 0
      ? Math.ceil((progress.total - progress.sent) / progress.rate)
      : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label
        htmlFor="scan-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center focus-within:outline-2 focus-within:outline-offset-2 ${
          dragging
            ? "border-stone-900 bg-stone-100 dark:border-stone-100 dark:bg-stone-800"
            : "border-stone-300 dark:border-stone-700"
        }`}
      >
        <span className="font-medium">
          {file ? file.name : "Drop a scan here, or choose a file"}
        </span>
        <span className="text-sm text-stone-500">
          {file
            ? formatBytes(file.size)
            : ".glb, .gltf, .ply, or .zip (OBJ + textures), up to 200 MB"}
        </span>
        <input
          id="scan-file"
          type="file"
          accept={ACCEPT_ATTR}
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0])}
          className="sr-only"
        />
      </label>

      <fieldset className="flex flex-col gap-3" disabled={busy || started}>
        <legend className="mb-1 font-medium">OpenBeta (optional)</legend>
        <AttachPicker />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="sensitive" className="mt-1" />
          <span>
            This area is sensitive or closed — hide its location. (Needs an
            attached area.)
          </span>
        </label>
      </fieldset>

      {progress && (
        <div className="flex flex-col gap-1">
          <progress
            value={progress.sent}
            max={progress.total}
            className="h-2 w-full"
            aria-label="Upload progress"
          />
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {pct}% · {formatBytes(progress.sent)} of{" "}
            {formatBytes(progress.total)}
            {phase === "uploading" &&
              progress.rate > 0 &&
              ` · ${formatBytes(progress.rate)}/s`}
            {phase === "uploading" &&
              eta !== null &&
              ` · about ${eta < 90 ? `${eta} s` : `${Math.ceil(eta / 60)} min`} left`}
          </p>
        </div>
      )}

      <p
        role="status"
        className={
          phase === "done"
            ? "text-green-700 dark:text-green-400"
            : "text-red-700 dark:text-red-400"
        }
      >
        {phase === "done"
          ? "Uploaded. Automated checks will run next."
          : (problem ?? message)}
        {phase === "done" && startedScanId && (
          <>
            {" "}
            <Link href={`/upload/scans/${startedScanId}`} className="underline">
              Follow its progress
            </Link>
          </>
        )}
      </p>

      <div className="flex gap-3">
        {phase === "uploading" ? (
          <button
            type="button"
            className={secondary}
            onClick={() => {
              void upload.current?.abort();
              setPhase("paused");
            }}
          >
            Pause
          </button>
        ) : phase === "paused" ? (
          <button type="button" className={primary} onClick={resume}>
            Resume
          </button>
        ) : phase !== "done" ? (
          <button
            type="submit"
            className={primary}
            disabled={!file || busy || problem !== null}
          >
            {phase === "error"
              ? "Retry"
              : phase === "starting"
                ? "Starting…"
                : "Upload"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
