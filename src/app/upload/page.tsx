import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signInPath } from "@/lib/auth/gating";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = { title: "Upload a scan — SandBag" };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ retry?: string }>;
}) {
  const { retry } = await searchParams;
  // Render per request, never at build time (Supabase env may be absent).
  await connection();
  // The proxy redirects signed-out users too; this is the real check.
  if (!isSupabaseConfigured()) redirect(signInPath("/upload"));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(signInPath("/upload"));
  // Both public (NEXT_PUBLIC_*); the browser needs them for the TUS endpoint.
  const { url, anonKey } = getPublicSupabaseEnv();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Upload a scan</h1>
      <p className="text-stone-600 dark:text-stone-400">
        Export your scan as GLB, glTF or PLY, or zip an OBJ with its .mtl and
        textures. Up to 200 MB. Automated checks run after the upload, then a
        reviewer takes a look. Uploads are shared under CC BY-SA 4.0. New to
        scanning? Read the{" "}
        <a
          className="underline"
          href="https://github.com/SandbagBeta/sandbag/blob/main/docs/capture-guide.md"
        >
          capture guide
        </a>
        .
      </p>
      <UploadForm
        userId={data.user.id}
        supabaseUrl={url}
        anonKey={anonKey}
        retryScanId={typeof retry === "string" ? retry : undefined}
      />
    </main>
  );
}
