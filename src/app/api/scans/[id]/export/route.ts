import { buildBoulderExport } from "@/lib/export/boulder";
import { storageFor } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Climb, ClimbPath, Hold } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/scans/:id/export — open-data zip for one published scan (PRD §2).
 * Reads through the user's RLS client, so only published data is exportable.
 * Selects explicit non-geo columns; no coordinates are ever touched here.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await createClient();
  const { data: scan } = await db
    .from("scans")
    .select(
      "id, openbeta_area_id, openbeta_climb_id, status, glb_path, content_hash, tri_count, texture_res, capture_app, captured_at, license, uploader_id",
    )
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (!scan || !scan.glb_path)
    return Response.json({ error: "not found" }, { status: 404 });

  const { data: climbRows } = await db
    .from("climbs")
    .select(
      "id, scan_id, name, description, proposed_grade, fa_info, status, created_by",
    )
    .eq("scan_id", id)
    .eq("status", "published");
  const climbs = (climbRows ?? []) as Climb[];
  const ids = climbs.map((c) => c.id);
  const [holds, paths, glbBytes] = await Promise.all([
    ids.length
      ? db.from("holds").select("*").in("climb_id", ids)
      : { data: [] as Hold[] },
    ids.length
      ? db.from("paths").select("*").in("climb_id", ids)
      : { data: [] as ClimbPath[] },
    storageFor(db)
      .download({ bucket: "published", key: scan.glb_path })
      .catch(() => null),
  ]);
  if (!glbBytes) {
    return Response.json({ error: "mesh unavailable" }, { status: 502 });
  }

  const profileIds = [
    scan.uploader_id,
    ...climbs.map((c) => c.created_by),
  ].filter((v): v is string => !!v);
  const { data: profiles } = profileIds.length
    ? await db.from("profiles").select("id, handle").in("id", profileIds)
    : { data: [] };
  const handle = new Map(
    (profiles ?? []).map((p) => [p.id, p.handle as string]),
  );
  const contributors = [
    ...(scan.uploader_id && handle.has(scan.uploader_id)
      ? [{ handle: handle.get(scan.uploader_id)!, role: "scan" as const }]
      : []),
    ...climbs.flatMap((c) =>
      c.created_by && handle.has(c.created_by)
        ? [{ handle: handle.get(c.created_by)!, role: "climb" as const }]
        : [],
    ),
  ];

  const { uploader_id: _u, status: _s, glb_path: _g, ...scanPublic } = scan;
  void _u;
  void _s;
  void _g;
  let zip: Uint8Array;
  try {
    zip = buildBoulderExport({
      scan: scanPublic as never,
      climbs,
      holds: (holds.data ?? []) as Hold[],
      paths: (paths.data ?? []) as ClimbPath[],
      contributors,
      glb: glbBytes,
      exportedAt: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      { error: "export failed integrity check" },
      { status: 500 },
    );
  }
  return new Response(zip as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="sandbag-${id}.zip"`,
    },
  });
}
