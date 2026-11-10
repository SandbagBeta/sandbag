import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next 16 renamed `middleware.ts` to `proxy.ts`. Gated routes are listed in
// src/lib/auth/gating.ts.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, image optimization and fixture files.
    "/((?!_next/static|_next/image|favicon.ico|fixtures/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|bin)$).*)",
  ],
};
