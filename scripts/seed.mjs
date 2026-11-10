#!/usr/bin/env node
// pnpm seed — validates the demo fixture and uploads it to Supabase Storage
// when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (loaded
// from .env.local if present). Without them it reports and exits 0 so the
// README quickstart works with no Supabase stack.
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSeed } from "./lib/seed-core.mjs";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile); // does not override vars already in the environment
}

runSeed({ env: process.env, createClient }).catch((err) => {
  console.error(`pnpm seed failed: ${err.message}`);
  process.exit(1);
});
