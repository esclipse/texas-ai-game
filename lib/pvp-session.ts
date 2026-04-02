import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * PVP 不要求邮箱登录：无会话时用 Supabase Anonymous Sign-In 换 JWT。
 * 需在 Supabase Dashboard → Authentication → Providers → Anonymous 开启。
 */
export async function ensurePvpSupabaseSession(): Promise<{ accessToken: string; userId: string } | null> {
  try {
    const sb = supabaseBrowser();
    const { data: sessionData } = await sb.auth.getSession();
    const s = sessionData.session;
    if (s?.access_token && s.user?.id) {
      return { accessToken: s.access_token, userId: s.user.id };
    }
    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data.session?.access_token || !data.session.user?.id) {
      return null;
    }
    return { accessToken: data.session.access_token, userId: data.session.user.id };
  } catch {
    return null;
  }
}
