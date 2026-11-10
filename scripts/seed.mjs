#!/usr/bin/env node
// pnpm seed — validates the demo fixture, uploads the GLB to Supabase Storage,
// inserts the demo scan, climbs, holds and paths, and publishes them through
// the lifecycle module. Needs NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local if present). Without them
// it reports and exits 0 so the README quickstart works with no Supabase stack.
//
// Run through tsx (see package.json) so it can import the TypeScript
// lifecycle module, the only code allowed to write scan/climb status.
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyTransition } from "../src/lib/lifecycle/apply";
import { runSeed } from "./lib/seed-core.mjs";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile); // does not override vars already in the environment
}

// --force allows seeding a non-local Supabase URL (see seed-core.mjs).
const force = process.argv.includes("--force");

runSeed({ env: process.env, createClient, applyTransition, force }).catch(
  (err) => {
    console.error(`pnpm seed failed: ${err.message}`);
    process.exit(1);
  },
);
