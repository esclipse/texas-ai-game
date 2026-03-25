import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig } from "@/lib/app-config";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export function supabaseAdmin() {
  const { url, serviceRoleKey } = getSupabaseAdminConfig();
  if (!url) requireEnv("SUPABASE_URL");
  if (!serviceRoleKey) requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

