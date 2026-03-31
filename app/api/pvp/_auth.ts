import { supabaseAdmin } from "@/lib/supabase/server";

export async function requireAuthedUserId(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return { ok: false as const, error: "Missing bearer token" };
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, error: "Unauthorized" };
  return { ok: true as const, userId: data.user.id };
}

