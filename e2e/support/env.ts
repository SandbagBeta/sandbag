/** Env the database-backed specs need. Specs call `requireDb()` to skip cleanly without it. */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const hasDb = Boolean(supabaseUrl && anonKey && serviceKey);
