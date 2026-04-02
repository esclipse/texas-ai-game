import { supabaseBrowser } from "@/lib/supabase/client";

/** Send Supabase magic link; `emailRedirectTo` must be allowed in Supabase Auth redirect URLs. */
export async function sendMagicLinkToEmail(
  emailRaw: string,
  emailRedirectTo: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return { ok: false, error: "请输入邮箱" };
  const sb = supabaseBrowser();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) return { ok: false, error: `发送失败：${error.message}` };
  return { ok: true };
}
